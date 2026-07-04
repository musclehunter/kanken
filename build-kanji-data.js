#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const SRC = {
  kentei: 'https://raw.githubusercontent.com/mimneko/kanji-data/main/漢検漢字辞典漢字.csv',
  bushu: 'https://raw.githubusercontent.com/mimneko/kanji-data/main/部首一覧.csv',
  k2r: 'https://raw.githubusercontent.com/yagays/kanjivg-radical/master/data/kanji2radical.json',
  kanjiAPI: 'https://kanjiapi.dev/v1/kanji/',
  wordsAPI: 'https://kanjiapi.dev/v1/words/',
  jmdict: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
  kanjidic2: 'http://www.edrdg.org/kanjidic/kanjidic2.xml.gz'
};
const OUT = path.join(__dirname, 'js', 'grades');
const GRADE_MAP = { '10級':10,'9級':9,'8級':8,'7級':7,'6級':6,'5級':5,'4級':4,'3級':3,'準2級':2.5,'2級':2,'準1級':1.5,'1級':1,'1/準1級':1.5 };
const CONCURRENCY = 5;
const DELAY_MS = 150;

// variant/simplified radical form -> {standard form for lookup, display name}
const RADICAL_VARIANTS = {
  '扌': {std:'手', name:'てへん'},
  '氵': {std:'水', name:'さんずい'},
  '忄': {std:'心', name:'りっしんべん'},
  '犭': {std:'犬', name:'けものへん'},
  '⺌': {std:'小', name:'しょうがしら'},
  '⺕': {std:'彑', name:'いのこがしら'},
  '⺡': {std:'水', name:'さんずい'},
  '⺢': {std:'水', name:'さんずい'},
  '⺣': {std:'火', name:'れんががしら'},
  '⺤': {std:'爪', name:'つめがしら'},
  '⺥': {std:'父', name:'ちちがしら'},
  '⺦': {std:'爻', name:'こうがしら'},
  '⺧': {std:'爿', name:'しょうへん'},
  '⺨': {std:'片', name:'かたへん'},
  '⺫': {std:'癶', name:'はつがしら'},
  '⺬': {std:'白', name:'しろがしら'},
  '⺭': {std:'示', name:'しめすへん'},
  '⺮': {std:'竹', name:'たけがしら'},
  '⺯': {std:'米', name:'こめへん'},
  '⺰': {std:'糸', name:'いとへん'},
  '⺱': {std:'缶', name:'ほとぎへん'},
  '⺲': {std:'羊', name:'ひつじがしら'},
  '⺳': {std:'网', name:'あみがしら'},
  '⺴': {std:'羽', name:'はねがしら'},
  '⺵': {std:'老', name:'おいかんむり'},
  '⺶': {std:'羊', name:'ひつじがしら'},
  '⺷': {std:'羊', name:'ひつじがしら'},
  '⺸': {std:'耒', name:'すきへん'},
  '⺹': {std:'老', name:'おいかんむり'},
  '⺺': {std:'臣', name:'しんがみへん'},
  '⺻': {std:'臼', name:'うすがしら'},
  '⺼': {std:'舌', name:'したへん'},
  '⺽': {std:'舟', name:'ふねへん'},
  '⺾': {std:'艮', name:'こんがしら'},
  '⺿': {std:'色', name:'いろへん'},
  '⻀': {std:'艸', name:'くさかんむり'},
  '⻁': {std:'虍', name:'とらがしら'},
  '⻂': {std:'虫', name:'むしへん'},
  '⻃': {std:'血', name:'ちへん'},
  '⻄': {std:'行', name:'ゆきがまえ'},
  '⻅': {std:'衣', name:'ころもへん'},
  '⻆': {std:'襾', name:'にし'},
  '⻇': {std:'見', name:'みるへん'},
  '⻈': {std:'角', name:'かくへん'},
  '⻉': {std:'言', name:'ごんべん'},
  '⻊': {std:'谷', name:'たにへん'},
  '⻋': {std:'豆', name:'まめへん'},
  '⻌': {std:'辵', name:'しんにょう'},
  '⻍': {std:'豸', name:'むじなへん'},
  '⻎': {std:'貝', name:'かいへん'},
  '⻐': {std:'走', name:'そうしんにょう'},
  '⻑': {std:'足', name:'あしへん'},
  '⻒': {std:'身', name:'みへん'},
  '⻓': {std:'車', name:'くるまへん'},
  '⻔': {std:'辛', name:'からいへん'},
  '⻕': {std:'辰', name:'たつがしら'},
  '⻗': {std:'邑', name:'おおざとへん'},
  '⻘': {std:'酉', name:'とりへん'},
  '⻙': {std:'采', name:'とるへん'},
  '⻚': {std:'里', name:'さとへん'},
  '⻛': {std:'金', name:'かねへん'},
  '⻜': {std:'長', name:'ながいへん'},
  '⻝': {std:'門', name:'もんがまえ'},
  '⻞': {std:'阜', name:'こざとへん'},
  '⻟': {std:'隹', name:'ふるとりへん'},
  '⻠': {std:'雨', name:'あめかんむり'},
  '⻡': {std:'青', name:'あおがしら'},
  '⻢': {std:'非', name:'ひしりがみ'},
  '⻣': {std:'面', name:'めんがしら'},
  '⻤': {std:'革', name:'かわへん'},
  '⻥': {std:'韋', name:'なめしがわへん'},
  '⻦': {std:'韭', name:'にらへん'},
  '⻧': {std:'音', name:'おとへん'},
  '⻨': {std:'頁', name:'おおがいへん'},
  '⻩': {std:'風', name:'かぜがしら'},
  '⻪': {std:'飛', name:'ひかんむり'},
  '⻫': {std:'食', name:'しょくへん'},
  '⻬': {std:'首', name:'くびへん'},
  '⻭': {std:'香', name:'かおりがしら'},
  '⻮': {std:'馬', name:'うまへん'},
  '⻯': {std:'骨', name:'ほねへん'},
  '⻰': {std:'高', name:'たかいがしら'},
  '⻱': {std:'髟', name:'かみがしら'},
  '⻲': {std:'鬥', name:'とうがまえ'},
  '⻳': {std:'鬯', name:'ちょうへん'},
  '⻴': {std:'鬼', name:'きがしら'},
  '⻵': {std:'魚', name:'うおへん'},
  '⻶': {std:'鳥', name:'とりへん'},
  '⻷': {std:'鹵', name:'しおへん'},
  '⻸': {std:'鹿', name:'しかへん'},
  '⻹': {std:'麥', name:'むぎがしら'},
  '⻺': {std:'麻', name:'あさへん'},
  '⻻': {std:'黄', name:'きがしら'},
  '⻼': {std:'黍', name:'きびへん'},
  '⻽': {std:'黑', name:'くろへん'},
  '⻾': {std:'黹', name:'ふいへん'},
  '⻿': {std:'黽', name:'あおがえるへん'},
  '飠': {std:'食', name:'しょくへん'},
  '⺗': {std:'心', name:'りっしんべん'},
  '⻖': {std:'阜', name:'こざとへん'},
  '⻏': {std:'邑', name:'おおざと'},
  '亻': {std:'人', name:'にんべん'},
  '艹': {std:'艸', name:'くさかんむり'},
  '辶': {std:'辵', name:'しんにょう'},
  '衤': {std:'衣', name:'ころもへん'},
  '刂': {std:'刀', name:'りっとう'},
  '罒': {std:'网', name:'あみがしら'},
  '灬': {std:'火', name:'れっか'},
  '攵': {std:'攴', name:'ぼくづくり'},
  '王': {std:'玉', name:'たま'},
  '礻': {std:'示', name:'しめすへん'},
  '氺': {std:'水', name:'みず'},
};

