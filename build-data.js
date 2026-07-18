/**
 * build-data.js
 * 
 * Fetches Grade 1 (10級) kanji data from kanjiapi.dev
 * and outputs it to js/data.js for offline bundle caching.
 */
const fs = require('fs');
const path = require('path');

const GRADE1_API = 'https://kanjiapi.dev/v1/kanji/grade-1';
const KANJI_DETAIL_PREFIX = 'https://kanjiapi.dev/v1/kanji/';
const OUTPUT_FILE = path.join(__dirname, 'js', 'data.js');

// Create js directory if it doesn't exist
const jsDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(jsDir)) {
    fs.mkdirSync(jsDir, { recursive: true });
}

// Simple sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log(`Fetching Grade 1 kanji list from ${GRADE1_API}...`);
    try {
        const listRes = await fetch(GRADE1_API);
        if (!listRes.ok) {
            throw new Error(`Failed to fetch grade list: ${listRes.statusText}`);
        }
        const kanjiList = await listRes.json();
        console.log(`Found ${kanjiList.length} kanji characters. Fetching details...`);

        const results = [];

        // Fetch details sequentially to avoid rate-limiting
        for (let i = 0; i < kanjiList.length; i++) {
            const char = kanjiList[i];
            const detailUrl = `${KANJI_DETAIL_PREFIX}${encodeURIComponent(char)}`;

            console.log(`[${i + 1}/${kanjiList.length}] Fetching detail for: ${char}`);

            try {
                const detailRes = await fetch(detailUrl);
                if (!detailRes.ok) {
                    console.error(`Error fetching detail for ${char}: ${detailRes.statusText}`);
                    continue;
                }

                const detail = await detailRes.json();

                // Clean data structure
                results.push({
                    kanji: detail.kanji,
                    grade: detail.grade,
                    stroke_count: detail.stroke_count,
                    meanings: detail.meanings,
                    on_readings: detail.on_readings,
                    kun_readings: detail.kun_readings
                });
            } catch (err) {
                console.error(`Network error for character ${char}:`, err.message);
            }

            // Slight delay
            await sleep(100);
        }

        console.log(`Successfully fetched details for ${results.length} characters.`);

        // Write out js/data.js as ES Module exports
        const outputContent = `// Auto-generated Kanji Data for 10級 (Grade 1)
export const initialKanjiData = ${JSON.stringify(results, null, 2)};
`;

        fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');
        console.log(`Wrote JSON structure to ${OUTPUT_FILE}`);
    } catch (err) {
        console.error('Fatal error during data generation:', err);
        process.exit(1);
    }
}

main();
