/**
 * build-kanjivg.js
 *
 * Collects every kanji used by the app (js/data.js + js/grades/*.json),
 * downloads the matching KanjiVG stroke-order SVG, and bundles them into
 * ./kanjivg/<codepoint>.svg so the app works fully offline without any
 * external fetch at runtime.
 *
 * Usage: node build-kanjivg.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'kanjivg');
const SOURCES = [
    path.join(ROOT, 'js', 'data.js'),
    ...fs.readdirSync(path.join(ROOT, 'js', 'grades'))
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(ROOT, 'js', 'grades', f))
];

// Extract every distinct kanji character from "kanji": "X" occurrences
function collectKanji() {
    const set = new Set();
    const re = /"kanji"\s*:\s*"([^"]+)"/g;
    for (const file of SOURCES) {
        const text = fs.readFileSync(file, 'utf8');
        let m;
        while ((m = re.exec(text)) !== null) {
            const val = m[1];
            // A single character kanji (handle surrogate pairs too)
            for (const ch of val) {
                const cp = ch.codePointAt(0);
                // Only CJK ideographs
                if ((cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x20000 && cp <= 0x2ffff)) {
                    set.add(ch);
                }
            }
        }
    }
    return set;
}

function codePointFile(ch) {
    return ch.codePointAt(0).toString(16).padStart(5, '0') + '.svg';
}

async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

async function download(ch) {
    const fname = codePointFile(ch);
    const dest = path.join(OUT_DIR, fname);
    if (fs.existsSync(dest)) return { ch, status: 'skip' };

    const cp = ch.codePointAt(0).toString(16).padStart(5, '0');
    const urls = [
        `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/${cp}.svg`,
        `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${cp}.svg`
    ];
    for (const url of urls) {
        try {
            const svg = await fetchWithTimeout(url, 15000);
            fs.writeFileSync(dest, svg, 'utf8');
            return { ch, status: 'ok' };
        } catch (e) {
            // try next source
        }
    }
    return { ch, status: 'fail' };
}

async function runPool(items, worker, concurrency) {
    const results = [];
    let idx = 0;
    async function next() {
        while (idx < items.length) {
            const cur = items[idx++];
            results.push(await worker(cur));
            if (results.length % 50 === 0) {
                console.log(`  ...${results.length}/${items.length}`);
            }
        }
    }
    await Promise.all(new Array(concurrency).fill(0).map(() => next()));
    return results;
}

(async () => {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const kanji = [...collectKanji()];
    console.log(`Unique kanji collected: ${kanji.length}`);

    const results = await runPool(kanji, download, 8);
    const ok = results.filter(r => r.status === 'ok').length;
    const skip = results.filter(r => r.status === 'skip').length;
    const fail = results.filter(r => r.status === 'fail');

    console.log(`\nDone. downloaded=${ok} skipped=${skip} failed=${fail.length}`);
    if (fail.length > 0) {
        console.log('Failed kanji:', fail.map(f => f.ch).join(' '));
    }
})();
