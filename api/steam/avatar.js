import Jimp from 'jimp';

const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    const size = parseInt(sizeParam) || 256;

    if (!user) return response.status(400).json({ error: 'Missing username or SteamID' });

    // Cache for performance (Steam avatars don't change every second)
    response.setHeader('Cache-Control', 'public, max-age=3600');

    try {
        let profileUrl;
        
        // Simple heuristic: If it looks like a SteamID64 (17 digits), use /profiles/, otherwise /id/
        if (/^\d{17}$/.test(user)) {
            profileUrl = `https://steamcommunity.com/profiles/${user}`;
        } else {
            profileUrl = `https://steamcommunity.com/id/${user}`;
        }

        // Fetch the public profile page
        const profileRes = await fetch(profileUrl, {
            headers: { 'User-Agent': 'AvatarAPI/1.0' }
        });

        if (!profileRes.ok) {
            return response.status(404).json({ error: 'Steam profile not found' });
        }

        const html = await profileRes.text();

        // Regex to find the OpenGraph image, which is usually the full-size avatar
        // <meta property="og:image" content="https://avatars.akamai.steamstatic.com/..." />
        const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        
        if (!match || !match[1]) {
            throw new Error('Could not find avatar in profile');
        }

        const avatarUrl = match[1];

        // Fetch & Resize
        const imageRes = await fetch(avatarUrl);
        const imageBuffer = await imageRes.arrayBuffer();

        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        image.resize(size, size, JimpConstructor.RESIZE_BILINEAR);

        const finalBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(finalBuffer);

    } catch (error) {
        console.error("Steam API Error:", error);
        return response.status(500).json({ error: 'Failed to fetch Steam avatar', details: error.message });
    }
}
