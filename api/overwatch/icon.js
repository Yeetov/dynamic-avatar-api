export default async function handler(request, response) {
    // Usage: /api/overwatch/icon?user=Name-1234&platform=pc&region=us
    const { user, platform = 'pc', region = 'us' } = request.query || {};

    if (!user) return response.status(400).json({ error: 'Missing BattleTag (e.g. Name-1234)' });

    // Format tag: Ensure # is replaced with - for the URL
    // e.g. "Cats#11481" -> "Cats-11481"
    let tag = user.replace('#', '-');

    // Disable caching to ensure dynamic updates
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        // Using ow-api.com profile endpoint (lighter than complete)
        // Defaults: platform=pc, region=us unless specified in query
        const apiUrl = `https://ow-api.com/v1/stats/${platform}/${region}/${tag}/profile`;
        
        const apiRes = await fetch(apiUrl);
        
        if (!apiRes.ok) {
            // Forward 404s correctly instead of masking them as 500s
            if (apiRes.status === 404) {
                return response.status(404).json({ error: 'Player not found. Check BattleTag, Platform, and Region.' });
            }
            throw new Error(`External API Error: ${apiRes.status}`);
        }
        
        const data = await apiRes.json();
        
        // Extract Icon URL
        if (!data.icon) {
            // Sometimes the API returns 200 but with an error message in the body
            if (data.msg === 'profile not found') {
                return response.status(404).json({ error: 'Player not found' });
            }
             throw new Error('No icon found in profile data. Profile might be private or restricted.');
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
        // Return 500 only for actual server errors
        return response.status(500).json({ 
            error: 'Failed to fetch Overwatch icon', 
            details: error.message 
        });
    }
}
