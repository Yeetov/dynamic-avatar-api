import Jimp from 'jimp';

// Helper to handle Jimp import in mixed CommonJS/ESM environments
const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, username, size: sizeParam } = request.query || {};
    const targetUser = user || username;
    const size = parseInt(sizeParam) || 128;

    if (!targetUser) {
        return response.status(400).json({ error: 'Missing "user" parameter' });
    }

    // PERFORMANCE: Enable Caching
    // Browser cache: 1 hour. CDN/Vercel Cache: 2 hours.
    // This drastically reduces function execution costs.
    response.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=7200');

    try {
        let skinUrl = null;

        // STRATEGY: Resolve Username -> Skin URL
        // 1. Ashcon API (Fastest, caches Mojang data)
        try {
            const ashconRes = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}`);
            if (ashconRes.ok) {
                const data = await ashconRes.json();
                skinUrl = data.textures.skin.url;
            }
        } catch (e) {
            console.warn("Ashcon API failed, trying fallback...", e.message);
        }

        // 2. Fallback: PlayerDB (If Ashcon fails)
        if (!skinUrl) {
            try {
                const playerDbRes = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
                if (playerDbRes.ok) {
                    const data = await playerDbRes.json();
                    if (data.success) {
                        // Decode the textures from the base64 value in properties
                        const props = data.data.player.properties;
                        const textureProp = props.find(p => p.name === 'textures');
                        if (textureProp) {
                            const decoded = JSON.parse(Buffer.from(textureProp.value, 'base64').toString());
                            skinUrl = decoded.textures.SKIN.url;
                        }
                    }
                }
            } catch (e) {
                console.warn("PlayerDB failed", e.message);
            }
        }

        // 3. Last Resort: Crafatar default (Steve/Alex) based on UUID or just fail
        if (!skinUrl) {
            // If we can't find the user, return 404 so the client knows
            return response.status(404).json({ error: 'User not found' });
        }

        // PROCESSING: JIMP Image Composition
        // Read the skin texture
        const skin = await JimpConstructor.read(skinUrl);

        // Create new blank image (8x8 canvas)
        const face = new JimpConstructor(8, 8, 0x00000000);

        // Layer 1: Face (Source: 8,8, size 8x8)
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);

        // Layer 2: Hat/Overlay (Source: 40,8, size 8x8)
        // Check if the area actually has pixels (some skins are buggy)
        const overlay = skin.clone().crop(40, 8, 8, 8);
        face.composite(overlay, 0, 0);

        // Resize using Nearest Neighbor to keep it pixelated and crisp
        face.resize(size, size, JimpConstructor.RESIZE_NEAREST_NEIGHBOR);

        const buffer = await face.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(buffer);

    } catch (error) {
        console.error("API Error:", error);
        return response.status(500).json({ error: 'Generation failed', details: error.message });
    }
}
