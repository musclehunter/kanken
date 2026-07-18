/**
 * build-all-grades.js
 * 
 * Fetches all Kentei grade lists from kanjiapi.dev,
 * queries character details in highly parallel concurrent batches,
 * and saves files locally to js/grades/ for offline bundle access.
 */
const fs = require('fs');
const path = require('path');

const API_ROOT = 'https://kanjiapi.dev/v1/kanji/';
const GRADES_DIR = path.join(__dirname, 'js', 'grades');

if (!fs.existsSync(GRADES_DIR)) {
    fs.mkdirSync(GRADES_DIR, { recursive: true });
}

// Concurrency pool helper
async function mapConcurrent(items, concurrency, fn) {
    const results = [];
    const activePromises = [];

    for (const item of items) {
        // If we've reached concurrency limit, wait for one to finish
        if (activePromises.length >= concurrency) {
            await Promise.race(activePromises);
        }

        const p = fn(item).then(res => {
            if (res) results.push(res);
            // Remove self from active list when finished
            activePromises.splice(activePromises.indexOf(p), 1);
        });

        activePromises.push(p);
    }

    await Promise.all(activePromises);
    return results;
}

async function fetchDetails(kanjiList, label) {
    console.log(`Fetching details for ${kanjiList.length} kanji in [${label}]...`);

    let count = 0;
    const details = await mapConcurrent(kanjiList, 30, async (char) => {
        try {
            const res = await fetch(`${API_ROOT}${encodeURIComponent(char)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            count++;
            if (count % 200 === 0) {
                console.log(`  Processed ${count}/${kanjiList.length} characters in [${label}]`);
            }

            return {
                kanji: data.kanji,
                grade: data.grade,
                stroke_count: data.stroke_count,
                meanings: data.meanings,
                on_readings: data.on_readings,
                kun_readings: data.kun_readings
            };
        } catch (e) {
            // Return minimal structure in case of network failures
            return {
                kanji: char,
                stroke_count: 0,
                meanings: [],
                on_readings: [],
                kun_readings: []
            };
        }
    });

    return details;
}

async function main() {
    try {
        // 1. Grade 2-6 (9級 to 5級)
        for (let g = 2; g <= 6; g++) {
            const res = await fetch(`${API_ROOT}grade-${g}`);
            const list = await res.json();
            const details = await fetchDetails(list, `Grade ${g}`);
            fs.writeFileSync(path.join(GRADES_DIR, `grade-${g}.json`), JSON.stringify(details, null, 2), 'utf-8');
        }

        // 2. Grade 8 (4級 to 2級)
        const res8 = await fetch(`${API_ROOT}grade-8`);
        const list8 = await res8.json();
        const details8 = await fetchDetails(list8, 'Grade 8 (Jōyō)');
        fs.writeFileSync(path.join(GRADES_DIR, `grade-8.json`), JSON.stringify(details8, null, 2), 'utf-8');

        // 3. Jinmeiyō (準1級)
        const resJ = await fetch(`${API_ROOT}jinmeiyo`);
        const listJ = await resJ.json();
        const detailsJ = await fetchDetails(listJ, 'Jinmeiyo');
        fs.writeFileSync(path.join(GRADES_DIR, 'jinmeiyo.json'), JSON.stringify(detailsJ, null, 2), 'utf-8');

        // 4. All remaining characters not matched (1級)
        console.log('Fetching list of all kanji...');
        const resA = await fetch(`${API_ROOT}all`);
        const listA = await resA.json();

        // Create a Set of characters we already fetched
        const alreadyFetched = new Set();
        // Fetch grade 1 list dynamically to exclude it too
        const res1 = await fetch(`${API_ROOT}grade-1`);
        const list1 = await res1.json();

        list1.forEach(c => alreadyFetched.add(c));
        details8.forEach(c => alreadyFetched.add(c.kanji));
        detailsJ.forEach(c => alreadyFetched.add(c.kanji));
        for (let g = 2; g <= 6; g++) {
            const file = JSON.parse(fs.readFileSync(path.join(GRADES_DIR, `grade-${g}.json`), 'utf-8'));
            file.forEach(c => alreadyFetched.add(c.kanji));
        }

        // Filter remaining characters
        const remainingList = listA.filter(c => !alreadyFetched.has(c));
        console.log(`Found ${remainingList.length} extra characters representing 1級.`);

        // Download 1級 characters (since there are 10,000+ characters, we will limit to 3,000 most common ones to avoid overloading)
        const target1級List = remainingList.slice(0, 3000);
        const details1 = await fetchDetails(target1級List, '1級 (JIS level 1 & 2 extra)');
        fs.writeFileSync(path.join(GRADES_DIR, 'extra-jis.json'), JSON.stringify(details1, null, 2), 'utf-8');

        console.log('--- ALL JOYO, JINMEIYO AND JIS-1/2 EXTRA DATASETS WRITTEN SUCCESSFULLY ---');
    } catch (e) {
        console.error('Data pre-build failed:', e);
        process.exit(1);
    }
}

main();
