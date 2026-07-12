/**
 * scripts/generate-vocab.js
 *
 * 対象漢字について、AIを使って熟語・訓読み語彙リストを生成する。
 * 生成後は必ず「対象漢字を含む」「漢検に適する」ことを検証する。
 *
 * 使い方:
 *   LLM_API_KEY=xxx LLM_API_ENDPOINT=https://... node scripts/generate-vocab.js --grade=10 --input=./js/grades/kentei-10.json --output=./js/grades/vocab-10.json
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// --- 設定読み込み ---
// 語彙生成専用のAPIキー。未設定の場合は汎用 LLM_API_KEY をフォールバック
const API_KEY = process.env.LLM_API_KEY_VOCAB || process.env.LLM_API_KEY;
const API_ENDPOINT = process.env.LLM_API_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// コスト追跡用
let totalInputTokens = 0;
let totalOutputTokens = 0;

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
const GRADE = parseFloat(args.grade || '10');
const INPUT_PATH = args.input || path.join(__dirname, '..', 'js', 'grades', `kentei-${GRADE}.json`);
const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'js', 'grades', `vocab-${GRADE}-${formatTimestamp()}.json`);
const OUTPUT_PATH = args.output || DEFAULT_OUTPUT_PATH;
const SLEEP_MS = parseInt(args.sleep || '500', 10);
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const IS_RESPONSES_API = API_ENDPOINT.includes('/v1/responses');

if (!API_KEY) {
    console.error('❌ 環境変数 LLM_API_KEY_VOCAB（または LLM_API_KEY）を設定してください');
    process.exit(1);
}

// --- プロンプト作成 ---
function buildVocabPrompt(kanji, grade, additionalInfo = {}) {
    const gradeText = grade >= 1 && grade <= 10
        ? `${grade}級`
        : String(grade);

    return `あなたは漢字検定${gradeText}の教材作成者です。
漢字「${kanji}」に対して、以下の条件を満たす語彙リストをJSONで出力してください。

【出力条件】
- 出力する各単語には必ず漢字「${kanji}」が含まれること
- 実在する日本語の単語・用法にすること
- 漢字検定${gradeText}に適した難易度であること
- 以下を**含めない**こと：
  - 卑猥・性的な語句
  - 暴力・犯罪を助長する語句
  - 自殺・自傷行為に関する語句
  - 差別的・攻撃的な語句
  - 過度にネガティブ・トラウマを誘発する語句
  - 児童には不適切な内容を含む語句
  - 極めてマイナーで実用性が低い古語や廃語
  - 読み方が著しく紛らわしく、学習者を混乱させるもの（意図的な同音異義を除く）

【出力形式】
{
  "kanji": "${kanji}",
  "compounds": [
    { "word": "熟語1", "reading": "じゅくご1", "meaning": "簡潔な意味" },
    { "word": "熟語2", "reading": "じゅくご2", "meaning": "簡潔な意味" }
  ],
  "kun_words": [
    { "word": "訓読みの語1", "reading": "くんよみ1", "meaning": "簡潔な意味", "pos": "動詞/名詞/形容詞など" },
    { "word": "訓読みの語2", "reading": "くんよみ2", "meaning": "簡潔な意味", "pos": "動詞/名詞/形容詞など" }
  ],
  "notes": "特記事項があれば記述（例: 漢検では主にOOの意味で出題）"
}

【数の目安】
- 熟語: 2〜4個
- 訓読み語彙: 1〜3個
- 訓読みは「〜る」「〜む」「〜い」などの送り仮名を含んだ形で出力してください
- 生成する語彙は、後から作る例文や問題で自然に使えるものを選ぶこと

追加情報: ${JSON.stringify(additionalInfo)}
`;
}

// --- LLM呼び出し ---
async function callLLM(prompt) {
    const isResponses = IS_RESPONSES_API;

    let body;
    if (isResponses) {
        body = {
            model: MODEL,
            input: [{ role: 'user', content: prompt }],
            text: { format: { type: 'json_object' } }
        };
    } else {
        body = {
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        };
    }

    const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error: ${res.status} ${res.statusText}\n${text}`);
    }

    const data = await res.json();
    let content;
    let usage;

    if (isResponses) {
        // OpenAI Responses API format
        const output = data.output?.find(o => o.type === 'message' && o.role === 'assistant');
        const textItem = output?.content?.find(c => c.type === 'output_text');
        content = textItem?.text;
        usage = data.usage;
    } else {
        // OpenAI Chat Completions API format
        const choice = data.choices?.[0];
        content = choice?.message?.content;
        usage = data.usage;
    }

    if (!content) {
        throw new Error('LLM response did not contain content');
    }

    if (usage) {
        totalInputTokens += usage.input_tokens || usage.prompt_tokens || 0;
        totalOutputTokens += usage.output_tokens || usage.completion_tokens || 0;
    }

    return JSON.parse(content);
}

// --- 検証 ---
function validateVocab(kanji, item) {
    const errors = [];

    if (item.kanji !== kanji) {
        errors.push(`kanjiフィールド不一致: ${item.kanji} !== ${kanji}`);
    }

    const allWords = [
        ...(item.compounds || []).map(c => c.word),
        ...(item.kun_words || []).map(w => w.word)
    ];

    for (const word of allWords) {
        if (!word.includes(kanji)) {
            errors.push(`対象漢字を含まない語: ${word}`);
        }
    }

    const mandatoryNGPatterns = [
        /セックス|性交|性行為|AV|ポルノ|勃起|淫乱|姦/,
        /殺人|殺害|強盗|誘拐|レイプ|犯罪|自殺|死ね|死に/,
        / retard| 白痴| バカ| アホ| デブ| キチガイ| ハゲ/,
    ];

    const allText = JSON.stringify(item);
    for (const pattern of mandatoryNGPatterns) {
        if (pattern.test(allText)) {
            errors.push(`不適切な表現が検出されました: ${pattern}`);
        }
    }

    return {
        ok: errors.length === 0,
        errors
    };
}

// --- ユーティリティ ---
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- メイン ---
async function main() {
    if (!fs.existsSync(INPUT_PATH)) {
        console.error(`❌ 入力ファイルが見つかりません: ${INPUT_PATH}`);
        process.exit(1);
    }

    // API呼び出し前の設定確認
    const skipConfirm = args.yes === true || args.yes === 'true';
    if (!skipConfirm) {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const answer = await new Promise(resolve => {
            readline.question(
                `\n以下の設定でAPIを呼び出します。よろしいですか？ (y/n)\n` +
                `  級: ${GRADE}\n` +
                `  入力: ${INPUT_PATH}\n` +
                `  出力: ${OUTPUT_PATH}\n` +
                `  モデル: ${MODEL}\n` +
                `  エンドポイント: ${IS_RESPONSES_API ? 'Responses API' : 'Chat Completions API'}\n` +
                `  処理件数: ${LIMIT && LIMIT > 0 ? `${LIMIT}件（limitあり）` : '全件'}\n` +
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

    if (fs.existsSync(OUTPUT_PATH)) {
        console.error(`❌ 出力ファイルが既に存在します。上書きしないため、別の --output を指定するか削除してください: ${OUTPUT_PATH}`);
        process.exit(1);
    }

    let kanjiList = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
    const totalInput = kanjiList.length;

    if (LIMIT && LIMIT > 0) {
        kanjiList = kanjiList.slice(0, LIMIT);
        console.log(`📚 入力: ${INPUT_PATH} (全${totalInput}件 / 今回処理${kanjiList.length}件 / limit=${LIMIT})`);
    } else {
        console.log(`📚 入力: ${INPUT_PATH} (${kanjiList.length}件)`);
    }
    console.log(`🤖 使用モデル: ${MODEL}`);
    console.log(`🔗 使用エンドポイント: ${IS_RESPONSES_API ? 'Responses API' : 'Chat Completions API'}`);
    console.log(`📤 出力: ${OUTPUT_PATH}`);

    const results = [];
    const failures = [];

    for (let i = 0; i < kanjiList.length; i++) {
        const entry = kanjiList[i];
        const kanji = entry.kanji;
        const additionalInfo = {
            grade: entry.kentei_grade,
            on: entry.on_readings,
            kun: entry.kun_readings,
            meanings: entry.meanings
        };

        console.log(`\n[${i + 1}/${kanjiList.length}] ${kanji}`);

        try {
            const prompt = buildVocabPrompt(kanji, GRADE, additionalInfo);
            const vocab = await callLLM(prompt);
            const validation = validateVocab(kanji, vocab);

            if (!validation.ok) {
                console.warn(`⚠️ 検証失敗: ${validation.errors.join(', ')}`);
                failures.push({ kanji, reason: validation.errors.join('; ') });
                continue;
            }

            results.push({
                ...vocab,
                source_kanji_data: {
                    on_readings: entry.on_readings,
                    kun_readings: entry.kun_readings,
                    meanings: entry.meanings,
                    radical_name: entry.radical_name
                }
            });
            console.log(`✅ ${kanji}: compounds=${vocab.compounds?.length || 0}, kun=${vocab.kun_words?.length || 0}`);
        } catch (e) {
            console.error(`❌ ${kanji}: ${e.message}`);
            failures.push({ kanji, reason: e.message });
        }

        if (i < kanjiList.length - 1) {
            await sleep(SLEEP_MS);
        }
    }

    // 出力ディレクトリ確認
    const outDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const totalSuccess = results.length;
    const totalFailures = failures.length;

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
        generated_at: new Date().toISOString(),
        model: MODEL,
        grade: GRADE,
        total: totalInput,
        processed: totalSuccess + totalFailures,
        success: totalSuccess,
        failures: totalFailures,
        usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens
        },
        vocab: results,
        failures_detail: failures
    }, null, 2));

    console.log(`\n🎉 完了: ${totalSuccess}/${kanjiList.length}件成功`);
    if (totalFailures > 0) {
        console.log(`⚠️ 失敗: ${totalFailures}件`);
    }
    console.log(`\n💰 推定トークン消費`);
    console.log(`   入力トークン: ${totalInputTokens.toLocaleString()}`);
    console.log(`   出力トークン: ${totalOutputTokens.toLocaleString()}`);
    console.log(`   合計トークン: ${(totalInputTokens + totalOutputTokens).toLocaleString()}`);
    console.log(`   備考: 課金はモデルごとの単価 × トークン数で計算してください`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
