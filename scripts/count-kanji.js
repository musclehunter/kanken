const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'js', 'grades');
const grades = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10];
let total = 0;

for (const g of grades) {
    const list = JSON.parse(fs.readFileSync(path.join(dir, `kentei-${g}.json`), 'utf8'));
    const withoutMeaningsJa = list.filter(k => !k.meanings_ja || k.meanings_ja.length === 0).length;
    total += list.length;
    console.log(`grade ${g}: ${list.length} 件 （meanings_ja 未設定: ${withoutMeaningsJa} 件）`);
}
console.log(`total: ${total} 件`);
