export default async function handler(request, response) {
    // Usage: /api/overwatch/icon?user=Name-1234&platform=pc&region=us
    const { user, platform = 'pc', region = 'us' } = request.query || {};

    if (!user) return response.status(400).json({ error: 'Missing BattleTag (e.g. Name-1234)' });

    // Format tag: Ensure # is replaced with - for the URL
    // e.g. "Cats#11481" -> "Cats-11481"
    let tag = user.replace('#', '-');

    // PERFORMANCE: Enable Caching
    // Cache for 30 mins (Profiles change more often than skins, but not every second)
    response.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');

    try {
        // Using ow-api.com profile endpoint
        const apiUrl = `https://ow-api.com/v1/stats/${platform}/${region}/${tag}/profile`;
        
        const apiRes = await fetch(apiUrl);
        
        if (!apiRes.ok) {
            if (apiRes.status === 404) {
                return response.status(404).json({ error: 'Player not found. Check BattleTag.' });
            }
            throw new Error(`External API Error: ${apiRes.status}`);
        }
        
        const data = await apiRes.json();
        
        // Extract Icon URL
        // API often returns 200 with "private" message
        if (data.private && !data.icon) {
             return response.status(403).json({ error: 'Profile is private. Icon cannot be retrieved.' });
        }

        if (!data.icon) {
            // Fallback for not found inside a 200 response
             if (data.msg === 'profile not found') {
                return response.status(404).json({ error: 'Player not found' });
            }
             throw new Error('No icon found in profile data.');
        }

        const iconUrl = data.icon; 

        // Proxy the image to handle CORS
        const imageRes = await fetch(iconUrl);
        if (!imageRes.ok) throw new Error('Failed to load icon image from Blizzard CDN');
        
        const imageBuffer = await imageRes.arrayBuffer();

        response.setHeader('Content-Type', 'image/png');
        response.send(Buffer.from(imageBuffer));

    } catch (error) {
        console.error("OW API Error:", error);
        return response.status(500).json({ 
            error: 'Failed to fetch Overwatch icon', 
            details: error.message 
        });
    }
}
