import Jimp from 'jimp';

const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    // Default to 256
    const size = parseInt(sizeParam) || 256;

    if (!user) return response.status(400).json({ error: 'Missing username' });

    // Disable caching for freshness
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        // 1. Resolve Username to ID
        // Roblox "users" API
        const userRes = await fetch(`https://users.roblox.com/v1/users/search?keyword=${user}&limit=10`);
        const userData = await userRes.json();

        if (!userData.data || userData.data.length === 0) {
            return response.status(404).json({ error: 'User not found' });
        }

        // The API returns fuzzy matches, we want the exact one if possible
        const targetUser = userData.data.find(u => u.name.toLowerCase() === user.toLowerCase()) || userData.data[0];
        const userId = targetUser.id;

        // 2. Fetch Avatar Headshot
        // Roblox supports specific sizes: 48, 60, 150, 420, 720. 
        // We fetch 420x420 (good quality) or 720x720 if size is huge.
        const reqSize = size > 420 ? '720x720' : '420x420';
        
        const thumbUrl = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=${reqSize}&format=Png&isCircular=false`;
        const thumbRes = await fetch(thumbUrl);
        const thumbData = await thumbRes.json();

        if (!thumbData.data || !thumbData.data[0] || thumbData.data[0].state !== 'Completed') {
            throw new Error('Avatar thumbnail not available or pending');
        }

        const imageUrl = thumbData.data[0].imageUrl;

        // 3. Resize Image
        const imageRes = await fetch(imageUrl);
        const imageBuffer = await imageRes.arrayBuffer();

        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        
        // Resize using Bilinear (smooth) for Roblox 3D avatars
        image.resize(size, size, JimpConstructor.RESIZE_BILINEAR);

        const finalBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(finalBuffer);

    } catch (error) {
        console.error("Roblox API Error:", error);
        return response.status(500).json({ error: 'Failed to fetch Roblox avatar', details: error.message });
    }
}
