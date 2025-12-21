import Jimp from 'jimp';

// Helper to handle Jimp import in mixed CommonJS/ESM environments
const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('user') || searchParams.get('username');
    const size = parseInt(searchParams.get('size')) || 128;

    if (!username) {
        return response.status(400).json({ error: 'Missing "user" parameter' });
    }

    try {
        // 1. UUID Lookup
        let uuid = null;
        
        // Try Ashcon
        try {
            const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${username}`);
            if (r.ok) uuid = (await r.json()).uuid;
        } catch (e) {
            console.error("Ashcon lookup failed:", e.message);
        }

        // Fallback to PlayerDB
        if (!uuid) {
            const r = await fetch(`https://playerdb.co/api/player/minecraft/${username}`);
            if (!r.ok) throw new Error('User not found in PlayerDB');
            const data = await r.json();
            if (data.code !== 'player.found') throw new Error('User not found');
            uuid = data.data.player.raw_id;
        }

        // 2. Skin Lookup
        let skinUrl = `https://crafatar.com/skins/${uuid}`;
        
        // Try Minetools for fresher skin
        try {
            const profileReq = await fetch(`https://api.minetools.eu/profile/${uuid}`);
            if (profileReq.ok) {
                const profile = await profileReq.json();
                if (profile.decoded?.textures?.SKIN?.url) {
                    skinUrl = profile.decoded.textures.SKIN.url;
                }
            }
        } catch (e) {
            console.warn("Minetools lookup failed, using Crafatar fallback:", e.message);
        }

        // 3. Process Image using Jimp
        // Read the skin
        const skin = await JimpConstructor.read(skinUrl);
        
        // Create new image (8x8) using the resolved constructor
        const face = new JimpConstructor(8, 8, 0x00000000);
        
        // Crop Face (8, 8, 8, 8)
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);
        
        // Crop Hat (40, 8, 8, 8) and overlay
        face.composite(skin.clone().crop(40, 8, 8, 8), 0, 0);
        
        // Resize (Nearest Neighbor for crisp pixel art)
        face.resize(size, size, JimpConstructor.RESIZE_NEAREST_NEIGHBOR);

        const buffer = await face.getBufferAsync(JimpConstructor.MIME_PNG);
        
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
        response.send(buffer);

    } catch (error) {
        console.error("API Error:", error);
        return response.status(500).json({ 
            error: 'Generation failed', 
            details: error.message 
        });
    }
}
