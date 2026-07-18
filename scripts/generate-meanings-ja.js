/**
 * scripts/generate-meanings-ja.js
 *
 * kentei-{grade}.json の英語 meanings を読み込み、AI で日本語 meanings (meanings_ja) を追加する。
 * 既存の meanings_ja は維持し、英語 meanings はそのまま残す。
 *
 * 使い方:
 *   node scripts/generate-meanings-ja.js --grade=9 --limit=3 --yes
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// --- 設定読み込み ---
const API_KEY = process.env.LLM_API_KEY_MEANINGS || process.env.LLM_API_KEY_VOCAB || process.env.LLM_API_KEY;
const API_ENDPOINT = process.env.LLM_API_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const IS_RESPONSES_API = API_ENDPOINT.includes('/v1/responses');

let totalInputTokens = 0;
let totalOutputTokens = 0;

if (!API_KEY) {
    console.error('❌ 環境変数 LLM_API_KEY_MEANINGS（または LLM_API_KEY_VOCAB / LLM_API_KEY）を設定してください');
    process.exit(1);
}

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
const GRADE = parseFloat(args.grade || '10');
const INPUT_PATH = args.input || path.join(__dirname, '..', 'js', 'grades', `kentei-${GRADE}.json`);
const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'js', 'grades', `kentei-${GRADE}-ja-${formatTimestamp()}.json`);
const OUTPUT_PATH = args.output || DEFAULT_OUTPUT_PATH;
const SLEEP_MS = parseInt(args.sleep || '500', 10);
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const BATCH_SIZE = parseInt(args['batch-size'] || '1', 10);

// --- プロンプト作成 ---
function buildMeaningsPrompt(kanji, grade, englishMeanings, readings) {
    const gradeText = grade >= 1 && grade <= 10 ? `${grade}級` : String(grade);
    const meaningsText = englishMeanings.join(' / ');
    const readingsText = readings.join(' / ') || '（なし）';

    return `あなたは漢字検定${gradeText}の教材作成者です。
漢字「${kanji}」の英語の意味を参考に、日本語で簡潔な意味を作成してください。

【漢字情報】
- 音読み・訓読み: ${readingsText}
- 英語の意味: ${meaningsText}

【出力条件】
- 漢字検定${gradeText}の学習者にわかりやすい日本語で表現すること
- 単語・熟語単位で1つ以上の簡潔な意味を出力すること
- 各意味は短い名詞句または動詞句にすること（例：「引き寄せる」「引っ張る」「引用する」）
- 以下を含めないこと：
  - 卑猥・性的な語句
  - 暴力・犯罪を助長する語句
  - 自殺・自傷行為に関する語句
  - 差別的・攻撃的な語句

【出力形式（JSON）】
以下のJSON形式で出力してください。
{
  "kanji": "${kanji}",
  "meanings_ja": ["日本語の意味1", "日本語の意味2", "日本語の意味3"]
}
注意：JSON キーは必ず "kanji" と "meanings_ja" にしてください。
`;
}

function buildBatchMeaningsPrompt(items, grade) {
    const gradeText = grade >= 1 && grade <= 10 ? `${grade}級` : String(grade);

    const itemLines = items.map((item, i) => {
        const readings = [...(item.on_readings || []), ...(item.kun_readings || [])].join(' / ') || '（なし）';
        return `${i + 1}. 漢字「${item.kanji}」\n   読み: ${readings}\n   英語の意味: ${(item.meanings || []).join(' / ')}`;
    }).join('\n');

    return `あなたは漢字検定${gradeText}の教材作成者です。
以下の漢字それぞれについて、英語の意味を参考に日本語で簡潔な意味を作成してください。

【出力条件】
- 漢字検定${gradeText}の学習者にわかりやすい日本語で表現すること
- 単語・熟語単位で1つ以上の簡潔な意味を出力すること
- 各意味は短い名詞句または動詞句にすること（例：「引き寄せる」「引っ張る」「引用する」）
- 以下を含めないこと：
  - 卑猥・性的な語句
  - 暴力・犯罪を助長する語句
  - 自殺・自傷行為に関する語句
  - 差別的・攻撃的な語句

【対象漢字】
${itemLines}

【出力形式（JSON）】
以下のJSON形式で出力してください。
{
  "results": [
    { "kanji": "漢字1", "meanings_ja": ["日本語の意味1", "日本語の意味2"] },
    { "kanji": "漢字2", "meanings_ja": ["日本語の意味1", "日本語の意味2"] }
  ]
}
注意：すべての漢字について、入力に含まれる kanji と完全一致する "kanji" フィールドを持つオブジェクトを results 配列に含めてください。順序は問いません。
`;
}

function validateMeanings(kanji, item) {
    const errors = [];
    if (item.kanji !== kanji) {
        errors.push(`kanjiフィールド不一致: ${item.kanji} !== ${kanji}`);
    }
    if (!item.meanings_ja || !Array.isArray(item.meanings_ja) || item.meanings_ja.length === 0) {
        errors.push('meanings_ja が配列でないか空です');
    }
    return { ok: errors.length === 0, errors };
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- メイン ---
async function main() {
    if (!fs.existsSync(INPUT_PATH)) {
        console.error(`❌ 入力ファイルが見つかりません: ${INPUT_PATH}`);
        process.exit(1);
    }

    const kanjiList = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
    if (!Array.isArray(kanjiList)) {
        console.error('❌ 入力ファイルは配列形式である必要があります');
        process.exit(1);
    }

    // meanings_ja が未設定の漢字だけを対象にする
    let targets = kanjiList.filter(k => !k.meanings_ja || k.meanings_ja.length === 0);
    const total = kanjiList.length;
    const alreadyHas = total - targets.length;

    if (LIMIT !== null) {
        targets = targets.slice(0, LIMIT);
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
                `\n以下の設定で日本語 meanings を生成します。よろしいですか？ (y/n)\n` +
                `  級: ${GRADE}\n` +
                `  入力: ${INPUT_PATH}\n` +
                `  全漢字: ${total}件\n` +
                `  既に meanings_ja あり: ${alreadyHas}件\n` +
                `  今回生成対象: ${targets.length}件\n` +
                `  出力: ${OUTPUT_PATH}\n` +
                `  モデル: ${MODEL}\n` +
                `  API: ${IS_RESPONSES_API ? 'Responses API' : 'Chat Completions API'}\n` +
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

    const results = [];
    const failures = [];
    let success = 0;

    async function processSingle(item) {
        const kanji = item.kanji;
        const readings = [...(item.on_readings || []), ...(item.kun_readings || [])];
        const result = await callLLM(buildMeaningsPrompt(kanji, GRADE, item.meanings || [], readings));
        const validation = validateMeanings(kanji, result);
        if (!validation.ok) throw new Error(`検証エラー: ${validation.errors.join(', ')}`);
        return { ...item, meanings_ja: result.meanings_ja };
    }

    async function processBatch(batch) {
        const result = await callLLM(buildBatchMeaningsPrompt(batch, GRADE));
        const items = Array.isArray(result.results) ? result.results : (Array.isArray(result) ? result : []);
        const resultMap = new Map();
        for (const item of items) {
            if (item && item.kanji) resultMap.set(item.kanji, item);
        }

        const batchResults = [];
        const retryItems = [];
        for (const item of batch) {
            const res = resultMap.get(item.kanji);
            if (!res) {
                console.warn(`⚠️ バッチ応答に ${item.kanji} が含まれていないため個別に再試行します`);
                retryItems.push(item);
                continue;
            }
            const validation = validateMeanings(item.kanji, res);
            if (!validation.ok) {
                console.warn(`⚠️ ${item.kanji} のバッチ応答が不正: ${validation.errors.join(', ')}。個別に再試行します`);
                retryItems.push(item);
                continue;
            }
            batchResults.push({ ...item, meanings_ja: res.meanings_ja });
        }

        for (const item of retryItems) {
            try {
                batchResults.push(await processSingle(item));
            } catch (e) {
                console.error(`❌ ${item.kanji}: ${e.message}`);
                failures.push({ kanji: item.kanji, error: e.message });
                batchResults.push({ ...item });
            }
        }
        return batchResults;
    }

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(targets.length / BATCH_SIZE);
        console.log(`[${batchNum}/${totalBatches}] ${batch.map(k => k.kanji).join(' ')}`);

        try {
            if (BATCH_SIZE > 1) {
                const batchResults = await processBatch(batch);
                for (const r of batchResults) {
                    if (r.meanings_ja && r.meanings_ja.length > 0) {
                        results.push(r);
                        success++;
                    } else {
                        failures.push({ kanji: r.kanji, error: 'meanings_ja 未設定' });
                        results.push(r);
                    }
                }
            } else {
                for (const item of batch) {
                    console.log(`[${i + 1}/${targets.length}] ${item.kanji}`);
                    results.push(await processSingle(item));
                    success++;
                }
            }
        } catch (e) {
            console.error(`❌ バッチ ${batchNum} でエラー: ${e.message}`);
            for (const item of batch) {
                try {
                    results.push(await processSingle(item));
                    success++;
                } catch (e2) {
                    console.error(`❌ ${item.kanji}: ${e2.message}`);
                    failures.push({ kanji: item.kanji, error: e2.message });
                    results.push({ ...item });
                }
            }
        }

        if (i + BATCH_SIZE < targets.length) await sleep(SLEEP_MS);
    }

    // 未対象の漢字も結果に含める
    const resultMap = new Map(results.map(k => [k.kanji, k]));
    const outputList = kanjiList.map(k => resultMap.get(k.kanji) || k);

    if (fs.existsSync(OUTPUT_PATH)) {
        console.error(`❌ 出力ファイルが既に存在します。上書きしないため、別の --output を指定するか削除してください: ${OUTPUT_PATH}`);
        process.exit(1);
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputList, null, 2));

    console.log(`\n✅ 完了: ${OUTPUT_PATH}`);
    console.log(`   全漢字: ${total}`);
    console.log(`   今回生成: ${targets.length}`);
    console.log(`   成功: ${success}`);
    console.log(`   失敗: ${failures.length}`);
    console.log(`   既に meanings_ja あり: ${alreadyHas}`);
    console.log(`\n💰 推定トークン消費`);
    console.log(`   入力トークン: ${totalInputTokens}`);
    console.log(`   出力トークン: ${totalOutputTokens}`);
    console.log(`   合計トークン: ${totalInputTokens + totalOutputTokens}`);
    console.log('   備考: 課金はモデルごとの単価 × トークン数で計算してください');

    if (failures.length > 0) {
        console.log('\n⚠️ 失敗した漢字:');
        for (const f of failures) {
            console.log(`   - ${f.kanji}: ${f.error}`);
        }
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
