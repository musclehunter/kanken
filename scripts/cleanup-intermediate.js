/**
 * scripts/cleanup-intermediate.js
 *
 * 中間生成ファイルを整理する。
 * - kentei-{grade}-nohomo-*.json を削除（内容は kentei-{grade}.json に統合済み）
 * - kentei-{grade}-ja-*.json の古いものを削除し、最新だけ残す
 */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'js', 'grades');
const files = fs.readdirSync(dir);

const grades = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10];
let deleted = 0;
let kept = 0;

for (const grade of grades) {
    const gradeStr = String(grade);
    const escaped = gradeStr.replace('.', '\\.');

    // nohomo ファイルを削除
    const nohomoFiles = files.filter(f => f.match(new RegExp(`^kentei-${escaped}-nohomo-.*\\.json$`)));
    for (const f of nohomoFiles) {
        fs.unlinkSync(path.join(dir, f));
        console.log(`削除: ${f}`);
        deleted++;
    }

    // ja ファイルは最新を残して削除
    const jaFiles = files
        .filter(f => f.match(new RegExp(`^kentei-${escaped}-ja-.*\\.json$`)))
        .sort();
    if (jaFiles.length > 1) {
        const latest = jaFiles[jaFiles.length - 1];
        for (const f of jaFiles.slice(0, -1)) {
            fs.unlinkSync(path.join(dir, f));
            console.log(`削除: ${f}`);
            deleted++;
        }
        console.log(`保持: ${latest}`);
        kept++;
    } else if (jaFiles.length === 1) {
        console.log(`保持: ${jaFiles[0]}`);
        kept++;
    }
}

console.log(`\n完了: ${deleted} ファイル削除、${kept} ファイル保持`);
