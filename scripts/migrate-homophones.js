/**
 * scripts/migrate-homophones.js
 *
 * kentei-{grade}.json に含まれる homophones を word-relations.json に集約し、
 * kentei ファイルから homophones フィールドを削除した新しいファイルを出力する。
 *
 * 使い方:
 *   node scripts/migrate-homophones.js --yes
 *   node scripts/migrate-homophones.js --input-dir=js/grades --output-dir=js/grades --yes
 */

const fs = require('fs');
const path = require('path');

function getArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const eqIndex = arg.indexOf('=');
            if (eqIndex > -1) {
                const key = arg.slice(2, eqIndex);
                const value = arg.slice(eqIndex + 1);
                parsed[key] = value;
            } else {
                const key = arg.slice(2);
                const nextArg = args[i + 1];
                if (nextArg && !nextArg.startsWith('--')) {
                    parsed[key] = nextArg;
                    i++;
                } else {
                    parsed[key] = true;
                }
            }
        }
    }
    return parsed;
}

function formatTimestamp(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

const args = getArgs();
const INPUT_DIR = args['input-dir'] || path.join(__dirname, '..', 'js', 'grades');
const OUTPUT_DIR = args['output-dir'] || INPUT_DIR;
const GRADES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10];

const WORD_RELATIONS_PATH = args['word-relations'] || path.join(OUTPUT_DIR, 'word-relations.json');

// --- メイン ---
async function main() {
    const homophonesMap = new Map();
    const processedGrades = [];

    for (const grade of GRADES) {
        const inputPath = path.join(INPUT_DIR, `kentei-${grade}.json`);
        if (!fs.existsSync(inputPath)) {
            console.log(`⏭️ スキップ: ${inputPath} が見つかりません`);
            continue;
        }

        console.log(`📂 処理中: ${inputPath}`);
        const kanjiList = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        if (!Array.isArray(kanjiList)) {
            console.warn(`⚠️ スキップ: ${inputPath} は配列形式ではありません`);
            continue;
        }

        const newList = [];
        for (const item of kanjiList) {
            const { homophones, ...rest } = item;

            if (Array.isArray(homophones) && homophones.length > 0) {
                const existing = homophonesMap.get(item.kanji) || new Set();
                for (const h of homophones) {
                    existing.add(h);
                }
                homophonesMap.set(item.kanji, existing);
            }

            newList.push(rest);
        }

        const outputPath = path.join(OUTPUT_DIR, `kentei-${grade}-nohomo-${formatTimestamp()}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(newList, null, 2));
        console.log(`   → ${outputPath} （homophones 削除済み）`);
        processedGrades.push(grade);
    }

    // 既存の word-relations.json があれば読み込む
    let wordRelations = { antonyms: [], synonyms: [], same_kun: [], homophones: [] };
    if (fs.existsSync(WORD_RELATIONS_PATH)) {
        try {
            wordRelations = JSON.parse(fs.readFileSync(WORD_RELATIONS_PATH, 'utf8'));
        } catch (e) {
            console.warn(`⚠️ 既存 word-relations.json の読み込みに失敗しました: ${e.message}`);
        }
    }

    // ── マージロジック ──────────────────────────────────────────────────
    // 既存の homophones を「手動(_manual:true)」と「自動」に分類する
    const existingEntries = wordRelations.homophones || [];
    const manualMap = new Map(); // kanji → 手動エントリ
    for (const entry of existingEntries) {
        if (entry._manual) {
            manualMap.set(entry.kanji, entry);
        }
    }

    // kentei 由来エントリを生成し、手動エントリとマージする
    // 同じ漢字の手動エントリがある場合は、自動側の漢字リストを手動側にユニオンで追加する
    const mergedEntries = [];
    let autoCount = 0, mergedCount = 0;

    for (const [kanji, autoSet] of homophonesMap) {
        const manual = manualMap.get(kanji);
        if (manual) {
            // 手動エントリを優先し、自動側の漢字を追加（重複除去）
            const merged = new Set([...manual.homophones, ...autoSet]);
            mergedEntries.push({ kanji, homophones: [...merged], _manual: true });
            manualMap.delete(kanji); // 処理済みとしてマークして後で再追加しない
            mergedCount++;
        } else {
            // 自動生成エントリ（_manual なし）
            mergedEntries.push({ kanji, homophones: [...autoSet] });
            autoCount++;
        }
    }

    // kentei に存在しない手動専用エントリをそのまま保持
    let manualOnlyCount = 0;
    for (const entry of manualMap.values()) {
        mergedEntries.push(entry);
        manualOnlyCount++;
    }

    wordRelations.homophones = mergedEntries;

    fs.writeFileSync(WORD_RELATIONS_PATH, JSON.stringify(wordRelations, null, 2));
    console.log(`\n✅ word-relations.json 更新: ${WORD_RELATIONS_PATH}`);
    console.log(`   処理した級: ${processedGrades.join(', ')}`);
    console.log(`   自動生成エントリ: ${autoCount}`);
    console.log(`   手動×自動マージ: ${mergedCount}`);
    console.log(`   手動専用エントリ: ${manualOnlyCount}`);
}

// 確認プロンプト
const skipConfirm = args.yes === true || args.yes === 'true';
if (!skipConfirm) {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    readline.question(
        `\n以下の設定で homophones を移行します。よろしいですか？ (y/n)\n` +
        `  入力ディレクトリ: ${INPUT_DIR}\n` +
        `  出力ディレクトリ: ${OUTPUT_DIR}\n` +
        `  word-relations: ${WORD_RELATIONS_PATH}\n` +
        `> `,
        answer => {
            readline.close();
            if (answer.trim().toLowerCase() === 'y') {
                main().catch(e => { console.error(e); process.exit(1); });
            } else {
                console.log('❌ キャンセルしました');
                process.exit(0);
            }
        }
    );
} else {
    main().catch(e => { console.error(e); process.exit(1); });
}
