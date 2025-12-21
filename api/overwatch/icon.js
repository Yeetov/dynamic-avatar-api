export default async function handler(request, response) {
    // Usage: /api/overwatch/icon?user=Name-1234
    const { user } = request.query || {};

    if (!user) return response.status(400).json({ error: 'Missing BattleTag (e.g. Name-1234)' });

    // Format tag: Ensure # is replaced with - for the URL
    // e.g. "Cats#11481" -> "Cats-11481"
    let tag = user.replace('#', '-');

    // Disable caching to ensure dynamic updates
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        // Using ow-api.com as requested
        // We default to platform "pc" and region "us" as this covers the majority of profiles 
        // (including cross-progression merged accounts)
        const apiUrl = `https://ow-api.com/v1/stats/pc/us/${tag}/profile`;
        
        const apiRes = await fetch(apiUrl);
        
        if (!apiRes.ok) {
            if (apiRes.status === 404) throw new Error('Player not found');
            throw new Error(`External API Error: ${apiRes.status}`);
        }
        
        const data = await apiRes.json();
        
        // Extract Icon URL
        // Even private profiles usually return an icon in this API
        if (!data.icon) {
             throw new Error('No icon found in profile data. Profile might be restricted.');
        }

        const iconUrl = data.icon; 

        // Proxy the image
        // We fetch the image server-side and pipe it to the client
        // This is crucial because Blizzard's CDN might not allow direct embedding on your site via CORS
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
