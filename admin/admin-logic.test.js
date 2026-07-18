'use strict';
const {
    countDisplayChars,
    escapeHtml,
    sortData,
    parseKanjiField,
    toKatakana,
    toHiragana,
    buildKanjiTableData,
    filterExamples,
    filterAuditIssues,
    validateRelationsValues,
    filterHomophones,
} = require('./admin-logic');

// ─── toKatakana / toHiragana ─────────────────────────────────────────────────

describe('toKatakana', () => {
    test('ひらがなをカタカナに変換する', () => {
        expect(toKatakana('みず')).toBe('ミズ');
    });
    test('カタカナはそのまま', () => {
        expect(toKatakana('ミズ')).toBe('ミズ');
    });
    test('漢字・英字は変換されない', () => {
        expect(toKatakana('水abc')).toBe('水abc');
    });
});

describe('toHiragana', () => {
    test('カタカナをひらがなに変換する', () => {
        expect(toHiragana('ミズ')).toBe('みず');
    });
    test('ひらがなはそのまま', () => {
        expect(toHiragana('みず')).toBe('みず');
    });
    test('漢字・英字は変換されない', () => {
        expect(toHiragana('水abc')).toBe('水abc');
    });
});

// ─── countDisplayChars ──────────────────────────────────────────────────────

