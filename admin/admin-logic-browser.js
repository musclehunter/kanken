/**
 * admin-logic-browser.js
 * admin-logic.js をブラウザで使うためのグローバル公開ラッパー。
 * （Node の module.exports は使えないため、関数をグローバルに定義する）
 */

function countDisplayChars(str) {
    return (str || '').replace(/[\s\n\r\t、。！？「」『』（）［］【】・･,\.!?\[\]\(\)\{\}"']/g, '').length;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sortData(data, sortStateArg) {
    const { key, dir } = sortStateArg;
    return [...data].sort((a, b) => {
        let av = a[key] ?? '';
        let bv = b[key] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 *  dir;
        return 0;
    });
}

function parseKanjiField(field, raw) {
    if (field === 'on_readings' || field === 'kun_readings') {
        return raw.trim().split(/\s+/).filter(Boolean);
    }
    if (field === 'meanings' || field === 'meanings_ja') {
        return raw.trim().split(/,\s*/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}

function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) + 0x60)
    );
}

function toHiragana(str) {
    return str.replace(/[\u30A1-\u30F6]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
}

function buildKanjiTableData(kanjiData, searchTerm) {
    return kanjiData
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
            if (!searchTerm) return true;
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
            _kanjiIndex:  index,
            _on:          (item.on_readings  || []).join(' '),
            _kun:         (item.kun_readings || []).join(' '),
            _meanings:    (item.meanings     || []).join(', '),
            _meanings_ja: (item.meanings_ja  || []).join(', '),
            _examples:    (item.examples     || []).length
        }));
}

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

function filterAuditIssues(issues, searchTerm) {
    if (!searchTerm) return issues;
    const s = searchTerm;
    return issues.filter(issue =>
        (issue.kanji    || '').includes(s) ||
        (issue.word     || '').includes(s) ||
        (issue.sentence || '').includes(s)
    );
}

function filterHomophones(data, search, selectedKanji) {
    return data
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => {
            if (selectedKanji && row.kanji && !selectedKanji.has(row.kanji)) return false;
            if (!search) return true;
            if ((row.kanji || '').includes(search)) return true;
            const list = Array.isArray(row.homophones)
                ? row.homophones
                : String(row.homophones || '').split(/\s+/).filter(Boolean);
            return list.some(h => h.includes(search));
        });
}

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
