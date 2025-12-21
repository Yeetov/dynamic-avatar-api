import Jimp from 'jimp';

// Helper to handle Jimp import in mixed CommonJS/ESM environments
// This prevents "Jimp is not a constructor" errors
const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    // FIX: Use request.query directly provided by Vercel.
    const { user, username, size: sizeParam } = request.query || {};
    
    // Handle alias (user or username) and default size
    const targetUser = user || username;
    const size = parseInt(sizeParam) || 128;

    if (!targetUser) {
        return response.status(400).json({ error: 'Missing "user" parameter' });
    }

    // Set headers immediately to prevent caching
    // "no-cache, no-store, must-revalidate" tells the browser and Vercel NOT to store the image
    // This ensures that when you change your skin, a refresh actually checks for the new one.
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let uuid = null;
        let skinUrl = null;
        const timestamp = Date.now(); // Cache buster for internal fetch calls

        // 1. Try Ashcon (Fastest - returns both UUID and Skin)
        try {
            const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${targetUser}?t=${timestamp}`);
            if (r.ok) {
                const data = await r.json();
                uuid = data.uuid;
                if (data.textures && data.textures.skin && data.textures.skin.url) {
                    skinUrl = data.textures.skin.url;
                }
            }
        } catch (e) {
            console.warn("Ashcon lookup failed:", e.message);
        }

        // 2. Fallback: If Ashcon didn't give us what we need
        if (!uuid) {
            // Try PlayerDB for UUID
            const r = await fetch(`https://playerdb.co/api/player/minecraft/${targetUser}?t=${timestamp}`);
            if (!r.ok) throw new Error('User not found in PlayerDB');
            const data = await r.json();
            if (data.code !== 'player.found') throw new Error('User not found');
            uuid = data.data.player.raw_id;
        }

        // If we still don't have a skin URL (e.g. Ashcon gave UUID but no skin, or we used PlayerDB), find it.
        if (!skinUrl) {
            // Default fallback
            skinUrl = `https://crafatar.com/skins/${uuid}`;
            
            // Try Minetools to get the fresh "direct" texture from Mojang
            // This bypasses Crafatar's cache if possible
            try {
                const profileReq = await fetch(`https://api.minetools.eu/profile/${uuid}?t=${timestamp}`);
                if (profileReq.ok) {
                    const profile = await profileReq.json();
                    if (profile.decoded?.textures?.SKIN?.url) {
                        skinUrl = profile.decoded.textures.SKIN.url;
                    }
                }
            } catch (e) {
                console.warn("Minetools lookup failed, using Crafatar fallback.");
            }
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
        response.send(buffer);

    } catch (error) {
        console.error("Minecraft API Error:", error);
        return response.status(500).json({ 
            error: 'Generation failed', 
            details: error.message 
        });
    }
}
