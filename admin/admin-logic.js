'use strict';
/**
 * admin-logic.js
 * DOM・グローバル状態に依存しない純粋関数をまとめたモジュール。
 * Jest でユニットテストする対象。
 */

/**
 * 記号・空白を除いた表示文字数を返す（サーバー側 countChars と同等）。
 * @param {string} str
 * @returns {number}
 */
function countDisplayChars(str) {
    return (str || '').replace(/[\s\n\r\t、。！？「」『』（）［］【】・･,\.!?\[\]\(\)\{\}"']/g, '').length;
}

/**
 * HTML エスケープ。
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * テーブル行データを指定キー・方向でソートして新配列を返す。
 * @param {Array<object>} data
 * @param {{ key: string, dir: 1 | -1 }} sortState
 * @returns {Array<object>}
 */
function sortData(data, sortState) {
    const { key, dir } = sortState;
    return [...data].sort((a, b) => {
        let av = a[key] ?? '';
        let bv = b[key] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') {
            return (av - bv) * dir;
        }
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 *  dir;
        return 0;
    });
}

/**
 * フィールド文字列から漢字データの配列フィールドに変換する。
 * on_readings / kun_readings : 空白区切り → 配列
 * meanings / meanings_ja      : カンマ区切り → 配列
 * @param {string} field
 * @param {string} raw
 * @returns {string[]}
 */
function parseKanjiField(field, raw) {
    if (field === 'on_readings' || field === 'kun_readings') {
        return raw.trim().split(/\s+/).filter(Boolean);
    }
    if (field === 'meanings' || field === 'meanings_ja') {
        return raw.trim().split(/,\s*/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}

/**
 * ひらがな → カタカナ に変換する。
 * 検索時にひらがなとカタカナを同一視するために使用。
 * @param {string} str
 * @returns {string}
 */
function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) + 0x60)
    );
}

/**
 * カタカナ → ひらがな に変換する。
 * @param {string} str
 * @returns {string}
 */
function toHiragana(str) {
    return str.replace(/[\u30A1-\u30F6]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
}

/**
 * kanjiData 配列を filter + map してレンダー用データを作る。
 * 各要素に _kanjiIndex（kanjiData 内の位置）を付与する。
 * これが -1 になると openModal が silent fail するため重点テスト対象。
 * 検索はひらがな・カタカナを同一視する。
 * @param {Array<object>} kanjiData
 * @param {string} searchTerm  小文字化済みの検索ワード
 * @returns {Array<object>}    各要素に _kanjiIndex が付いている
 */
function buildKanjiTableData(kanjiData, searchTerm) {
    return kanjiData
        .map((item, index) => ({ item, index }))          // 先にインデックスを確定
        .filter(({ item }) => {
            if (!searchTerm) return true;
            // ひらがな・カタカナ両方向で検索できるよう正規化
            const sKata = toKatakana(searchTerm);
            const sHira = toHiragana(searchTerm);
            const matches = (str) =>
                str.includes(searchTerm) || str.includes(sKata) || str.includes(sHira);
            return matches(item.kanji || '') ||
                matches((item.on_readings  || []).join(' ').toLowerCase()) ||
                matches((item.kun_readings || []).join(' ').toLowerCase()) ||
                matches((item.meanings     || []).join(' ').toLowerCase()) ||
                matches((item.meanings_ja  || []).join(' ').toLowerCase());
        })
        .map(({ item, index }) => ({
            ...item,
            _kanjiIndex:  index,                           // kanjiData の確定位置
            _on:          (item.on_readings  || []).join(' '),
            _kun:         (item.kun_readings || []).join(' '),
            _meanings:    (item.meanings     || []).join(', '),
            _meanings_ja: (item.meanings_ja  || []).join(', '),
            _examples:    (item.examples     || []).length
        }));
}

/**
 * 例文一覧をクライアントサイド検索でフィルタリングする。
 * @param {Array<object>} examples
 * @param {string} searchTerm  小文字化済みの検索ワード
 * @returns {Array<{ ex: object, originalIndex: number }>}
 */
function filterExamples(examples, searchTerm) {
    return examples
        .map((ex, i) => ({ ex, originalIndex: i }))
        .filter(({ ex }) => {
            if (!searchTerm) return true;
            const s = searchTerm;
            return (ex.kanji    || '').includes(s) ||
                   (ex.word     || '').includes(s) ||
                   (ex.sentence || '').includes(s);
        });
}

/**
 * 監査結果をクライアントサイド検索でフィルタリングする。
 * @param {Array<object>} issues
 * @param {string} searchTerm  小文字化済みの検索ワード
 * @returns {Array<object>}
 */
function filterAuditIssues(issues, searchTerm) {
    if (!searchTerm) return issues;
    const s = searchTerm;
    return issues.filter(issue =>
        (issue.kanji    || '').includes(s) ||
        (issue.word     || '').includes(s) ||
        (issue.sentence || '').includes(s)
    );
}

/**
 * 同音異字データをクライアントサイド検索でフィルタリングする。
 * 元データのインデックス i を保持した { row, i }[] を返す。
 * @param {Array<{ kanji: string, homophones: string[], _manual?: boolean }>} data
 * @param {string} search  小文字化済みの検索ワード
 * @param {Set<string>} [selectedKanji] 選択中の級に含まれる主漢字
 * @returns {Array<{ row: object, i: number }>}
 */
function filterHomophones(data, search, selectedKanji) {
    return data
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => {
            if (selectedKanji && row.kanji && !selectedKanji.has(row.kanji)) return false;
            if (!search) return true;
            if ((row.kanji || '').includes(search)) return true;
            // homophones は配列のはずだが、文字列の場合も考慮して安全に扱う
            const list = Array.isArray(row.homophones)
                ? row.homophones
                : String(row.homophones || '').split(/\s+/).filter(Boolean);
            return list.some(h => h.includes(search));
        });
}

/**
 * Word Relations の各 textarea 値を JSON パースして検証する。
 * @param {{ antonyms: string, synonyms: string, same_kun: string, homophones: string }} values
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRelationsValues(values) {
    const labels = ['antonyms', 'synonyms', 'same_kun', 'homophones'];
    const errors = [];
    for (const label of labels) {
        try {
            JSON.parse(values[label] || '[]');
        } catch (e) {
            errors.push(`${label}: ${e.message}`);
        }
    }
    return { valid: errors.length === 0, errors };
}

module.exports = {
    countDisplayChars,
    escapeHtml,
    sortData,
    parseKanjiField,
    toKatakana,
    toHiragana,
    buildKanjiTableData,
    filterExamples,
    filterAuditIssues,
    filterHomophones,
    validateRelationsValues,
};