// Reverse map: standard form -> {display, name} for when we need the standard form
const STD_TO_DISPLAY = {};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchText(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'KankenMaster-Build/1.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return attempt(n);
        }
        if (res.statusCode === 404) return reject(new Error('404'));
        if (res.statusCode !== 200 && n < retries) return setTimeout(() => attempt(n + 1), 1000 * (n + 1));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let d = '';
        res.setEncoding('utf-8');
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', e => { if (n < retries) setTimeout(() => attempt(n + 1), 1000 * (n + 1)); else reject(e); });
    };
    attempt(0);
  });
}

async function fetchJSON(url) { return JSON.parse(await fetchText(url)); }

function fetchGzip(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'KankenMaster-Build/1.0' } }, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      resolve(res.pipe(zlib.createGunzip()));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = lines[i].split(',');
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j] || '';
    rows.push(row);
  }
  return rows;
}

function matchRadical(comp, rMap) {
  // 1. Check RADICAL_VARIANTS first - gives correct display form + name
  const rv = RADICAL_VARIANTS[comp];
  if (rv) {
    // Verify the standard form exists in rMap
    const nfkc = rv.std.normalize('NFKC');
    if (rMap[nfkc]) return { radical: comp, name: rv.name };
    if (rMap[rv.std]) return { radical: comp, name: rv.name };
  }
  // 2. Direct lookup
  if (rMap[comp]) return rMap[comp];
  // 3. NFKC normalization (handles Kangxi radical forms)
  const nfkc = comp.normalize('NFKC');
  if (rMap[nfkc]) return rMap[nfkc];
  return null;
}

