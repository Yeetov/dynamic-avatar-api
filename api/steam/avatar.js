import Jimp from 'jimp';

const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    
    // Steam's maximum native avatar size is 184x184.
    // We cap the size at 184 to prevent blurry upscaling.
    let requestedSize = parseInt(sizeParam) || 184;
    const size = Math.min(requestedSize, 184);

    if (!user) return response.status(400).json({ error: 'Missing username or SteamID' });

    // Cache for performance (Steam avatars don't change every second)
    response.setHeader('Cache-Control', 'public, max-age=3600');

    try {
        let profileUrl;
        
        // Determine URL type (ID64 vs Custom URL)
        if (/^\d{17}$/.test(user)) {
            profileUrl = `https://steamcommunity.com/profiles/${user}`;
        } else {
            profileUrl = `https://steamcommunity.com/id/${user}`;
        }

        const profileRes = await fetch(profileUrl, {
            headers: { 'User-Agent': 'AvatarAPI/1.0' }
        });

        if (!profileRes.ok) {
            return response.status(404).json({ error: 'Steam profile not found' });
        }

        const html = await profileRes.text();

        // 1. Find the OpenGraph image
        const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        
        if (!match || !match[1]) {
            throw new Error('Could not find avatar in profile');
        }

        // 2. FORCE FULL RESOLUTION
        // Steam metadata sometimes points to _medium.jpg (64px). 
        // We force it to _full.jpg (184px) to get the best quality before resizing.
        let avatarUrl = match[1];
        avatarUrl = avatarUrl.replace(/_medium\.jpg$/i, '_full.jpg');
        avatarUrl = avatarUrl.replace(/_thumb\.jpg$/i, '_full.jpg');

        // 3. Fetch & Resize
        const imageRes = await fetch(avatarUrl);
        if (!imageRes.ok) throw new Error('Failed to fetch avatar image');

        const imageBuffer = await imageRes.arrayBuffer();

        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        
        // 4. Resize
        // Using Bicubic for best quality downscaling/minor adjustments
        image.resize(size, size, JimpConstructor.RESIZE_BICUBIC);

        const finalBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(finalBuffer);

    } catch (error) {
        console.error("Steam API Error:", error);
        return response.status(500).json({ error: 'Failed to fetch Steam avatar', details: error.message });
    }
}
