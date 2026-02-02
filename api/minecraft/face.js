import Jimp from 'jimp';

// Helper to handle Jimp import
const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, username, size: sizeParam } = request.query || {};
    const targetUser = user || username;
    // UPDATED: Default size is now 256
    const size = parseInt(sizeParam) || 256;

    if (!targetUser) {
        return response.status(400).json({ error: 'Missing "user" parameter' });
    }

    // CRITICAL: Disable Caching
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let uuid = null;
        let skinUrl = null;

        // STEP 1: Get UUID
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
                if (r.ok) {
                    const data = await r.json();
                    uuid = data.uuid.replace(/-/g, '');
                }
            } catch (e) {}
        }

        if (!uuid) {
            return response.status(404).json({ error: 'User not found' });
        }

        // STEP 2: MOJANG DIRECT
        try {
            const timestamp = Date.now();
            const mojangUrl = `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false&t=${timestamp}`;
            const mojangRes = await fetch(mojangUrl);
            if (mojangRes.ok) {
                const profile = await mojangRes.json();
                if (profile.properties?.[0]?.value) {
                    const decoded = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
                    if (decoded.textures?.SKIN?.url) skinUrl = decoded.textures.SKIN.url;
                }
            }
        } catch (e) {}

        // STEP 3: Fallback
        if (!skinUrl) skinUrl = `https://crafatar.com/skins/${uuid}`;

        // STEP 4: Process Image
        const freshSkinUrl = `${skinUrl}?t=${Date.now()}`;
        const skin = await JimpConstructor.read(freshSkinUrl);
        
        const face = new JimpConstructor(8, 8, 0x00000000); 
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);
        face.composite(skin.clone().crop(40, 8, 8, 8), 0, 0);
        
        // Resize (Nearest Neighbor is mandatory for Minecraft pixel art)
        face.resize(size, size, JimpConstructor.RESIZE_NEAREST_NEIGHBOR);

        const buffer = await face.getBufferAsync(JimpConstructor.MIME_PNG);
        
        response.setHeader('Content-Type', 'image/png');
        response.send(buffer);

    } catch (error) {
        console.error("API Error:", error);
        return response.status(500).json({ error: 'Generation failed', details: error.message });
    }
}