async function loadKentei() {
  console.log('[1/7] 漢検漢字辞典漢字.csv ダウンロード中...');
  const rows = parseCSV(await fetchText(SRC.kentei));
  const byGrade = {};
  for (const r of rows) {
    if (r['字体'] !== '親字') continue;
    const k = r['漢字テキスト'];
    if (!k) continue;
    const g = GRADE_MAP[r['漢検級']];
    if (!g) continue;
    if (!byGrade[g]) byGrade[g] = [];
    byGrade[g].push(k);
  }
  const total = Object.values(byGrade).reduce((s, a) => s + a.length, 0);
  console.log(`  → ${total} 親字 (${Object.keys(byGrade).length} 級)`);
  return byGrade;
}

async function loadBushu() {
  console.log('[2/7] 部首一覧.csv ダウンロード中...');
  const rows = parseCSV(await fetchText(SRC.bushu));
  const map = {};
  for (const r of rows) {
    const ch = r['部首'];
    if (!ch) continue;
    const nfkc = ch.normalize('NFKC');
    // Store by NFKC-normalized form (standard CJK char)
    map[nfkc] = { radical: nfkc, name: r['名称'], strokes: parseInt(r['画数'], 10) };
  }
  console.log(`  → ${Object.keys(map).length} 部首`);
  return map;
}

async function loadK2R() {
  console.log('[3/8] kanji2radical.json ダウンロード中...');
  const data = await fetchJSON(SRC.k2r);
  console.log(`  → ${Object.keys(data).length} 漢字`);
  return data;
}

async function loadKanjidic2(rMap) {
  console.log('[4/8] KANJIDIC2 XML ダウンロード・パース中...');
  const radNum2Info = {};
  const rMapEntries = Object.entries(rMap);
  let radIdx = 0;
  for (const [nfkc, info] of rMapEntries) {
    radIdx++;
    radNum2Info[radIdx] = info;
  }
  const kanji2radNum = {};
  try {
    const stream = await fetchGzip(SRC.kanjidic2);
    let inChar = false, literal = null, radNum = null;
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const t = line.trim();
      if (t === '<character>') { inChar = true; literal = null; radNum = null; continue; }
      if (t === '</character>') {
        if (literal && radNum) kanji2radNum[literal] = radNum;
        inChar = false; continue;
      }
      if (!inChar) continue;
      let m;
      if ((m = t.match(/^<literal>(.+)<\/literal>$/))) { literal = m[1]; continue; }
      if ((m = t.match(/^<rad_value rad_type="classical">(\d+)<\/rad_value>$/))) { radNum = parseInt(m[1], 10); continue; }
    }
  } catch (e) {
    console.error('  KANJIDIC2パース失敗:', e.message);
  }
  console.log(`  → ${Object.keys(kanji2radNum).length} 漢字`);
  return { kanji2radNum, radNum2Info };
}

async function fetchKanjiDetail(k) {
  try { return await fetchJSON(SRC.kanjiAPI + encodeURIComponent(k)); }
  catch (e) { if (e.message === '404') return null; throw e; }
}

