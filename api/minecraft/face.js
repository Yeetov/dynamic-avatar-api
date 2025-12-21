import Jimp from 'jimp';

export default async function handler(request, response) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('user');
    const size = parseInt(searchParams.get('size')) || 128;

    if (!username) return response.status(400).json({ error: 'Missing user' });

    try {
        // 1. UUID Lookup (Ashcon -> PlayerDB)
        let uuid = null;
        try {
            const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${username}`);
            if (r.ok) uuid = (await r.json()).uuid;
        } catch (e) {}

        if (!uuid) {
            const r = await fetch(`https://playerdb.co/api/player/minecraft/${username}`);
            if (r.ok) {
                const data = await r.json();
                if (data.code === 'player.found') uuid = data.data.player.raw_id;
            }
        }

        if (!uuid) throw new Error('User not found');

        // 2. Skin Lookup
        let skinUrl = `https://crafatar.com/skins/${uuid}`;
        const profileReq = await fetch(`https://api.minetools.eu/profile/${uuid}`);
        if (profileReq.ok) {
            const profile = await profileReq.json();
            if (profile.decoded?.textures?.SKIN?.url) skinUrl = profile.decoded.textures.SKIN.url;
        }

        // 3. Process
        const skin = await Jimp.read(skinUrl);
        const face = new Jimp(8, 8, 0x00000000);
        
        face.composite(skin.clone().crop(8, 8, 8, 8), 0, 0);
        face.composite(skin.clone().crop(40, 8, 8, 8), 0, 0);
        face.resize(size, size, Jimp.RESIZE_NEAREST_NEIGHBOR);

        const buffer = await face.getBufferAsync(Jimp.MIME_PNG);
        
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60'); // Cache for 5 mins
        response.send(buffer);

    } catch (error) {
        response.status(500).json({ error: 'Generation failed', detail: error.message });
    }
}
