import Jimp from 'jimp';

const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    const size = parseInt(sizeParam) || 256;

    if (!user) return response.status(400).json({ error: 'Missing username' });

    response.setHeader('Cache-Control', 'public, max-age=3600');

    try {
        // Chess.com Public API
        const chessRes = await fetch(`https://api.chess.com/pub/player/${user}`);
        
        if (!chessRes.ok) {
            return response.status(404).json({ error: 'User not found' });
        }

        const data = await chessRes.json();
        
        // Fallback to default pawn if no avatar is set
        const avatarUrl = data.avatar || 'https://www.chess.com/bundles/web/images/user-image.svg';

        // Fetch & Resize
        const imageRes = await fetch(avatarUrl);
        const imageBuffer = await imageRes.arrayBuffer();

        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        image.resize(size, size, JimpConstructor.RESIZE_BILINEAR);

        const finalBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(finalBuffer);

    } catch (error) {
        return response.status(500).json({ error: 'Failed to fetch Chess.com avatar' });
    }
}
