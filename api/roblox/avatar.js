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
        // 1. Resolve Username to ID (Robust POST method)
        // We use the batch endpoint which is more reliable than search for exact lookups
        const idRes = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'AvatarAPI/1.0'
            },
            body: JSON.stringify({
                usernames: [user],
                excludeBannedUsers: true
            })
        });

        if (!idRes.ok) {
            throw new Error(`Roblox User API Error: ${idRes.status}`);
        }

        const idData = await idRes.json();

        // Check if the user was actually found
        if (!idData.data || idData.data.length === 0) {
            return response.status(404).json({ error: 'User not found' });
        }

        const userId = idData.data[0].id;

        // 2. Fetch Avatar Headshot
        // Roblox supports specific sizes: 48, 60, 150, 420, 720. 
        // We fetch 420x420 (good quality) or 720x720 if size is huge.
        const reqSize = size > 420 ? '720x720' : '420x420';
        
        const thumbUrl = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=${reqSize}&format=Png&isCircular=false`;
        const thumbRes = await fetch(thumbUrl);
        const thumbData = await thumbRes.json();

        if (!thumbData.data || !thumbData.data[0]) {
            throw new Error('Avatar thumbnail data missing');
        }

        if (thumbData.data[0].state !== 'Completed') {
             // Sometimes thumbnails are "Pending" or "Error"
             throw new Error(`Avatar thumbnail state is ${thumbData.data[0].state}`);
        }

        const imageUrl = thumbData.data[0].imageUrl;

        // 3. Resize Image
        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) throw new Error('Failed to download image from Roblox CDN');
        
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
