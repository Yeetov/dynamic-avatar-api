export default async function handler(request, response) {
    const { user } = request.query || {};

    if (!user) return response.status(400).json({ error: 'Missing BattleTag' });

    // 1. Disable Caching (Freshness)
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let avatarUrl = null;
        
        // Prepare ID: "Name#1234" -> "Name-1234"
        const formattedId = user.replace(/#/g, '-');

        // STRATEGY 1: Direct Lookup (Fastest/Most Accurate)
        // We try to find the player exactly as typed
        try {
            const directUrl = `https://overfast-api.tekrop.fr/players/${formattedId}/summary`;
            const directRes = await fetch(directUrl);
            
            if (directRes.ok) {
                const data = await directRes.json();
                if (data.avatar) {
                    avatarUrl = data.avatar;
                    // console.log("Found via Direct Lookup");
                }
            }
        } catch (e) {
            console.warn("Direct lookup failed:", e.message);
        }

        // STRATEGY 2: Search Fallback (If Direct Failed)
        // This handles cases where case-sensitivity is wrong OR if the user entered "Name#1234" but the API expects something else
        if (!avatarUrl) {
            try {
                // Extract just the name for searching: "Name-1234" -> "Name"
                const cleanName = user.split('#')[0].split('-')[0];
                const searchUrl = `https://overfast-api.tekrop.fr/players?name=${cleanName}`;
                
                const searchRes = await fetch(searchUrl);
                if (searchRes.ok) {
                    const results = await searchRes.json();
                    if (results.results && results.results.length > 0) {
                        // If we have the discriminator (#1234), try to match it
                        const discriminator = user.includes('#') ? user.split('#')[1] : 
                                            (user.includes('-') ? user.split('-')[1] : null);
                        
                        let match = null;
                        
                        if (discriminator) {
                            // Try to find exact match
                            match = results.results.find(p => p.player_id.endsWith(discriminator));
                        }
                        
                        // If no exact match (or no discriminator provided), take the first one
                        if (!match) match = results.results[0];
                        
                        // Get summary for the found match to get the avatar
                        if (match) {
                            const matchUrl = `https://overfast-api.tekrop.fr/players/${match.player_id}/summary`;
                            const matchRes = await fetch(matchUrl);
                            if (matchRes.ok) {
                                const matchData = await matchRes.json();
                                avatarUrl = matchData.avatar;
                                // console.log(`Found via Search: ${match.player_id}`);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Search lookup failed:", e.message);
            }
        }

        if (!avatarUrl) {
            return response.status(404).json({ error: 'Player not found' });
        }

        // Proxy the image
        const imageRes = await fetch(avatarUrl);
        if (!imageRes.ok) throw new Error('Failed to load upstream image');
        
        const imageBuffer = await imageRes.arrayBuffer();

        response.setHeader('Content-Type', 'image/png');
        response.send(Buffer.from(imageBuffer));

    } catch (error) {
        console.error("OW API Error:", error);
        return response.status(500).json({ error: 'Failed to fetch icon', details: error.message });
    }
}
