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
        let skin = null;

        // METHOD 1: Minecraft.tools (Restored as per your "working" version)
        // This fetches the skin file via their proxy service
        try {
            const toolsUrl = `https://minecraft.tools/download-skin/${targetUser}`;
            const toolsRes = await fetch(toolsUrl);
            const contentType = toolsRes.headers.get('content-type');
            
            // Only proceed if we actually got an image back
            if (toolsRes.ok && contentType && contentType.includes('image')) {
                const buffer = await toolsRes.arrayBuffer();
                skin = await JimpConstructor.read(Buffer.from(buffer));
            }
        } catch (e) {
            console.warn("minecraft.tools fetch failed, proceeding to fallback:", e.message);
        }

        // METHOD 2: Fallback (UUID -> Direct Mojang)
        // If Method 1 failed, we do a proper lookup to ensure we get the latest skin.
        if (!skin) {
            let uuid = null;
            
            // 1. Get UUID (PlayerDB is reliable for resolving names)
            try {
                const r = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
                if (r.ok) {
                    const data = await r.json();
                    if (data.code === 'player.found') uuid = data.data.player.raw_id;
                }
            } catch (e) {}

            // Ashcon Backup for UUID
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
                 return response.status(404).json({ error: 'User not found via any provider' });
            }

            // 2. Get Skin URL
            // Default to Crafatar (Reliable)
            let skinUrl = `https://crafatar.com/skins/${uuid}`; 
            
            // Try Direct Mojang Session (Best for "Instant" updates)
            try {
                const timestamp = Date.now();
                const mojangRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false&t=${timestamp}`);
                if (mojangRes.ok) {
                    const profile = await mojangRes.json();
                    if (profile.properties?.[0]?.value) {
                        const decoded = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
                        if (decoded.textures?.SKIN?.url) {
                            skinUrl = decoded.textures.SKIN.url;
                        }
                    }
                }
            } catch (e) {
                // Ignore Mojang errors (rate limits), fall back to Crafatar URL set above
            }

            skin = await JimpConstructor.read(skinUrl);
        }

        // PROCESSING: Create 2-Layer Face
        const face = new JimpConstructor(8, 8, 0x00000000); // Transparent 8x8
        
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
