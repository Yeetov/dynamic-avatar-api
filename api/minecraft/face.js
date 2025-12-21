import Jimp from 'jimp';

// Helper to handle Jimp import in mixed CommonJS/ESM environments
// This prevents "Jimp is not a constructor" errors
const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    // FIX: Use request.query directly provided by Vercel.
    // DO NOT use new URL(request.url) as it crashes on relative paths.
    const { user, username, size: sizeParam } = request.query || {};
    
    // Handle alias (user or username) and default size
    const targetUser = user || username;
    const size = parseInt(sizeParam) || 128;

    if (!targetUser) {
        return response.status(400).json({ error: 'Missing "user" parameter' });
    }

    try {
        // 1. UUID Lookup
        let uuid = null;
        
        // Try Ashcon (Fastest)
        try {
            const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}`);
            if (r.ok) uuid = (await r.json()).uuid;
        } catch (e) {
            console.warn("Ashcon lookup failed:", e.message);
        }

        // Fallback to PlayerDB (Most Robust)
        if (!uuid) {
            const r = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}`);
            if (!r.ok) throw new Error('User not found in PlayerDB');
            const data = await r.json();
            if (data.code !== 'player.found') throw new Error('User not found');
            uuid = data.data.player.raw_id;
        }

        // 2. Skin Lookup
        // Default to Crafatar (safe fallback)
        let skinUrl = `https://crafatar.com/skins/${uuid}`;
        
        // Try Minetools to get the fresh "direct" texture from Mojang
        // This bypasses Crafatar's 20-minute cache if possible
        try {
            const profileReq = await fetch(`https://api.minetools.eu/profile/${uuid}`);
            if (profileReq.ok) {
                const profile = await profileReq.json();
                if (profile.decoded?.textures?.SKIN?.url) {
                    skinUrl = profile.decoded.textures.SKIN.url;
                }
            }
        } catch (e) {
            console.warn("Minetools lookup failed, using Crafatar fallback.");
        }

        // 3. Process Image using Jimp
        // Read the skin
        const skin = await JimpConstructor.read(skinUrl);
        
        // Create new blank image (8x8)
        const face = new JimpConstructor(8, 8, 0x00000000);
        
        // Crop Face (8, 8, 8, 8)
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);
        
        // Crop Hat/Helmet (40, 8, 8, 8) and overlay
        face.composite(skin.clone().crop(40, 8, 8, 8), 0, 0);
        
        // Resize (Nearest Neighbor for crisp pixel art)
        face.resize(size, size, JimpConstructor.RESIZE_NEAREST_NEIGHBOR);

        // Get buffer
        const buffer = await face.getBufferAsync(JimpConstructor.MIME_PNG);
        
        // Return Image
        response.setHeader('Content-Type', 'image/png');
        // Cache: 5 mins in CDN, 1 min in browser
        response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
        response.send(buffer);

    } catch (error) {
        console.error("Minecraft API Error:", error);
        return response.status(500).json({ 
            error: 'Generation failed', 
            details: error.message 
        });
    }
}