async function fetchExamples(k, sentenceMap) {
  try {
    const words = await fetchJSON(SRC.wordsAPI + encodeURIComponent(k));
    const ex = [], seen = new Set();
    const sorted = words.sort((a, b) => {
      const ap = a.variants?.some(v => v.priorities?.length > 0) ? 1 : 0;
      const bp = b.variants?.some(v => v.priorities?.length > 0) ? 1 : 0;
      return bp - ap;
    });
    for (const w of sorted) {
      if (ex.length >= 5) break;
      if (!w.variants) continue;
      for (const v of w.variants) {
        if (ex.length >= 5) break;
        const word = v.written, reading = v.pronounced;
        if (!word || word.length > 4 || seen.has(word) || !word.includes(k)) continue;
        seen.add(word);
        // Tatoebaの例文を追加
        const sentences = sentenceMap ? (sentenceMap[word] || []) : [];
        ex.push({ word, reading, sentences });
      }
    }
    return ex;
  } catch { return []; }
}

async function processGrade(kanjiList, k2r, rMap, kanjidic2, gradeId, sentenceMap) {
  const results = [];
  for (let i = 0; i < kanjiList.length; i += CONCURRENCY) {
    const batch = kanjiList.slice(i, i + CONCURRENCY);
    const items = await Promise.all(batch.map(async k => {
      const d = await fetchKanjiDetail(k);
      if (!d) return null;
      const ex = await fetchExamples(k, sentenceMap);
      let rad = null;
      const comps = k2r[k];
      if (comps) {
        for (const c of comps) {
          const r = matchRadical(c, rMap);
          if (r) { rad = { radical: r.radical, name: r.name }; break; }
        }
      }
      // Fallback: check if the kanji itself is a radical
      if (!rad) {
        const selfNfkc = k.normalize('NFKC');
        if (rMap[selfNfkc]) {
          rad = { radical: rMap[selfNfkc].radical, name: rMap[selfNfkc].name };
        }
      }
      // Fallback: use KANJIDIC2 radical number
      if (!rad) {
        const radNum = kanjidic2.kanji2radNum[k];
        if (radNum && kanjidic2.radNum2Info[radNum]) {
          const info = kanjidic2.radNum2Info[radNum];
          let displayForm = info.radical;
          let displayName = info.name;
          for (const [variant, rv] of Object.entries(RADICAL_VARIANTS)) {
            if (rv.std.normalize('NFKC') === info.radical) {
              displayForm = variant;
              displayName = rv.name;
              break;
            }
          }
          rad = { radical: displayForm, name: displayName };
        }
      }
      return {
        kanji: k, kentei_grade: gradeId,
        stroke_count: d.stroke_count || 0,
        radical: rad?.radical || null, radical_name: rad?.name || null,
        on_readings: d.on_readings || [], kun_readings: d.kun_readings || [],
        meanings: d.meanings || [], examples: ex,
        homophones: [], weight: 1.0
      };
    }));
    results.push(...items.filter(x => x));
    if ((i / CONCURRENCY) % 10 === 0)
      console.log(`  級${gradeId}: ${Math.min(i + CONCURRENCY, kanjiList.length)}/${kanjiList.length}`);
    await sleep(DELAY_MS);
  }
  return results;
}

function buildHomophones(allKanji) {
  const r2k = {};
  for (const k of allKanji)
    for (const r of k.on_readings) {
      if (!r2k[r]) r2k[r] = [];
      r2k[r].push(k.kanji);
    }
  for (const k of allKanji) {
    const h = new Set();
    for (const r of k.on_readings)
      for (const x of (r2k[r] || []))
        if (x !== k.kanji) h.add(x);
    k.homophones = [...h].slice(0, 10);
  }
}

