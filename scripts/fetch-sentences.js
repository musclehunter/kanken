#!/usr/bin/env node
/**
 * fetch-sentences.js
 *
 * Tatoeba Corpus から日本語例文を取得し、単語→例文のインデックスを構築する。
 * 出力: js/grades/tatoeba-sentences.json
 *
 * データソース:
 * - Tatoeba jpn_indices.csv: 注釈付き日本語文 (CC-BY 2.0 FR)
 *   フォーマット: sentence_id\ttranslation_id\tannotated_text
 *   注釈形式: headword(reading){surface} または headword[sense]{surface}
 *   例: は 二十歳(はたち){２０歳} になる[01]{になりました}
 *   → 平文: は ２０歳 になりました
 *   → 単語: 二十歳(surface=２０歳), なる(surface=になりました)
 *
 * 使用法:
 *   node scripts/fetch-sentences.js                    # 全級の例文を取得
 *   node scripts/fetch-sentences.js --words=貧乏,花火   # 特定の単語のみ
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const URLS = {
  jpnIndices: 'https://downloads.tatoeba.org/exports/jpn_indices.csv',
};

const OUT = path.join(__dirname, '..', 'js', 'grades');
const CACHE_DIR = path.join(__dirname, '..', '.cache');

const MAX_SENTENCES_PER_WORD = 5;
const MAX_SENTENCE_LENGTH = 60;
const MIN_SENTENCE_LENGTH = 6;

// -------------------- ユーティリティ --------------------

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (e) => { fs.unlinkSync(dest); reject(e); });
  });
}

/**
 * 注釈付きテキストから平文と単語リストを抽出
 * 例: "は 二十歳(はたち){２０歳} になる[01]{になりました}"
 * → { text: "は２０歳になりました", words: [{headword:"二十歳",surface:"２０歳"}, {headword:"なる",surface:"になりました"}] }
 */
function parseAnnotatedSentence(annotated) {
  const words = [];
  const tokens = annotated.split(' ');
  let text = '';

  for (const token of tokens) {
    if (!token || token === '~') {
      text += ' ';
      continue;
    }

    // パターン1: headword(reading){surface}
    // パターン2: headword[sense]{surface}
    // パターン3: headword{surface}
    // パターン4: headword (注釈なし)
    // ※ バックスラッシュエスケープは除外

    let m;
    // headword(reading){surface} または headword[sense]{surface}
    m = token.match(/^([^\\(\[{]+)(?:\(([^)]*)\)|\[([^\]]*)\])?\{([^}]*)\}$/);
    if (m) {
      const headword = m[1];
      const surface = m[4];
      text += surface;
      if (headword) words.push({ headword, surface });
      continue;
    }

    // headword(reading) または headword[sense] (surfaceなし)
    m = token.match(/^([^\\(\[{]+)(?:\(([^)]*)\)|\[([^\]]*)\])$/);
    if (m) {
      const headword = m[1];
      text += headword;
      if (headword) words.push({ headword, surface: headword });
      continue;
    }

    // headword{surface} (reading/senseなし)
    m = token.match(/^([^\\{]+)\{([^}]*)\}$/);
    if (m) {
      const headword = m[1];
      const surface = m[2];
      text += surface;
      if (headword) words.push({ headword, surface });
      continue;
    }

    // 注釈なしのトークン
    // ~や#を含むトークンは除外しない（そのまま文字として追加）
    if (token === '~') {
      text += ' ';
      continue;
    }
    // 末尾の~を削除
    const cleanToken = token.replace(/~+$/, '');
    text += cleanToken;
    // 漢字を含むトークンは単語として登録
    if (/[\u4e00-\u9fff]/.test(cleanToken)) {
      words.push({ headword: cleanToken, surface: cleanToken });
    }
  }

  text = text.replace(/ /g, '');
  // 残った {...} を除去（パースできなかった注釈）
  text = text.replace(/\{[^}]*\}/g, '');
  // 連続する句読点を整理
  text = text.replace(/~~+/g, '');
  return { text, words };
}

// -------------------- メイン処理 --------------------

async function main() {
  const args = process.argv.slice(2);
  const wordsArg = args.find(a => a.startsWith('--words='));
  const targetWords = wordsArg ? wordsArg.substring(8).split(',').map(w => w.trim()).filter(Boolean) : null;

  // 既存の級データから全例文の単語を収集
  let allExampleWords = new Set();
  if (!targetWords) {
    console.log('既存JSONから例文単語を収集中...');
    for (const fn of fs.readdirSync(OUT)) {
      if (!fn.startsWith('kentei-') || !fn.endsWith('.json')) continue;
      const data = JSON.parse(fs.readFileSync(path.join(OUT, fn), 'utf8'));
      for (const k of data) {
        if (k.examples) {
          for (const ex of k.examples) {
            allExampleWords.add(ex.word);
          }
        }
      }
    }
    console.log(`  → ${allExampleWords.size} 単語`);
  } else {
    allExampleWords = new Set(targetWords);
    console.log(`対象単語: ${targetWords.join(', ')}`);
  }

  // jpn_indices.csvをダウンロード
  console.log('[1/2] jpn_indices.csv ダウンロード中...');
  const csvPath = path.join(CACHE_DIR, 'jpn_indices.csv');
  if (!fs.existsSync(csvPath)) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    await downloadFile(URLS.jpnIndices, csvPath);
  }
  const stat = fs.statSync(csvPath);
  console.log(`  → ${csvPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  // パースして word → [sentence_text] のマッピングを構築
  console.log('[2/2] パース中...');
  const word2sentences = new Map();
  const targetSet = allExampleWords;

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, 'utf8'),
    crlfDelay: Infinity,
  });

  let count = 0;
  for await (const line of rl) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const annotated = parts[2];
    const { text, words } = parseAnnotatedSentence(annotated);

    // 文の長さでフィルタ
    if (text.length < MIN_SENTENCE_LENGTH || text.length > MAX_SENTENCE_LENGTH) continue;
    // 英数字を含む文は除外
    if (/[a-zA-Z0-9]/.test(text)) continue;

    // 単語ごとにインデックスに登録
    for (const w of words) {
      for (const word of [w.headword, w.surface]) {
        if (!targetSet.has(word)) continue;
        if (!word2sentences.has(word)) word2sentences.set(word, []);
        const list = word2sentences.get(word);
        // 重複を除外
        if (list.length < MAX_SENTENCES_PER_WORD && !list.includes(text)) {
          list.push(text);
        }
      }
    }

    count++;
    if (count % 50000 === 0) console.log(`  → ${count} 行処理...`);
  }
  console.log(`  → 合計 ${count} 行処理`);

  // 結果を構築
  const result = {};
  let found = 0, notFound = 0;

  for (const word of allExampleWords) {
    const sentences = word2sentences.get(word) || [];
    if (sentences.length > 0) {
      result[word] = sentences;
      found++;
    } else {
      notFound++;
    }
  }

  console.log(`\n結果: ${found} 単語に例文あり, ${notFound} 単語に例文なし`);

  // 出力
  const outPath = path.join(OUT, 'tatoeba-sentences.json');
  fs.writeFileSync(outPath, JSON.stringify(result));
  console.log(`→ ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(e => { console.error('エラー:', e); process.exit(1); });
