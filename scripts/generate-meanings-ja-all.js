/**
 * scripts/generate-meanings-ja-all.js
 *
 * 全級の kentei-{grade}.json に対して generate-meanings-ja.js を順に実行する。
 * 既に meanings_ja がすべて埋まっている級はスキップする。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const grades = [10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2, 1.5, 1];
const dir = path.join(__dirname, '..', 'js', 'grades');

function runForGrade(grade) {
    const inputPath = path.join(dir, `kentei-${grade}.json`);
    if (!fs.existsSync(inputPath)) {
        console.log(`⏭️ grade ${grade}: ファイルが見つかりません`);
        return;
    }

    const list = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const remaining = list.filter(k => !k.meanings_ja || k.meanings_ja.length === 0).length;
    if (remaining === 0) {
        console.log(`✅ grade ${grade}: 既に meanings_ja 済み`);
        return;
    }

    console.log(`\n🚀 grade ${grade}: ${remaining} 件の meanings_ja を生成します`);
    const result = spawnSync(
        'node',
        ['scripts/generate-meanings-ja.js', `--grade=${grade}`, '--batch-size=10', '--sleep=100', '--yes'],
        { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
    );

    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    if (result.status !== 0) {
        console.error(`❌ grade ${grade} でエラーが発生しました`);
        process.exit(result.status || 1);
    }

    // 最新の ja ファイルを元の kentei ファイルにコピー
    const jaFiles = fs.readdirSync(dir)
        .filter(f => f.match(new RegExp(`^kentei-${String(grade).replace('.', '\\\\.')}-ja-.*\\\\.json$`)))
        .sort()
        .reverse();
    if (jaFiles.length > 0) {
        const latest = path.join(dir, jaFiles[0]);
        fs.copyFileSync(latest, inputPath);
        console.log(`   ${jaFiles[0]} -> kentei-${grade}.json`);
    }
}

for (const grade of grades) {
    runForGrade(grade);
}

console.log('\n🎉 全級の処理が完了しました');
