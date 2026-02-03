import Jimp from 'jimp';

const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    const size = parseInt(sizeParam) || 256;

    if (!user) return response.status(400).json({ error: 'Missing username' });

    // GitHub avatars are public and static enough to cache for a bit
    response.setHeader('Cache-Control', 'public, max-age=3600');

    try {
        // GitHub avatars are predictable: https://github.com/{username}.png
        // We proxy it to ensure consistency (PNG format, specific resizing)
        const githubUrl = `https://github.com/${user}.png`;
        
        const imageRes = await fetch(githubUrl);
        
        if (!imageRes.ok) {
            return response.status(404).json({ error: 'User not found' });
        }

        const imageBuffer = await imageRes.arrayBuffer();
        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        
        image.resize(size, size, JimpConstructor.RESIZE_BILINEAR);

        const finalBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(finalBuffer);

    } catch (error) {
        return response.status(500).json({ error: 'Failed to fetch GitHub avatar' });
    }
}
