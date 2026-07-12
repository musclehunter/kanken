/**
 * scripts/generate-sentences.js
 *
 * 語彙リスト（vocab-{grade}-{timestamp}.json）を読み込み、
 * 各熟語・訓読み語彙に対して短い例文を生成する。
 * 漢字1文字ずつAPIを呼び出し、コストと品質を管理する。
 *
 * 使い方:
 *   node scripts/generate-sentences.js --vocab=./js/grades/vocab-9-20260711-165613.json --limit=2 --yes
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// --- 設定読み込み ---
// 短文生成専用のAPIキー。未設定の場合は汎用 LLM_API_KEY をフォールバック
const API_KEY = process.env.LLM_API_KEY_SENTENCE || process.env.LLM_API_KEY;
const API_ENDPOINT = process.env.LLM_API_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const IS_RESPONSES_API = API_ENDPOINT.includes('/v1/responses');

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
const VOCAB_PATH = args.vocab;
let GRADE = args.grade ? parseFloat(args.grade) : null;
const SLEEP_MS = parseInt(args.sleep || '500', 10);
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;

// 後で語彙ファイルから grade を推定するため、OUTPUT_PATH の確定は main 内で行う

if (!API_KEY) {
    console.error('❌ 環境変数 LLM_API_KEY_SENTENCE（または LLM_API_KEY）を設定してください');
    process.exit(1);
}

if (!VOCAB_PATH) {
    console.error('❌ --vocab=語彙JSONパス を指定してください');
    process.exit(1);
}

// --- プロンプト作成 ---
function buildSentencePrompt(kanji, grade, compounds, kunWords) {
    const gradeText = grade >= 1 && grade <= 10 ? `${grade}級` : String(grade);

    const compoundLines = (compounds || []).map((c, i) => `${i + 1}. ${c.word}（${c.reading}）: ${c.meaning}`).join('\n');
    const kunLines = (kunWords || []).map((k, i) => `${i + 1}. ${k.word}（${k.reading}）: ${k.meaning}【品詞: ${k.pos || '不明'}】`).join('\n');

    return `あなたは漢字検定${gradeText}の教材作成者です。
漢字「${kanji}」の以下の語彙に対して、短い例文を作ってください。

【出力条件】
- 各例文には必ず対象の単語が含まれること
- 実在する日本語の自然な短文であること
- 漢字検定${gradeText}に適した難易度であること
- 各例文は**10〜15文字程度**で自然に収めること
  - どうしても短くしきれない場合は、15文字をやや超えても構いません
  - ただし無理に短くせず、自然な日本語であることを優先してください
- 以下を**含めない**こと：
  - 卑猥・性的な語句
  - 暴力・犯罪を助長する語句
  - 自殺・自傷行為に関する語句
  - 差別的・攻撃的な語句
  - 過度にネガティブ・トラウマを誘発する語句
  - 児童には不適切な内容を含む語句

【対象語彙】
熟語:
${compoundLines || '（なし）'}

訓読み語彙:
${kunLines || '（なし）'}

【出力形式（JSON）】
以下のJSON形式で出力してください。
{
  "kanji": "${kanji}",
  "compounds": [
    { "word": "熟語1", "reading": "じゅくご1", "meaning": "簡潔な意味", "example": "10〜15文字程度の例文" },
    { "word": "熟語2", "reading": "じゅくご2", "meaning": "簡潔な意味", "example": "10〜15文字程度の例文" }
  ],
  "kun_words": [
    { "word": "訓読みの語1", "reading": "くんよみ1", "meaning": "簡潔な意味", "pos": "品詞", "example": "10〜15文字程度の例文" },
    { "word": "訓読みの語2", "reading": "くんよみ2", "meaning": "簡潔な意味", "pos": "品詞", "example": "10〜15文字程度の例文" }
  ]
}

注意：入力に含まれる word / reading / meaning / pos は必ず保持し、example フィールドだけ追加してください。
`;
}

// --- LLM呼び出し ---
async function callLLM(prompt) {
    let body;
    if (IS_RESPONSES_API) {
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

    if (IS_RESPONSES_API) {
        const output = data.output?.find(o => o.type === 'message' && o.role === 'assistant');
        const textItem = output?.content?.find(c => c.type === 'output_text');
        content = textItem?.text;
        usage = data.usage;
    } else {
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
// 例文の長さ制限（文字数は句読点・空白を除く日本語/英数字文字でカウント）
const TARGET_EXAMPLE_LENGTH = 15;
const MAX_EXAMPLE_LENGTH = 20;

// 不適切表現の簡易フィルタ（暴力的・性的・差別的な語句を含む）
const INAPPROPRIATE_KEYWORDS = [
    '死', '殺', '自殺', '死体', '遺体', '死骸', '自害', '心中',
    ' sex', 'sexual', 'セックス', 'エッチ', 'h', 'セクハラ', '猥褻', '淫乱', '痴漢', '性的',
    'レイプ', '強姦', '陵辱', '猥談', '下半身', '性的暴行',
    '差別', '人種差別', 'ヘイト', 'ナチ', 'ホロコースト', 'ユダヤ',
    '暴力', '暴行', '殴', '殺害', '犯罪', '盗', '窃盗', '強盗', '薬物',
    '麻薬', '覚醒剤', 'コカイン', '大麻', 'ヘロイン', '毒',
    '自傷', '傷つける', '自虐', '切り傷', '流血',
    'トラウマ', '虐待', '児童虐待', '性的虐待'
];

function countChars(str) {
    // 句読点・空白・記号を除いた文字数をカウント
    return (str || '').replace(/[\s\n\r\t、。！？「」『』（）［］【】・･,\.!?\[\]\(\)\{\}"']/g, '').length;
}

function checkExampleContent(example) {
    const lower = (example || '').toLowerCase();
    const found = INAPPROPRIATE_KEYWORDS.filter(kw => example.includes(kw) || lower.includes(kw.toLowerCase()));
    return { ok: found.length === 0, keywords: found };
}

function checkExampleLength(example) {
    const len = countChars(example);
    return { len, ok: len <= MAX_EXAMPLE_LENGTH, targetOk: len >= 5 && len <= TARGET_EXAMPLE_LENGTH };
}

function validateSentences(kanji, original, generated) {
    const errors = [];
    const warnings = [];

    if (generated.kanji !== kanji) {
        errors.push(`kanji mismatch: expected ${kanji}, got ${generated.kanji}`);
    }

    const checkItems = (origItems, genItems, label) => {
        if (!Array.isArray(genItems)) {
            errors.push(`${label} is not an array`);
            return;
        }
        if (genItems.length !== (origItems || []).length) {
            errors.push(`${label} count mismatch`);
            return;
        }
        for (let i = 0; i < genItems.length; i++) {
            const orig = origItems[i];
            const gen = genItems[i];
            if (gen.word !== orig.word) {
                errors.push(`${label}[${i}] word changed from ${orig.word} to ${gen.word}`);
            }
            if (!gen.example || typeof gen.example !== 'string') {
                errors.push(`${label}[${i}] ${orig.word} missing example`);
            } else {
                if (!gen.example.includes(orig.word)) {
                    errors.push(`${label}[${i}] ${orig.word} example does not contain word`);
                }
                const lengthCheck = checkExampleLength(gen.example);
                if (!lengthCheck.ok) {
                    errors.push(`${label}[${i}] ${orig.word} example too long (${lengthCheck.len} chars > ${MAX_EXAMPLE_LENGTH})`);
                } else if (!lengthCheck.targetOk) {
                    warnings.push(`${label}[${i}] ${orig.word} example length ${lengthCheck.len} is outside target 5-${TARGET_EXAMPLE_LENGTH}`);
                }
                const contentCheck = checkExampleContent(gen.example);
                if (!contentCheck.ok) {
                    errors.push(`${label}[${i}] ${orig.word} example contains inappropriate keyword: ${contentCheck.keywords.join(', ')}`);
                }
            }
        }
    };

    checkItems(original.compounds, generated.compounds, 'compounds');
    checkItems(original.kun_words, generated.kun_words, 'kun_words');

    return { ok: errors.length === 0, errors, warnings };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- メイン ---
async function main() {
    if (!fs.existsSync(VOCAB_PATH)) {
        console.error(`❌ 語彙ファイルが見つかりません: ${VOCAB_PATH}`);
        process.exit(1);
    }

    const vocabData = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));

    // 級を推定（引数 > 語彙ファイル > デフォルト10）
    if (!GRADE) {
        GRADE = vocabData.grade || 10;
    }

    const outputPath = args.output || path.join(__dirname, '..', 'js', 'grades', `sentences-${GRADE}-${formatTimestamp()}.json`);

    if (fs.existsSync(outputPath)) {
        console.error(`❌ 出力ファイルが既に存在します。上書きしないため、別の --output を指定するか削除してください: ${outputPath}`);
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
                `  語彙ファイル: ${VOCAB_PATH}\n` +
                `  級: ${GRADE}\n` +
                `  出力: ${outputPath}\n` +
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
    let vocabList = vocabData.vocab || [];
    const totalInput = vocabList.length;

    if (LIMIT && LIMIT > 0) {
        vocabList = vocabList.slice(0, LIMIT);
        console.log(`📚 語彙ファイル: ${VOCAB_PATH} (全${totalInput}件 / 今回処理${vocabList.length}件 / limit=${LIMIT})`);
    } else {
        console.log(`📚 語彙ファイル: ${VOCAB_PATH} (${vocabList.length}件)`);
    }
    console.log(`🤖 使用モデル: ${MODEL}`);
    console.log(`🔗 使用エンドポイント: ${IS_RESPONSES_API ? 'Responses API' : 'Chat Completions API'}`);
    console.log(`📤 出力: ${outputPath}`);

    const results = [];
    const failures = [];
    const warnings = [];

    for (let i = 0; i < vocabList.length; i++) {
        const item = vocabList[i];
        const kanji = item.kanji;

        console.log(`\n[${i + 1}/${vocabList.length}] ${kanji}`);

        try {
            const prompt = buildSentencePrompt(kanji, GRADE, item.compounds, item.kun_words);
            const generated = await callLLM(prompt);
            const validation = validateSentences(kanji, item, generated);

            if (validation.warnings.length > 0) {
                console.warn(`⚠️ 警告: ${validation.warnings.join(', ')}`);
                warnings.push({ kanji, warnings: validation.warnings });
            }

            if (!validation.ok) {
                console.warn(`❌ 検証失敗: ${validation.errors.join(', ')}`);
                failures.push({ kanji, reason: validation.errors.join('; ') });
                continue;
            }

            // 元データを保持しつつ、生成結果の example をマージ
            results.push({
                ...item,
                compounds: mergeExamples(item.compounds, generated.compounds),
                kun_words: mergeExamples(item.kun_words, generated.kun_words)
            });
            console.log(`✅ ${kanji}: compounds=${item.compounds?.length || 0}, kun=${item.kun_words?.length || 0}`);
        } catch (e) {
            console.error(`❌ ${kanji}: ${e.message}`);
            failures.push({ kanji, reason: e.message });
        }

        if (i < vocabList.length - 1) {
            await sleep(SLEEP_MS);
        }
    }

    // 出力ディレクトリ確認
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const totalSuccess = results.length;
    const totalFailures = failures.length;
    const totalWarnings = warnings.length;

    fs.writeFileSync(outputPath, JSON.stringify({
        generated_at: new Date().toISOString(),
        model: MODEL,
        grade: GRADE,
        source_vocab: VOCAB_PATH,
        total: totalInput,
        success: totalSuccess,
        failures: totalFailures,
        warnings: totalWarnings,
        usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens
        },
        vocab: results,
        failures_detail: failures,
        warnings_detail: warnings
    }, null, 2));

    console.log(`\n🎉 完了: ${totalSuccess}/${vocabList.length}件成功`);
    if (totalFailures > 0) {
        console.log(`❌ 失敗: ${totalFailures}件`);
    }
    if (totalWarnings > 0) {
        console.log(`⚠️ 警告: ${totalWarnings}件`);
    }
    console.log(`\n💰 推定トークン消費`);
    console.log(`   入力トークン: ${totalInputTokens.toLocaleString()}`);
    console.log(`   出力トークン: ${totalOutputTokens.toLocaleString()}`);
    console.log(`   合計トークン: ${(totalInputTokens + totalOutputTokens).toLocaleString()}`);
    console.log(`   備考: 課金はモデルごとの単価 × トークン数で計算してください`);
}

function mergeExamples(originalItems, generatedItems) {
    if (!Array.isArray(originalItems) || !Array.isArray(generatedItems)) {
        return originalItems;
    }
    return originalItems.map((orig, i) => {
        const gen = generatedItems[i];
        return gen && gen.example ? { ...orig, example: gen.example } : orig;
    });
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
