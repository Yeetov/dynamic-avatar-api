import Jimp from 'jimp';

const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    const size = parseInt(sizeParam) || 256;

    if (!user) return response.status(400).json({ error: 'Missing BattleTag' });

    // 1. Disable Caching (Freshness)
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let avatarUrl = null;
        
        // Strategy A: Clean up input "Name#1234" -> "Name-1234"
        // This is what Overfast usually expects for IDs
        const idBasedUser = user.replace('#', '-');

        // Strategy B: Clean Name Only "Name#1234" -> "Name"
        // Used for the search fallback
        const nameOnly = user.includes('#') || user.includes('-') 
            ? user.split(/#|-/)[0] 
            : user;

        // 1. Direct Lookup (Exact ID Match)
        try {
            const directUrl = `https://overfast-api.tekrop.fr/players/${idBasedUser}/summary`;
            const directRes = await fetch(directUrl);
            
            if (directRes.ok) {
                const data = await directRes.json();
                if (data.avatar) avatarUrl = data.avatar;
            }
        } catch (e) {
            console.warn("Direct lookup failed:", e.message);
        }

        // 2. Search Fallback (If Direct failed)
        // This handles cases where user entered just "Name" or casing was wrong
        if (!avatarUrl) {
            try {
                const searchUrl = `https://overfast-api.tekrop.fr/players?name=${nameOnly}`;
                const searchRes = await fetch(searchUrl);
                
                if (searchRes.ok) {
                    const results = await searchRes.json();
                    if (results.results && results.results.length > 0) {
                        // If user provided a discriminator (e.g. 1234), try to find that specific one in results
                        const discriminator = user.match(/(\d{3,})/)?.[0]; // Grab 3+ digits if present
                        
                        let match = null;
                        if (discriminator) {
                             match = results.results.find(p => p.player_id.includes(discriminator));
                        }
                        
                        // Default to first result if no discriminator match or no discriminator provided
                        if (!match) match = results.results[0];

                        // Get avatar from summary
                        const summaryUrl = `https://overfast-api.tekrop.fr/players/${match.player_id}/summary`;
                        const summaryRes = await fetch(summaryUrl);
                        if (summaryRes.ok) {
                            const summaryData = await summaryRes.json();
                            avatarUrl = summaryData.avatar;
                        }
                    }
                }
            } catch (e) {
                console.warn("Search lookup failed:", e.message);
            }
        }

        if (!avatarUrl) {
            return response.status(404).json({ error: 'Player not found (Checked Direct & Search)' });
        }

        // 3. Process Image
        const imageRes = await fetch(avatarUrl);
        if (!imageRes.ok) throw new Error('Failed to load upstream image');
        
        const imageBuffer = await imageRes.arrayBuffer();
        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        
        image.resize(size, size, JimpConstructor.RESIZE_BILINEAR);

        const finalBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(finalBuffer);

    } catch (error) {
        console.error("OW API Error:", error);
        return response.status(500).json({ error: 'Failed to fetch icon', details: error.message });
    }
}
