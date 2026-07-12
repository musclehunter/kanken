/**
 * scripts/merge-sentences.js
 *
 * sentences-{grade}-{timestamp}.json を読み込み、各語彙の example から
 * examples-{grade}-{timestamp}.json を生成する。
 *
 * 既存の kentei-{grade}.json とは別ファイルに examples を分離し、
 * ソースハッシュ比較により 2回目以降の実行で未変更漢字の examples を再利用する。
 *
 * 使い方:
 *   node scripts/merge-sentences.js --sentences=js/grades/sentences-9-20260711-171953.json --yes
 *   node scripts/merge-sentences.js --sentences=... --force --yes
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- 引数解析 ---
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
const SENTENCES_PATH = args.sentences;
const FORCE_UPDATE = args.force === true || args.force === 'true';

if (!SENTENCES_PATH) {
    console.error('❌ --sentences=sentencesファイルパス を指定してください');
    process.exit(1);
}

if (!fs.existsSync(SENTENCES_PATH)) {
    console.error(`❌ sentences ファイルが見つかりません: ${SENTENCES_PATH}`);
    process.exit(1);
}

// --- ハッシュ計算 ---
function computeSourceHash(kanjiItem) {
    const source = {
        kanji: kanjiItem.kanji,
        kentei_grade: kanjiItem.kentei_grade,
        stroke_count: kanjiItem.stroke_count,
        radical: kanjiItem.radical,
        radical_name: kanjiItem.radical_name,
        on_readings: [...(kanjiItem.on_readings || [])].sort(),
        kun_readings: [...(kanjiItem.kun_readings || [])].sort(),
        meanings: [...(kanjiItem.meanings || [])].sort()
    };
    const normalized = JSON.stringify(source, Object.keys(source).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

// --- 前回ファイル検出 ---
function findPreviousExamplesFile(grade, outDir) {
    const gradeStr = String(grade);
    const pattern = new RegExp(`^examples-${gradeStr.replace('.', '\\.')}-\\d{8}-\\d{6}\\.json$`);
    const files = fs.readdirSync(outDir)
        .filter(f => pattern.test(f))
        .map(f => ({ file: f, mtime: fs.statSync(path.join(outDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? path.join(outDir, files[0].file) : null;
}

// --- examples 変換 ---
function convertToExamples(sentencesItem) {
    const examples = [];

    for (const c of sentencesItem.compounds || []) {
        if (c.word && c.reading && c.example) {
            examples.push({
                word: c.word,
                reading: c.reading,
                sentences: [c.example]
            });
        }
    }

    for (const k of sentencesItem.kun_words || []) {
        if (k.word && k.reading && k.example) {
            examples.push({
                word: k.word,
                reading: k.reading,
                sentences: [k.example]
            });
        }
    }

    // word ごとにユニークにする（重複があれば先頭を採用）
    const seen = new Set();
    return examples.filter(e => {
        if (seen.has(e.word)) return false;
        seen.add(e.word);
        return true;
    });
}

// --- メイン ---
async function main() {
    const sentencesData = JSON.parse(fs.readFileSync(SENTENCES_PATH, 'utf8'));
    const GRADE = sentencesData.grade;

    if (!GRADE) {
        console.error('❌ sentences ファイルに grade が含まれていません');
        process.exit(1);
    }

    const KENTEI_PATH = args.input || path.join(__dirname, '..', 'js', 'grades', `kentei-${GRADE}.json`);
    if (!fs.existsSync(KENTEI_PATH)) {
        console.error(`❌ kentei ファイルが見つかりません: ${KENTEI_PATH}`);
        process.exit(1);
    }

    const kenteiList = JSON.parse(fs.readFileSync(KENTEI_PATH, 'utf8'));
    if (!Array.isArray(kenteiList)) {
        console.error('❌ kentei ファイルは配列形式である必要があります');
        process.exit(1);
    }

    const outDir = path.join(__dirname, '..', 'js', 'grades');
    const DEFAULT_OUTPUT_PATH = path.join(outDir, `examples-${GRADE}-${formatTimestamp()}.json`);
    const OUTPUT_PATH = args.output || DEFAULT_OUTPUT_PATH;

    if (fs.existsSync(OUTPUT_PATH)) {
        console.error(`❌ 出力ファイルが既に存在します。上書きしないため、別の --output を指定するか削除してください: ${OUTPUT_PATH}`);
        process.exit(1);
    }

    // 前回ファイルの特定
    const prevPath = args.prev || findPreviousExamplesFile(GRADE, outDir);
    let prevData = null;
    if (prevPath && fs.existsSync(prevPath)) {
        try {
            prevData = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
            console.log(`📂 前回ファイル: ${prevPath}`);
        } catch (e) {
            console.warn(`⚠️ 前回ファイルの読み込みに失敗しました: ${e.message}`);
        }
    } else {
        console.log('📂 前回ファイル: なし');
    }

    // 確認プロンプト
    const skipConfirm = args.yes === true || args.yes === 'true';
    if (!skipConfirm) {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const answer = await new Promise(resolve => {
            readline.question(
                `\n以下の設定でマージを実行します。よろしいですか？ (y/n)\n` +
                `  級: ${GRADE}\n` +
                `  kentei: ${KENTEI_PATH}\n` +
                `  sentences: ${SENTENCES_PATH}\n` +
                `  出力: ${OUTPUT_PATH}\n` +
                `  前回ファイル: ${prevPath || 'なし'}\n` +
                `  強制更新: ${FORCE_UPDATE ? 'ON' : 'OFF'}\n` +
                `> `,
                resolve
            );
        });
        readline.close();
        if (answer.trim().toLowerCase() !== 'y') {
            console.log('❌ キャンセルしました');
            process.exit(0);
        }
    }

    // sentences データを kanji をキーにしたマップに変換
    const sentencesByKanji = {};
    for (const item of sentencesData.vocab || []) {
        if (item.kanji) {
            sentencesByKanji[item.kanji] = item;
        }
    }

    // 前回 examples を kanji ごとに取得
    const prevExamplesByKanji = {};
    const prevHashesByKanji = {};
    if (prevData) {
        const prevExamples = prevData.examples || {};
        const prevHashes = prevData.source_hashes || {};
        for (const kanji of Object.keys(prevExamples)) {
            prevExamplesByKanji[kanji] = prevExamples[kanji];
        }
        for (const kanji of Object.keys(prevHashes)) {
            prevHashesByKanji[kanji] = prevHashes[kanji];
        }
    }

    const examples = {};
    const sourceHashes = {};
    let total = 0;
    let updated = 0;
    let reused = 0;
    let skipped = 0;

    for (const item of kenteiList) {
        const kanji = item.kanji;
        total++;

        const sourceHash = computeSourceHash(item);
        sourceHashes[kanji] = sourceHash;

        const sentencesItem = sentencesByKanji[kanji];
        const prevHash = prevHashesByKanji[kanji];
        const prevExamples = prevExamplesByKanji[kanji];

        let examplesForKanji;
        if (!sentencesItem) {
            // sentences データがない場合は空配列（完全置き換え）
            examplesForKanji = [];
            skipped++;
        } else if (FORCE_UPDATE || !prevExamples || sourceHash !== prevHash) {
            // 強制更新、または前回データなし、またはソースが変更された場合
            examplesForKanji = convertToExamples(sentencesItem);
            updated++;
        } else {
            // ソース未変更 → 前回の examples を再利用
            examplesForKanji = prevExamples;
            reused++;
        }

        examples[kanji] = examplesForKanji;
    }

    const result = {
        generated_at: new Date().toISOString(),
        grade: GRADE,
        source_kentei: KENTEI_PATH,
        source_sentences: SENTENCES_PATH,
        prev_file: prevPath || null,
        total,
        updated,
        reused,
        skipped,
        source_hashes: sourceHashes,
        examples
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

    console.log(`\n✅ 完了: ${OUTPUT_PATH}`);
    console.log(`   全漢字: ${total}`);
    console.log(`   更新: ${updated}`);
    console.log(`   再利用: ${reused}`);
    console.log(`   sentencesデータなし: ${skipped}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
