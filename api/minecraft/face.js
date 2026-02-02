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

    // FORCE FRESHNESS: Disable all caching
    // This ensures that if a user updates their skin, they see it immediately.
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let skinUrl = null;
        let uuid = null;
        let fallbackSkinUrl = null;

        // STEP 1: Resolve Username -> UUID
        // We use fast APIs (Ashcon/PlayerDB) just to get the UUID.
        
        // Option A: Ashcon
        try {
            const ashconRes = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}`);
            if (ashconRes.ok) {
                const data = await ashconRes.json();
                uuid = data.uuid.replace(/-/g, ''); // Ensure raw UUID
                fallbackSkinUrl = data.textures.skin.url; // Save as backup
            }
        } catch (e) {
            console.warn("Ashcon lookup failed:", e.message);
        }

        // Option B: PlayerDB (if Ashcon failed to get UUID)
        if (!uuid) {
            try {
                const playerDbRes = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
                if (playerDbRes.ok) {
                    const data = await playerDbRes.json();
                    if (data.success) {
                        uuid = data.data.player.raw_id;
                    }
                }
            } catch (e) {
                console.warn("PlayerDB lookup failed:", e.message);
            }
        }

        if (!uuid) {
             return response.status(404).json({ error: 'User not found' });
        }

        // STEP 2: Get FRESH Skin from Mojang (The Source of Truth)
        // We always try this first to guarantee the latest skin.
        try {
            const timestamp = Date.now();
            const mojangRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false&t=${timestamp}`);
            
            if (mojangRes.ok) {
                const profile = await mojangRes.json();
                if (profile.properties?.[0]?.value) {
                    const decoded = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
                    if (decoded.textures?.SKIN?.url) {
                        skinUrl = decoded.textures.SKIN.url;
                        // console.log("Fetched live skin from Mojang");
                    }
                }
            } else {
                console.warn(`Mojang Direct API error: ${mojangRes.status} (Likely rate limited)`);
            }
        } catch (e) {
            console.warn("Mojang Direct connection failed:", e.message);
        }

        // STEP 3: Fallback (If Mojang rate limits or fails)
        // Use the cached skin from Ashcon or default to Crafatar
        if (!skinUrl) {
            skinUrl = fallbackSkinUrl || `https://crafatar.com/skins/${uuid}`;
        }

        // PROCESSING: JIMP Image Composition
        const skin = await JimpConstructor.read(skinUrl);
        const face = new JimpConstructor(8, 8, 0x00000000); // Transparent 8x8

        // Layer 1: Face
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);

        // Layer 2: Hat/Overlay
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
