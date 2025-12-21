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

    // Disable caching to ensure fresh skins
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let skin = null;

        // METHOD 1: Minecraft.tools (User Requested)
        // Fetches directly using username
        try {
            console.log(`Attempting direct fetch from minecraft.tools for: ${targetUser}`);
            const toolsUrl = `https://minecraft.tools/download-skin/${targetUser}`;
            
            const toolsRes = await fetch(toolsUrl);
            
            // Verify we got an image back (not an error page)
            const contentType = toolsRes.headers.get('content-type');
            if (toolsRes.ok && contentType && contentType.includes('image')) {
                const buffer = await toolsRes.arrayBuffer();
                skin = await JimpConstructor.read(Buffer.from(buffer));
                console.log("Successfully loaded skin from minecraft.tools");
            } else {
                console.warn(`minecraft.tools returned ${toolsRes.status} or non-image content`);
            }
        } catch (e) {
            console.warn("minecraft.tools fetch failed:", e.message);
        }

        // METHOD 2: Fallback (UUID Resolution) if Method 1 fails
        // This runs if minecraft.tools is down, rate-limited, or can't find the user
        if (!skin) {
            console.log("Falling back to standard UUID lookup...");
            let uuid = null;
            
            // 1. Get UUID
            try {
                const r = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
                if (r.ok) {
                    const data = await r.json();
                    if (data.code === 'player.found') uuid = data.data.player.raw_id;
                }
            } catch (e) {}

            if (!uuid) {
                try {
                    const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}`);
                    if (r.ok) uuid = (await r.json()).uuid.replace(/-/g, '');
                } catch (e) {}
            }

            if (!uuid) throw new Error('User not found via Direct Link or UUID lookup');

            // 2. Get Skin URL (Direct Mojang or Crafatar)
            let skinUrl = `https://crafatar.com/skins/${uuid}`;
            const timestamp = Date.now();
            
            // Try Direct Mojang Session
            try {
                const mojangRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false&t=${timestamp}`);
                if (mojangRes.ok) {
                    const profile = await mojangRes.json();
                    if (profile.properties?.[0]?.value) {
                        const decoded = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
                        if (decoded.textures?.SKIN?.url) skinUrl = decoded.textures.SKIN.url;
                    }
                }
            } catch (e) {}

            skin = await JimpConstructor.read(skinUrl);
        }

        // PROCESSING: Create 2-Layer Face
        // Create new blank image (8x8 canvas)
        const face = new JimpConstructor(8, 8, 0x00000000);
        
        // Layer 1: Face (Source: 8,8, size 8x8)
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);
        
        // Layer 2: Hat/Overlay (Source: 40,8, size 8x8)
        face.composite(skin.clone().crop(40, 8, 8, 8), 0, 0);
        
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
