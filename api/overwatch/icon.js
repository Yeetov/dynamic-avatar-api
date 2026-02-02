import Jimp from 'jimp';

// Helper to handle Jimp import
const JimpConstructor = Jimp.default || Jimp;

export default async function handler(request, response) {
    const { user, size: sizeParam } = request.query || {};
    // Default to 256 to match Minecraft
    const size = parseInt(sizeParam) || 256;

    if (!user) return response.status(400).json({ error: 'Missing BattleTag' });

    // 1. CRITICAL: Disable Caching (Freshness)
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    try {
        let avatarUrl = null;
        
        // Prepare ID: "Name#1234" -> "Name-1234"
        const formattedId = user.replace(/#/g, '-');

        // STRATEGY 1: Direct Lookup
        try {
            const directUrl = `https://overfast-api.tekrop.fr/players/${formattedId}/summary`;
            const directRes = await fetch(directUrl);
            
            if (directRes.ok) {
                const data = await directRes.json();
                if (data.avatar) avatarUrl = data.avatar;
            }
        } catch (e) {
            console.warn("Direct lookup failed:", e.message);
        }

        // STRATEGY 2: Search Fallback
        if (!avatarUrl) {
            try {
                const cleanName = user.split('#')[0].split('-')[0];
                const searchUrl = `https://overfast-api.tekrop.fr/players?name=${cleanName}`;
                
                const searchRes = await fetch(searchUrl);
                if (searchRes.ok) {
                    const results = await searchRes.json();
                    if (results.results && results.results.length > 0) {
                        const discriminator = user.includes('#') ? user.split('#')[1] : 
                                            (user.includes('-') ? user.split('-')[1] : null);
                        
                        let match = null;
                        if (discriminator) {
                            match = results.results.find(p => p.player_id.endsWith(discriminator));
                        }
                        if (!match) match = results.results[0];
                        
                        if (match) {
                            const matchUrl = `https://overfast-api.tekrop.fr/players/${match.player_id}/summary`;
                            const matchRes = await fetch(matchUrl);
                            if (matchRes.ok) {
                                const matchData = await matchRes.json();
                                avatarUrl = matchData.avatar;
                            }
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

        // PROCESSING: Fetch and Resize
        const imageRes = await fetch(avatarUrl);
        if (!imageRes.ok) throw new Error('Failed to load upstream image');
        
        const imageBuffer = await imageRes.arrayBuffer();
        
        // Use Jimp to resize to requested size
        const image = await JimpConstructor.read(Buffer.from(imageBuffer));
        
        // Use Bilinear for smooth scaling (better for illustrations like OW icons)
        image.resize(size, size, JimpConstructor.RESIZE_BILINEAR);

        const resizedBuffer = await image.getBufferAsync(JimpConstructor.MIME_PNG);

        response.setHeader('Content-Type', 'image/png');
        response.send(resizedBuffer);

    } catch (error) {
        console.error("OW API Error:", error);
        return response.status(500).json({ error: 'Failed to fetch icon', details: error.message });
    }
}
