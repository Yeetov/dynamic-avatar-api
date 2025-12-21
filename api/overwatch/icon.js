import Jimp from 'jimp';

export default async function handler(request, response) {
    const { searchParams } = new URL(request.url);
    let tag = searchParams.get('user');

    if (!tag) return response.status(400).json({ error: 'Missing BattleTag' });

    // Format tag: Replace # with - for the API call
    tag = tag.replace('#', '-');

    try {
        // 1. Fetch Profile from owapi.io
        // This is a free community API. Rate limits may apply.
        const apiRes = await fetch(`https://owapi.io/profile/pc/us/${tag}`);
        
        if (!apiRes.ok) throw new Error('Player not found or profile private');
        
        const data = await apiRes.json();
        
        // check if profile is private
        if (data.private) {
            return response.status(403).json({ error: 'Profile is Private. Please open Battle.net > Options > Social > Career Profile Visibility: Public' });
        }

        // 2. Get Icon URL
        const iconUrl = data.portrait; // This is the equipped player icon
        if (!iconUrl) throw new Error('No icon found');

        // 3. Fetch the actual image so we can serve it directly (fixing CORS for users)
        const imageRes = await fetch(iconUrl);
        const imageBuffer = await imageRes.arrayBuffer();

        // Optional: We can use Jimp to resize or format it if needed, 
        // but usually just passing it through is faster and better quality.
        
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=60'); // Cache for 10 mins
        response.send(Buffer.from(imageBuffer));

    } catch (error) {
        console.error(error);
        return response.status(500).json({ 
            error: 'Failed to fetch Overwatch icon', 
            hint: 'Ensure profile is PUBLIC and region is correct (defaults to US/PC).',
            details: error.message 
        });
    }
}