async function parseJMdict() {
  console.log('[6/7] JMdict_e.gz ダウンロード・パース中...');
  try {
    const stream = await fetchGzip(SRC.jmdict);
    const antonyms = [], synonyms = [], rGroups = {};
    let inEntry = false, keb = null, reb = null;
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const t = line.trim();
      if (t === '<entry>') { inEntry = true; keb = null; reb = null; continue; }
      if (t === '</entry>') {
        if (keb && reb) { (rGroups[reb] ||= new Set()).add(keb); }
        inEntry = false; continue;
      }
      if (!inEntry) continue;
      let m;
      if ((m = t.match(/^<keb>(.+)<\/keb>$/)) && !keb) { keb = m[1]; continue; }
      if ((m = t.match(/^<reb>(.+)<\/reb>$/)) && !reb) { reb = m[1]; continue; }
      if ((m = t.match(/^<ant>(.+)<\/ant>$/)) && keb) { antonyms.push({ word: keb, antonym: m[1] }); continue; }
      if ((m = t.match(/^<xref>(.+)<\/xref>$/)) && keb) {
        const ref = m[1].split('・')[0];
        if (ref !== keb) synonyms.push({ word: keb, synonym: ref });
      }
    }
    const sameKun = [];
    for (const [reading, set] of Object.entries(rGroups)) {
      if (set.size < 2) continue;
      const list = [...set];
      if (list.every(w => /[\u4e00-\u9fff]/.test(w)) && list.some(w => /[\u3040-\u309F]/.test(w)))
        sameKun.push({ reading, kanji: list });
    }
    console.log(`  → 対義語:${antonyms.length} 類義語:${synonyms.length} 同訓異字:${sameKun.length}`);
    return { antonyms, synonyms, same_kun: sameKun };
  } catch (e) {
    console.error('  JMdictパース失敗:', e.message);
    return { antonyms: [], synonyms: [], same_kun: [] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skipJMdict = args.includes('--skip-jmdict');
  const skipAPI = args.includes('--skip-api');

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const byGrade = await loadKentei();
  const rMap = await loadBushu();
  const k2r = await loadK2R();
  const kanjidic2 = await loadKanjidic2(rMap);

  const all = [], gradeFiles = {};
  
  // Tatoeba例文データを読み込み
  const sentencesPath = path.join(OUT, 'tatoeba-sentences.json');
  let sentenceMap = null;
  if (fs.existsSync(sentencesPath)) {
    console.log('[4/8] tatoeba-sentences.json 読み込み中...');
    sentenceMap = JSON.parse(fs.readFileSync(sentencesPath, 'utf8'));
    console.log(`  → ${Object.keys(sentenceMap).length} 単語の例文`);
  } else {
    console.log('[4/8] tatoeba-sentences.json なし（例文スキップ）');
  }

  if (skipAPI) {
    console.log('[5/8] --skip-api: 既存JSONファイルから読み込み...');
    for (const g of Object.keys(byGrade).map(Number).sort((a, b) => b - a)) {
      const fn = path.join(OUT, `kentei-${g}.json`);
      if (fs.existsSync(fn)) {
        const data = JSON.parse(fs.readFileSync(fn, 'utf8'));
        gradeFiles[g] = data;
        all.push(...data);
        console.log(`  → kentei-${g}.json: ${data.length} 字`);
      }
    }
  } else {
    console.log('[5/8] kanjiapi.dev からデータ取得中...');
    for (const g of Object.keys(byGrade).map(Number).sort((a, b) => b - a)) {
      console.log(`  級 ${g}: ${byGrade[g].length} 字処理中...`);
      const data = await processGrade(byGrade[g], k2r, rMap, kanjidic2, g, sentenceMap);
      gradeFiles[g] = data;
      all.push(...data);
      console.log(`  → ${data.length} 字完了`);
    }
  }

  // sentencesを既存データに統合（--skip-api時も実行）
  if (sentenceMap) {
    console.log('[5.5/8] 例文データ統合中...');
    let merged = 0, total = 0;
    for (const k of all) {
      if (!k.examples) continue;
      for (const ex of k.examples) {
        total++;
        if (sentenceMap[ex.word]) {
          ex.sentences = sentenceMap[ex.word];
          merged++;
        }
      }
    }
    console.log(`  → ${merged}/${total} 例文に文章を統合`);
  }

  console.log('[6/8] 同音異字マップ構築中...');
  buildHomophones(all);

  const wordRelations = skipJMdict ? { antonyms: [], synonyms: [], same_kun: [] } : await parseJMdict();

  console.log('[8/8] JSONファイル書き出し中...');
  for (const [g, data] of Object.entries(gradeFiles)) {
    const fn = `kentei-${g}.json`;
    fs.writeFileSync(path.join(OUT, fn), JSON.stringify(data));
    console.log(`  → ${fn}: ${data.length} 字`);
  }
  fs.writeFileSync(path.join(OUT, 'word-relations.json'), JSON.stringify(wordRelations));
  console.log('  → word-relations.json');
  console.log(`\n✓ ビルド完了! 総漢字数: ${all.length}`);
}

main().catch(e => { console.error('ビルドエラー:', e); process.exit(1); });
