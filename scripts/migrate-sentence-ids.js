/**
 * migrate-sentence-ids.js
 *
 * 各 kentei-*.json の examples[].sentences を
 * 文字列配列 ["..."] から
 * オブジェクト配列 [{ "id": "uuid", "text": "..." }] に移行する。
 *
 * すでに { id, text } 形式になっている行はスキップ（冪等）。
 *
 * 使い方:
 *   node scripts/migrate-sentence-ids.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRADES_DIR = path.join(__dirname, '..', 'js', 'grades');

function newId() {
    return crypto.randomUUID();
}

const files = fs.readdirSync(GRADES_DIR)
    .filter(f => /^kentei-[\d.]+\.json$/.test(f));

let totalConverted = 0;

for (const file of files) {
    const filePath = path.join(GRADES_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let changed = false;

    for (const item of data) {
        if (!Array.isArray(item.examples)) continue;
        for (const ex of item.examples) {
            if (!Array.isArray(ex.sentences)) continue;
            ex.sentences = ex.sentences.map(s => {
                // すでに移行済みならスキップ
                if (s && typeof s === 'object' && s.id && s.text !== undefined) return s;
                changed = true;
                totalConverted++;
                return { id: newId(), text: typeof s === 'string' ? s : String(s) };
            });
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`✓ ${file} を変換しました`);
    } else {
        console.log(`- ${file} は変換不要（スキップ）`);
    }
}

console.log(`\n完了: ${totalConverted} 件の sentence に ID を付与しました`);
