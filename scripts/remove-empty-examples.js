/**
 * scripts/remove-empty-examples.js
 *
 * 全級の kentei-{grade}.json から、sentences が空または存在しない example エントリを削除する。
 * 変更前に自動でバックアップを作成する。
 *
 * 使い方:
 *   node scripts/remove-empty-examples.js [--yes]
 */

const fs = require('fs');
const path = require('path');

const grades = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10];
const gradesDir = path.join(__dirname, '..', 'js', 'grades');
const backupsDir = path.join(__dirname, '..', 'js', 'grades', 'backups');

function formatTimestamp(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function hasSentences(ex) {
    return Array.isArray(ex.sentences) && ex.sentences.length > 0 && ex.sentences.some(s => typeof s === 'string' && s.trim().length > 0);
}

async function main() {
    const args = process.argv.slice(2);
    const skipConfirm = args.includes('--yes');

    let totalRemoved = 0;
    const changes = [];

    for (const grade of grades) {
        const filePath = path.join(gradesDir, `kentei-${grade}.json`);
        if (!fs.existsSync(filePath)) continue;

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let removedForGrade = 0;

        for (const item of data) {
            if (!Array.isArray(item.examples)) continue;
            const before = item.examples.length;
            item.examples = item.examples.filter(hasSentences);
            const after = item.examples.length;
            removedForGrade += before - after;
        }

        if (removedForGrade > 0) {
            totalRemoved += removedForGrade;
            changes.push({ grade, removed: removedForGrade });
        }
    }

    if (totalRemoved === 0) {
        console.log('✅ sentences がない example は見つかりませんでした');
        return;
    }

    console.log('以下のファイルから example を削除します:');
    for (const c of changes) {
        console.log(`  grade ${c.grade}: ${c.removed} 件`);
    }
    console.log(`合計: ${totalRemoved} 件`);

    if (!skipConfirm) {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const answer = await new Promise(resolve => {
            readline.question('実行しますか？ (y/n) > ', resolve);
        });
        readline.close();
        if (answer.trim().toLowerCase() !== 'y') {
            console.log('❌ キャンセルしました');
            process.exit(0);
        }
    }

    // バックアップ作成
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
    const timestamp = formatTimestamp();

    for (const c of changes) {
        const filePath = path.join(gradesDir, `kentei-${c.grade}.json`);
        const backupPath = path.join(backupsDir, `kentei-${c.grade}-before-remove-empty-${timestamp}.json`);
        fs.copyFileSync(filePath, backupPath);
        console.log(`  バックアップ: ${backupPath}`);

        // 実際に書き込み
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const item of data) {
            if (Array.isArray(item.examples)) {
                item.examples = item.examples.filter(hasSentences);
            }
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    console.log(`\n✅ 完了: ${totalRemoved} 件の example を削除しました`);
    console.log(`   バックアップ: ${backupsDir}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
