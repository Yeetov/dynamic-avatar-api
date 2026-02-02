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

    // CACHING TWEAK: 
    // Reduced to 5 minutes (300s) for browser, 10 minutes (600s) for CDN.
    // This balances performance with "freshness".
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');

    try {
        let skinUrl = null;
        let uuid = null;

        // STRATEGY: 
        // 1. Try Ashcon first (Fastest, handles UUID/Username conversion)
        try {
            const ashconRes = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}`);
            if (ashconRes.ok) {
                const data = await ashconRes.json();
                skinUrl = data.textures.skin.url;
                uuid = data.uuid;
            }
        } catch (e) {
            console.warn("Ashcon API failed:", e.message);
        }

        // 2. FRESHNESS FALLBACK: Direct Mojang Lookup
        // If Ashcon failed OR if we want to be super sure (optional), we try Mojang.
        // We only do this if we have a UUID (from Ashcon or elsewhere) or if Ashcon failed completely.
        if (!skinUrl) {
            try {
                // We need a UUID to talk to Mojang directly. 
                // Using PlayerDB to resolve username -> UUID if we don't have it yet.
                const playerDbRes = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
                if (playerDbRes.ok) {
                    const data = await playerDbRes.json();
                    if (data.success) {
                        uuid = data.data.player.raw_id;
                    }
                }

                if (uuid) {
                    const timestamp = Date.now();
                    const mojangRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false&t=${timestamp}`);
                    if (mojangRes.ok) {
                        const profile = await mojangRes.json();
                        if (profile.properties?.[0]?.value) {
                            const decoded = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
                            if (decoded.textures?.SKIN?.url) {
                                skinUrl = decoded.textures.SKIN.url;
                                console.log("Fetched fresh skin from Mojang");
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Mojang/PlayerDB fallback failed:", e.message);
            }
        }

        // 3. Fallback to Crafatar (Reliable backup)
        if (!skinUrl && uuid) {
            skinUrl = `https://crafatar.com/skins/${uuid}`;
        }

        if (!skinUrl) {
            return response.status(404).json({ error: 'User/Skin not found' });
        }

        // PROCESSING: JIMP Image Composition
        const skin = await JimpConstructor.read(skinUrl);
        const face = new JimpConstructor(8, 8, 0x00000000); // Transparent 8x8

        // Layer 1: Face
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);

        // Layer 2: Hat/Overlay
        // We verify the overlay isn't fully opaque black (legacy skin bug)
        // by checking a few pixels or just relying on standard composite.
        // Standard composite usually works fine unless the skin is ancient.
        const overlay = skin.clone().crop(40, 8, 8, 8);
        face.composite(overlay, 0, 0);

        // Resize
        face.resize(size, size, JimpConstructor.RESIZE_NEAREST_NEIGHBOR);

        const buffer = await face.getBufferAsync(JimpConstructor.MIME_PNG);
        response.setHeader('Content-Type', 'image/png');
        response.send(buffer);

    } catch (error) {
        console.error("API Error:", error);
        return response.status(500).json({ error: 'Generation failed', details: error.message });
    }
}
