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

    // 1. CRITICAL: Disable Serverless/Browser Caching completely
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let uuid = null;
        let skinUrl = null;

        // STEP 1: Get UUID (Required for direct Mojang access)
        // We use PlayerDB as it's the most reliable directory
        try {
            const r = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
            if (r.ok) {
                const data = await r.json();
                if (data.code === 'player.found') uuid = data.data.player.raw_id;
            }
        } catch (e) {
            console.warn("PlayerDB lookup failed:", e.message);
        }

        // Backup UUID lookup (Ashcon) if PlayerDB fails
        if (!uuid) {
            try {
                const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}`);
                if (r.ok) {
                    const data = await r.json();
                    uuid = data.uuid.replace(/-/g, '');
                }
            } catch (e) {}
        }

        if (!uuid) {
            return response.status(404).json({ error: 'User not found' });
        }

        // STEP 2: MOJANG DIRECT (The only way to get "Instant" updates)
        // We query the session server directly. This bypasses all 3rd party caches.
        try {
            // Add timestamp to ensure Vercel doesn't cache the outbound request
            const timestamp = Date.now();
            const mojangUrl = `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false&t=${timestamp}`;
            
            const mojangRes = await fetch(mojangUrl);
            
            if (mojangRes.ok) {
                const profile = await mojangRes.json();
                // Decode the texture property
                if (profile.properties && profile.properties[0] && profile.properties[0].value) {
                    const decoded = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
                    if (decoded.textures && decoded.textures.SKIN && decoded.textures.SKIN.url) {
                        skinUrl = decoded.textures.SKIN.url;
                    }
                }
            } else {
                console.warn(`Mojang API error: ${mojangRes.status} (Likely rate limited, falling back to Crafatar)`);
            }
        } catch (e) {
            console.warn("Mojang Direct connection failed:", e.message);
        }

        // STEP 3: Fallback (Crafatar)
        // Only used if Mojang Direct failed (Rate limits or downtime). 
        // Crafatar is reliable but might be 15-20 mins behind.
        if (!skinUrl) {
            skinUrl = `https://crafatar.com/skins/${uuid}`;
        }

        // STEP 4: Process Image
        // We add a random query param to the skin URL to prevent Jimp/Internal Fetch caching
        const freshSkinUrl = `${skinUrl}?t=${Date.now()}`;
        const skin = await JimpConstructor.read(freshSkinUrl);
        
        const face = new JimpConstructor(8, 8, 0x00000000); 
        
        // Layer 1: Face
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);
        
        // Layer 2: Hat/Overlay
        face.composite(skin.clone().crop(40, 8, 8, 8), 0, 0);
        
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
