/**
 * build-grades.js
 *
 * Generates combined JSON files for kentei grades that span multiple
 * school-grade datasets:
 *
 *   grade-joyo.json  = 小1〜6 (grade-2..grade-6) + 中学 (grade-8)
 *                      → 常用漢字全体 (~2,136字)  [4級・3級・準2級]
 *
 *   grade-2kyu.json  = 常用漢字 + 人名用漢字 (jinmeiyo.json)
 *                      → ~3,000字  [2級]
 *
 *   grade-pre1.json  = 常用漢字 + 人名用漢字 + JIS第1・第2水準 (extra-jis.json)
 *                      → ~6,000字  [準1級・1級]
 *
 * Usage: node scripts/build-grades.js
 */

const fs = require('fs');
const path = require('path');

const GRADES_DIR = path.join(__dirname, '..', 'js', 'grades');

function loadJSON(name) {
    return JSON.parse(fs.readFileSync(path.join(GRADES_DIR, name), 'utf8'));
}

function dedupByKanji(arrays) {
    const seen = new Set();
    const result = [];
    for (const arr of arrays) {
        for (const item of arr) {
            if (!seen.has(item.kanji)) {
                seen.add(item.kanji);
                result.push(item);
            }
        }
    }
    return result;
}

// --- 常用漢字 (Jōyō Kanji) = 小1〜6 + 中学 ---
const joyoSources = [
    loadJSON('grade-2.json'),  // 小1 (80)
    loadJSON('grade-3.json'),  // 小2 (160)
    loadJSON('grade-4.json'),  // 小3 (200)
    loadJSON('grade-5.json'),  // 小4 (200)
    loadJSON('grade-6.json'),  // 小5 (200)
    loadJSON('grade-8.json'),  // 中学 (1,134)
];

const joyo = dedupByKanji(joyoSources);
fs.writeFileSync(
    path.join(GRADES_DIR, 'grade-joyo.json'),
    JSON.stringify(joyo),
    'utf8'
);
console.log(`grade-joyo.json: ${joyo.length} kanji (常用漢字)`);

// --- 常用 + 人名用漢字 (2級) ---
const jinmeiyo = loadJSON('jinmeiyo.json');
const grade2kyu = dedupByKanji([joyo, jinmeiyo]);
fs.writeFileSync(
    path.join(GRADES_DIR, 'grade-2kyu.json'),
    JSON.stringify(grade2kyu),
    'utf8'
);
console.log(`grade-2kyu.json: ${grade2kyu.length} kanji (常用+人名用)`);

// --- 常用 + 人名用 + JIS第1・第2水準 (準1級・1級) ---
const extraJis = loadJSON('extra-jis.json');
const gradePre1 = dedupByKanji([grade2kyu, extraJis]);
fs.writeFileSync(
    path.join(GRADES_DIR, 'grade-pre1.json'),
    JSON.stringify(gradePre1),
    'utf8'
);
console.log(`grade-pre1.json: ${gradePre1.length} kanji (常用+人名用+JIS1-2)`);

console.log('Done!');