describe('countDisplayChars', () => {
    test('通常の漢字文字列はそのままカウント', () => {
        expect(countDisplayChars('東京都知事')).toBe(5);
    });

    test('記号・句読点は除外される', () => {
        expect(countDisplayChars('東京、大阪。')).toBe(4);
    });

    test('空白は除外される', () => {
        expect(countDisplayChars('東 京')).toBe(2);
    });

    test('空文字は 0', () => {
        expect(countDisplayChars('')).toBe(0);
    });

    test('null / undefined でも 0', () => {
        expect(countDisplayChars(null)).toBe(0);
        expect(countDisplayChars(undefined)).toBe(0);
    });

    test('15 文字超の境界', () => {
        const s = '漢'.repeat(16);
        expect(countDisplayChars(s)).toBeGreaterThan(15);
    });

    test('20 文字超の境界', () => {
        const s = '字'.repeat(21);
        expect(countDisplayChars(s)).toBeGreaterThan(20);
    });
});

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
    test('< > & " \' をエスケープする', () => {
        expect(escapeHtml('<script>alert("xss")</script>'))
            .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('シングルクォートをエスケープする', () => {
        expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    test('普通の文字列はそのまま', () => {
        expect(escapeHtml('漢字テスト')).toBe('漢字テスト');
    });

    test('数値を渡しても文字列化される', () => {
        expect(escapeHtml(42)).toBe('42');
    });
});

// ─── sortData ────────────────────────────────────────────────────────────────

describe('sortData', () => {
    const data = [
        { kanji: '水', grade: 8 },
        { kanji: '火', grade: 10 },
        { kanji: '土', grade: 6 },
    ];

    test('文字列キーで昇順ソート（Unicode コードポイント順）', () => {
        const result = sortData(data, { key: 'kanji', dir: 1 });
        // 土(U+571F) < 水(U+6C34) < 火(U+706B) の順
        expect(result.map(d => d.kanji)).toEqual(['土', '水', '火']);
    });

    test('文字列キーで降順ソート', () => {
        const result = sortData(data, { key: 'kanji', dir: -1 });
        expect(result.map(d => d.kanji)).toEqual(['火', '水', '土']);
    });

    test('数値キーで昇順ソート', () => {
        const result = sortData(data, { key: 'grade', dir: 1 });
        expect(result.map(d => d.grade)).toEqual([6, 8, 10]);
    });

    test('数値キーで降順ソート', () => {
        const result = sortData(data, { key: 'grade', dir: -1 });
        expect(result.map(d => d.grade)).toEqual([10, 8, 6]);
    });

    test('元の配列を変更しない（immutable）', () => {
        const original = [...data];
        sortData(data, { key: 'grade', dir: 1 });
        expect(data).toEqual(original);
    });
});

// ─── parseKanjiField ────────────────────────────────────────────────────────

describe('parseKanjiField', () => {
    test('on_readings を空白区切りで分割する', () => {
        expect(parseKanjiField('on_readings', 'カ ケ')).toEqual(['カ', 'ケ']);
    });

    test('kun_readings を空白区切りで分割する', () => {
        expect(parseKanjiField('kun_readings', 'ひ   ほのお')).toEqual(['ひ', 'ほのお']);
    });

    test('meanings をカンマ区切りで分割する', () => {
        expect(parseKanjiField('meanings', 'fire, flame')).toEqual(['fire', 'flame']);
    });

    test('meanings_ja を半角カンマ区切りで分割する', () => {
        expect(parseKanjiField('meanings_ja', '火, 炎')).toEqual(['火', '炎']);
    });

    test('空文字は空配列になる', () => {
        expect(parseKanjiField('on_readings', '')).toEqual([]);
        expect(parseKanjiField('meanings', '')).toEqual([]);
    });

    test('前後の余分な空白を除去する', () => {
        expect(parseKanjiField('meanings', '  fire , flame  ')).toEqual(['fire', 'flame']);
    });
});

// ─── buildKanjiTableData ─────────────────────────────────────────────────────

describe('buildKanjiTableData', () => {
    const kanjiData = [
        { kanji: '水', on_readings: ['スイ'], kun_readings: ['みず'], meanings: ['water'], meanings_ja: ['水'], examples: [] },
        { kanji: '火', on_readings: ['カ'],   kun_readings: ['ひ'],   meanings: ['fire'],  meanings_ja: ['火'], examples: [{}, {}] },
        { kanji: '土', on_readings: ['ド'],   kun_readings: ['つち'], meanings: ['earth'], meanings_ja: ['土'], examples: [] },
    ];

    // ★ 今回のバグと同種を防ぐための最重要テスト
    test('_kanjiIndex が kanjiData 内の元のインデックスと一致する', () => {
        const result = buildKanjiTableData(kanjiData, '');
        result.forEach(row => {
            expect(kanjiData[row._kanjiIndex].kanji).toBe(row.kanji);
        });
    });

    test('_kanjiIndex が絶対に -1 にならない', () => {
        const result = buildKanjiTableData(kanjiData, '');
        result.forEach(row => {
            expect(row._kanjiIndex).toBeGreaterThanOrEqual(0);
        });
    });

    test('検索フィルタ後でも _kanjiIndex が元の位置を指している', () => {
        // '火' だけを絞り込んだとき、_kanjiIndex は 1 になるはず
        const result = buildKanjiTableData(kanjiData, '火');
        expect(result).toHaveLength(1);
        expect(result[0]._kanjiIndex).toBe(1);
        expect(kanjiData[result[0]._kanjiIndex].kanji).toBe('火');
    });

    test('検索なしで全件返す', () => {
        const result = buildKanjiTableData(kanjiData, '');
        expect(result).toHaveLength(3);
    });

    test('漢字で絞り込める', () => {
        const result = buildKanjiTableData(kanjiData, '水');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('水');
    });

    test('音読み（カタカナ）で絞り込める', () => {
        // on_readings は ['ド'] なのでカタカナで検索
        const result = buildKanjiTableData(kanjiData, 'ド');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('土');
    });

    test('ひらがなで検索するとカタカナの音読みにもマッチする', () => {
        // 'ど' → toKatakana → 'ド' に変換して on_readings にヒット
        const result = buildKanjiTableData(kanjiData, 'ど');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('土');
    });

    test('カタカナで検索するとひらがなの訓読みにもマッチする', () => {
        // 'ミズ' → toHiragana → 'みず' に変換して kun_readings にヒット
        const result = buildKanjiTableData(kanjiData, 'ミズ');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('水');
    });

    test('英語意味で絞り込める', () => {
        const result = buildKanjiTableData(kanjiData, 'fire');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('火');
    });

    test('マッチしないときは空配列', () => {
        const result = buildKanjiTableData(kanjiData, 'zzznomatch');
        expect(result).toHaveLength(0);
    });

    test('_examples に examples.length が入る', () => {
        const result = buildKanjiTableData(kanjiData, '');
        const ka = result.find(r => r.kanji === '火');
        expect(ka._examples).toBe(2);
    });
});

// ─── filterExamples ──────────────────────────────────────────────────────────

describe('filterExamples', () => {
    const examples = [
        { kanji: '水', word: '水道', sentence: '水道水を飲む', type: 'ok' },
        { kanji: '火', word: '火事', sentence: '火事になった',  type: 'ok' },
        { kanji: '土', word: '土地', sentence: '土地を買う',   type: 'long' },
    ];

    test('検索なしで全件返す', () => {
        const result = filterExamples(examples, '');
        expect(result).toHaveLength(3);
    });

    test('kanji でフィルタできる', () => {
        const result = filterExamples(examples, '水');
        expect(result).toHaveLength(1);
        expect(result[0].ex.kanji).toBe('水');
    });

    test('sentence でフィルタできる', () => {
        const result = filterExamples(examples, '買う');
        expect(result).toHaveLength(1);
        expect(result[0].ex.kanji).toBe('土');
    });

    test('originalIndex が元配列の位置を保持している', () => {
        const result = filterExamples(examples, '火');
        expect(result[0].originalIndex).toBe(1); // examples[1] が '火'
    });

    test('マッチしないときは空配列', () => {
        const result = filterExamples(examples, 'zzznomatch');
        expect(result).toHaveLength(0);
    });
});

// ─── filterAuditIssues ───────────────────────────────────────────────────────

describe('filterAuditIssues', () => {
    const issues = [
        { kanji: '水', word: '水道水', sentence: 'きれいな水道水を毎日飲んでいます', type: 'long' },
        { kanji: '火', word: '火事',   sentence: '近所で火事が発生した',             type: 'too_long' },
    ];

    test('検索なしで全件返す', () => {
        expect(filterAuditIssues(issues, '')).toHaveLength(2);
    });

    test('word でフィルタできる', () => {
        const result = filterAuditIssues(issues, '火事');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('火');
    });

    test('sentence でフィルタできる', () => {
        const result = filterAuditIssues(issues, '毎日');
        expect(result).toHaveLength(1);
        expect(result[0].kanji).toBe('水');
    });
});

// ─── validateRelationsValues ─────────────────────────────────────────────────

describe('validateRelationsValues', () => {
    const valid = {
        antonyms:   '[]',
        synonyms:   '[["a","b"]]',
        same_kun:   '[]',
        homophones: '[]',
    };

    test('正常な JSON で valid=true かつ errors が空', () => {
        const { valid: ok, errors } = validateRelationsValues(valid);
        expect(ok).toBe(true);
        expect(errors).toHaveLength(0);
    });

    test('不正な JSON を含むと valid=false', () => {
        const { valid: ok, errors } = validateRelationsValues({ ...valid, antonyms: '[broken' });
        expect(ok).toBe(false);
        expect(errors.some(e => e.startsWith('antonyms:'))).toBe(true);
    });

    test('複数フィールドにエラーがあると複数のエラーを返す', () => {
        const bad = { antonyms: '{bad', synonyms: '{bad', same_kun: '[]', homophones: '[]' };
        const { errors } = validateRelationsValues(bad);
        expect(errors).toHaveLength(2);
    });

    test('空文字は [] として扱いエラーにならない', () => {
        const { valid: ok } = validateRelationsValues({ ...valid, antonyms: '' });
        expect(ok).toBe(true);
    });
});

// ─── filterHomophones ────────────────────────────────────────────────────────

describe('filterHomophones', () => {
    const data = [
        { kanji: '機', homophones: ['器', '期', '基'] },
        { kanji: '水', homophones: ['推', '酔'] },
        { kanji: '花', homophones: ['化', '華'], _manual: true },
    ];

    test('検索なしで全件返す', () => {
        expect(filterHomophones(data, '')).toHaveLength(3);
    });

    test('選択中の級に含まれる主漢字だけを返す', () => {
        const result = filterHomophones(data, '', new Set(['機', '花']));
        expect(result.map(({ row }) => row.kanji)).toEqual(['機', '花']);
    });

    test('級フィルターと検索条件の両方を適用する', () => {
        const result = filterHomophones(data, '期', new Set(['機', '水']));
        expect(result.map(({ row }) => row.kanji)).toEqual(['機']);
    });

    test('基準漢字で絞り込める', () => {
        const result = filterHomophones(data, '水');
        expect(result).toHaveLength(1);
        expect(result[0].row.kanji).toBe('水');
    });

    test('同音漢字リストで絞り込める', () => {
        const result = filterHomophones(data, '期');
        expect(result).toHaveLength(1);
        expect(result[0].row.kanji).toBe('機');
    });

    test('マッチしないときは空配列', () => {
        expect(filterHomophones(data, '龍')).toHaveLength(0);
    });

    test('元データのインデックスを保持している', () => {
        const result = filterHomophones(data, '花');
        expect(result).toHaveLength(1);
        expect(result[0].i).toBe(2);
    });

    test('_manual フラグを保持している', () => {
        const result = filterHomophones(data, '花');
        expect(result[0].row._manual).toBe(true);
    });

    test('検索なしのとき全件のインデックスが連番で正しい', () => {
        const result = filterHomophones(data, '');
        expect(result.map(r => r.i)).toEqual([0, 1, 2]);
    });
});
