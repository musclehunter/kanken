const API_BASE = '/api';
const TAB_TITLES = {
    kanji:      '漢字データ',
    antonyms:   '対義語',
    synonyms:   '類義語',
    same_kun:   '同訓異字',
    homophones: '同音異字',
    examples:   '例文一覧',
    audit:      '監査'
};

// word-relations タブのセット（ロード・保存を共有）
const REL_TABS = new Set(['antonyms', 'synonyms', 'same_kun', 'homophones']);

let currentGrade = null;
let kanjiData = [];
let wordRelations = null; // null = 未ロード
let searchTerm = '';
let allGrades = [];
let selectedGrades = [];
let relationKanjiByGrade = new Map();
let isDirty = false;

// ソート状態をタブごとに管理
const sortState = {
    kanji:    { key: 'kanji', dir: 1 },
    examples: { key: 'kanji', dir: 1 },
    audit:    { key: 'grade', dir: 1 }
};

// 例文・監査で取得したデータをクライアント側で保持してソートに使う
let examplesData = [];
let deletedExamples = []; // 削除された行を保持して保存時に反映
let auditData = [];
let currentExamplesFilter = 'all';
let currentTab = 'kanji';
let globalSearchTerm = '';
let highlightKanji = null; // 監査から遷移時にハイライトする漢字
let kanjiDataOriginal = {}; // kanji文字→元のフィールド値（Undo用）

const els = {
    pageTitle: document.getElementById('page-title'),
    gradeToggles: document.getElementById('grade-toggles'),
    btnSelectAllGrades: document.getElementById('btn-select-all-grades'),
    btnDeselectAllGrades: document.getElementById('btn-deselect-all-grades'),
    btnSave: document.getElementById('btn-save'),
    btnReload: document.getElementById('btn-reload'),
    globalSearch: document.getElementById('global-search'),
    kanjiCount: document.getElementById('kanji-count'),
    kanjiTable: document.querySelector('#kanji-table tbody'),
    auditTable: document.querySelector('#audit-table tbody'),
    auditCount: document.getElementById('audit-count'),
    btnRunAudit: document.getElementById('btn-run-audit'),
    examplesTable: document.querySelector('#examples-table tbody'),
    examplesCount: document.getElementById('examples-count'),
    examplesFilterToggles: document.getElementById('examples-filter-toggles'),
    btnLoadExamples: document.getElementById('btn-load-examples'),
    tabs: document.querySelectorAll('.nav-tab'),
    panels: document.querySelectorAll('.tab-panel'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalClose: document.getElementById('modal-close'),
    detailKanji: document.getElementById('detail-kanji'),
    detailExamplesCount: document.getElementById('detail-examples-count'),
    detailOn: document.getElementById('detail-on_readings'),
    detailKun: document.getElementById('detail-kun_readings'),
    detailMeanings: document.getElementById('detail-meanings'),
    detailMeaningsJa: document.getElementById('detail-meanings_ja'),
    detailExamples: document.getElementById('detail-examples'),
    relAntonymsBody:    document.getElementById('rel-antonyms-body'),
    relSynonymsBody:    document.getElementById('rel-synonyms-body'),
    relSameKunBody:     document.getElementById('rel-same_kun-body'),
    relHomophonesBody:  document.getElementById('rel-homophones-body'),
    relAntonymsCount:   document.getElementById('rel-antonyms-count'),
    relSynonymsCount:   document.getElementById('rel-synonyms-count'),
    relSameKunCount:    document.getElementById('rel-same_kun-count'),
    relHomophonesCount: document.getElementById('rel-homophones-count'),
    examplesFilterSection: document.getElementById('examples-filter-section'),
    btnUndoDelete: document.getElementById('btn-undo-delete'),
    toast: document.getElementById('toast'),
    dirtyBadge: document.getElementById('dirty-badge')
};

async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json();
}

async function apiPut(path, body) {
    const res = await fetch(API_BASE + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json();
}

function showToast(message, type = 'success') {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 3000);
}

function handleError(context, error) {
    console.error(context, error);
    showToast(`${context}: ${error.message}`, 'error');
}

function setDirty(dirty) {
    isDirty = dirty;
    if (els.dirtyBadge) els.dirtyBadge.style.display = dirty ? 'inline-flex' : 'none';
}

function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
        btn._origText = btn.textContent;
        btn.textContent = '処理中…';
    } else {
        btn.textContent = btn._origText || btn.textContent;
    }
}

// ---- ソートユーティリティ ----

function bindSortHeaders(tableId, tab, renderFn) {
    document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            const st = sortState[tab];
            if (st.key === key) st.dir *= -1;
            else { st.key = key; st.dir = 1; }
            renderFn();
        });
    });
}

function updateSortIndicators(tableId, tab) {
    const st = sortState[tab];
    document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === st.key) {
            const dir = st.dir === 1 ? 'sort-asc' : 'sort-desc';
            th.classList.add(dir);
            th.setAttribute('aria-sort', st.dir === 1 ? 'ascending' : 'descending');
        } else {
            th.setAttribute('aria-sort', 'none');
        }
    });
}

// countDisplayChars / escapeHtml / sortData（純粋関数版） / buildKanjiTableData 等は
// admin-logic-browser.js でグローバルに定義済み。

// admin.js 内では sortState[tab] を解決してから委譲するラッパーを使う
function sortDataByTab(data, tab) {
    return sortData(data, sortState[tab]);
}

async function init() {
    try {
        const grades = await apiGet('/grades');
        allGrades = grades.map(g => g.grade).sort((a, b) => a - b);
        selectedGrades = [...allGrades];
        renderGradeToggles();
        if (selectedGrades.length > 0) {
            currentGrade = String(selectedGrades[0]);
            await loadGrade(currentGrade, true);
        }
    } catch (e) {
        handleError('級一覧の取得に失敗しました', e);
    }

    bindEvents();
}

function renderGradeToggles() {
    if (!els.gradeToggles) return;
    els.gradeToggles.innerHTML = allGrades.map(grade => {
        const isHalf = !Number.isInteger(grade);
        const active = selectedGrades.includes(grade) ? 'active' : '';
        const label = isHalf ? `${Math.floor(grade)}級半` : `${grade}級`;
        return `<button type="button" class="grade-toggle ${active} ${isHalf ? 'half' : ''}" data-grade="${grade}">${label}</button>`;
    }).join('');

    els.gradeToggles.querySelectorAll('.grade-toggle').forEach(btn => {
        btn.addEventListener('click', () => toggleGrade(parseFloat(btn.dataset.grade)));
    });
}

function toggleGrade(grade) {
    const idx = selectedGrades.indexOf(grade);
    if (idx === -1) {
        selectedGrades.push(grade);
    } else {
        selectedGrades.splice(idx, 1);
    }
    selectedGrades.sort((a, b) => a - b);
    renderGradeToggles();

    if (currentTab === 'kanji') {
        // 漢字データタブでは選択変更時に先頭の級を読み込む
        const first = selectedGrades[0];
        if (first !== undefined) {
            currentGrade = String(first);
            loadGrade(currentGrade);
        }
    } else if (currentTab === 'examples') {
        reloadExamplesIfSafe();
    } else if (REL_TABS.has(currentTab)) {
        renderRelTab(currentTab);
    }
}

function selectAllGrades() {
    selectedGrades = [...allGrades];
    renderGradeToggles();
    if (currentTab === 'examples') reloadExamplesIfSafe();
    else if (REL_TABS.has(currentTab)) renderRelTab(currentTab);
}

function deselectAllGrades() {
    selectedGrades = [];
    renderGradeToggles();
    if (currentTab === 'examples') reloadExamplesIfSafe();
    else if (REL_TABS.has(currentTab)) renderRelTab(currentTab);
}

function reloadExamplesIfSafe() {
    if (isDirty && examplesData.length > 0) {
        if (!confirm('未保存の例文変更があります。このまま再読み込みすると変更が失われます。続けますか？')) return;
    }
    loadExamples();
}

function bindEvents() {
    els.btnSelectAllGrades.addEventListener('click', selectAllGrades);
    els.btnDeselectAllGrades.addEventListener('click', deselectAllGrades);

    els.btnReload.addEventListener('click', () => {
        if (currentGrade) loadGrade(currentGrade, true);
    });

    els.btnSave.addEventListener('click', () => {
        if (currentTab === 'examples') saveExamples();
        else if (currentTab === 'kanji') saveCurrentGrade();
        else if (REL_TABS.has(currentTab)) saveRelations();
        else showToast('このタブには保存対象がありません');
    });

    els.globalSearch.addEventListener('input', (e) => {
        globalSearchTerm = e.target.value.trim().toLowerCase();
        searchTerm = globalSearchTerm; // 漢字タブ用（後方互換）
        if (currentTab === 'kanji') renderKanjiTable();
        else if (currentTab === 'examples') renderExamplesTable(examplesData);
        else if (currentTab === 'audit') renderAuditTable(auditData);
        else if (REL_TABS.has(currentTab)) renderRelTab(currentTab);
    });

    bindSortHeaders('kanji-table', 'kanji', renderKanjiTable);
    bindSortHeaders('examples-table', 'examples', () => renderExamplesTable(examplesData));
    bindSortHeaders('audit-table', 'audit', () => renderAuditTable(auditData));

    els.modalClose.addEventListener('click', closeModal);

    els.tabs.forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab));
        // 矢印キーでタブ間を移動（WAI-ARIA タブパターン）
        tab.addEventListener('keydown', (e) => {
            const tabs = [...els.tabs];
            const idx  = tabs.indexOf(tab);
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                tabs[(idx + 1) % tabs.length].focus();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                tabs[(idx - 1 + tabs.length) % tabs.length].focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activateTab(tab);
            }
        });
    });

    // グローバルキーボードショートカット
    document.addEventListener('keydown', (e) => {
        // Ctrl+S: 保存
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            els.btnSave.click();
        }
        // Escape: モーダルを閉じる / 検索クリア
        if (e.key === 'Escape') {
            if (els.modal.classList.contains('active')) {
                closeModal();
            } else if (document.activeElement === els.globalSearch && els.globalSearch.value) {
                els.globalSearch.value = '';
                els.globalSearch.dispatchEvent(new Event('input'));
            }
        }
    });

    els.kanjiTable.addEventListener('click', (e) => {
        const modalBtn = e.target.closest('button[data-modal-index]');
        if (modalBtn) { openModal(parseInt(modalBtn.dataset.modalIndex, 10)); return; }
        const undoBtn = e.target.closest('button[data-undo-kanji]');
        if (undoBtn) resetKanjiRow(undoBtn.dataset.undoKanji);
    });

    // フィルタートグル
    els.examplesFilterToggles.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        currentExamplesFilter = btn.dataset.filter;
        els.examplesFilterToggles.querySelectorAll('.grade-toggle').forEach(b => {
            b.classList.toggle('active', b === btn);
        });
        reloadExamplesIfSafe();
    });

    els.btnRunAudit.addEventListener('click', runAudit);
    els.btnLoadExamples.addEventListener('click', loadExamples);

    // 例文削除 Undo ボタン
    els.btnUndoDelete.addEventListener('click', undoDeleteExample);

    // Word Relations: 追加ボタン
    document.getElementById('btn-add-antonym')  .addEventListener('click', () => addRelRow('antonyms'));
    document.getElementById('btn-add-synonym')  .addEventListener('click', () => addRelRow('synonyms'));
    document.getElementById('btn-add-same_kun') .addEventListener('click', () => addRelRow('same_kun'));
    document.getElementById('btn-add-homophone').addEventListener('click', () => addRelRow('homophones'));



    els.kanjiTable.addEventListener('change', (e) => {
        if (e.target.classList.contains('inline-input')) {
            updateKanjiFieldInline(e.target);
        }
    });

    els.kanjiTable.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('inline-input') && e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    });

    els.examplesTable.addEventListener('change', (e) => {
        if (e.target.classList.contains('sentence-input')) {
            updateSentenceInMemory(e.target);
        }
    });

    // リアルタイム文字数カウンター更新
    els.examplesTable.addEventListener('input', (e) => {
        if (!e.target.classList.contains('sentence-input')) return;
        const count = countDisplayChars(e.target.value);
        const counter = e.target.nextElementSibling;
        if (!counter || !counter.classList.contains('char-count')) return;
        counter.textContent = count;
        counter.className = count > 20 ? 'char-count too-long' : count > 15 ? 'char-count long' : 'char-count';
    });

    els.examplesTable.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-delete-index]');
        if (btn) deleteExampleRow(parseInt(btn.dataset.deleteIndex, 10));
    });

    els.examplesTable.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('sentence-input') && e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    });

    // モーダル外クリックで閉じる
    els.modal.addEventListener('click', (e) => {
        if (e.target === els.modal) closeModal();
    });

    // Word Relations: テーブル内インライン編集（change で確定）
    ['rel-antonyms-body', 'rel-synonyms-body', 'rel-same_kun-body', 'rel-homophones-body'].forEach(id => {
        const tbody = document.getElementById(id);
        tbody.addEventListener('change', (e) => {
            if (e.target.classList.contains('rel-input')) updateRelField(e.target);
        });
        tbody.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('rel-input') && e.key === 'Enter') {
                e.preventDefault();
                // 同じ行の次の input へ、なければ次の行の最初の input へ
                const inputs = [...e.target.closest('tr').querySelectorAll('input')];
                const idx = inputs.indexOf(e.target);
                if (idx < inputs.length - 1) {
                    inputs[idx + 1].focus();
                } else {
                    const nextRow = e.target.closest('tr').nextElementSibling;
                    nextRow?.querySelector('input')?.focus();
                }
            }
        });
        // 削除ボタン
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-rel-delete]');
            if (!btn) return;
            deleteRelRow(btn.dataset.relDelete, parseInt(btn.dataset.relIndex, 10));
        });
    });
}

function activateTab(tab) {
    els.tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
    });
    els.panels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    const tabName = tab.dataset.tab;
    currentTab = tabName;
    document.getElementById('tab-' + tabName).classList.add('active');
    els.pageTitle.textContent = TAB_TITLES[tabName] || tabName;

    // 例文フィルターは examples タブのみ表示
    els.examplesFilterSection.style.display = (tabName === 'examples') ? '' : 'none';

    // タブ切り替え時に検索をリセットして placeholder を更新
    globalSearchTerm = '';
    searchTerm = '';
    els.globalSearch.value = '';
    const placeholders = {
        kanji:      '漢字・読み・意味で検索…',
        antonyms:   '熟語・対義語で検索…',
        synonyms:   '熟語・類義語で検索…',
        same_kun:   '訓読み・漢字で検索…',
        homophones: '漢字で検索…',
        examples:   '漢字・例文で検索…',
        audit:      '漢字・単語・例文で検索…',
    };
    els.globalSearch.placeholder = placeholders[tabName] || '';

    // word-relations タブへの切り替え：未ロードまたはクリーンなら再ロード
    if (REL_TABS.has(tabName)) {
        if (!wordRelations || !isDirty) {
            loadRelations().then(() => renderRelTab(tabName));
        } else {
            renderRelTab(tabName);
        }
        return;
    }

    if (tabName === 'examples') {
        if (isDirty && examplesData.length > 0) renderExamplesTable(examplesData);
        else loadExamples();
    } else if (tabName === 'kanji') {
        renderKanjiTable();
    } else if (tabName === 'audit') {
        runAudit();
    }
}

async function getSelectedRelationKanji() {
    const missingGrades = selectedGrades.filter(grade => !relationKanjiByGrade.has(grade));
    await Promise.all(missingGrades.map(async grade => {
        const data = await apiGet(`/grade/${encodeURIComponent(grade)}`);
        relationKanjiByGrade.set(grade, new Set(data.map(item => item.kanji)));
    }));
    return new Set(selectedGrades.flatMap(grade => [...(relationKanjiByGrade.get(grade) || [])]));
}

// 現在のタブに対応する relations テーブルを描画
async function renderRelTab(tabName) {
    const s = globalSearchTerm;
    if (tabName === 'antonyms') renderAntonyms(wordRelations?.antonyms || [], s);
    else if (tabName === 'synonyms') renderSynonyms(wordRelations?.synonyms || [], s);
    else if (tabName === 'same_kun') renderSameKun(wordRelations?.same_kun || [], s);
    else if (tabName === 'homophones') {
        try {
            const selectedKanji = await getSelectedRelationKanji();
            if (currentTab === 'homophones') renderHomophones(wordRelations?.homophones || [], s, selectedKanji);
        } catch (e) {
            handleError('級別漢字データの取得に失敗しました', e);
        }
    }
}

async function loadGrade(grade, force = false) {
    if (!force && isDirty) {
        if (!confirm('未保存の変更があります。このまま別の級を読み込むと変更が失われます。続けますか？')) {
            return;
        }
    }
    try {
        kanjiData = await apiGet(`/grade/${encodeURIComponent(grade)}`);
        // Undo 用に元の値をディープコピーして保存
        kanjiDataOriginal = {};
        kanjiData.forEach(item => {
            kanjiDataOriginal[item.kanji] = {
                on_readings: [...(item.on_readings || [])],
                kun_readings: [...(item.kun_readings || [])],
                meanings:    [...(item.meanings || [])],
                meanings_ja: [...(item.meanings_ja || [])]
            };
        });
        setDirty(false);
        renderKanjiTable();
        if (els.pageTitle) els.pageTitle.textContent = `${grade}級の漢字データ`;
        showToast(`${grade}級を読み込みました`);
    } catch (e) {
        handleError('データの読み込みに失敗しました', e);
    }
}

function renderKanjiTable() {
    // buildKanjiTableData で filter + map + _kanjiIndex 付与（admin-logic-browser.js）
    let data = buildKanjiTableData(kanjiData, searchTerm);

    // ソートキーを _on / _kun / _meanings / _meanings_ja / _examples にマップ
    const { key } = sortState.kanji;
    const sortKey = key === 'on_readings'  ? '_on'
                  : key === 'kun_readings' ? '_kun'
                  : key === 'meanings'     ? '_meanings'
                  : key === 'meanings_ja'  ? '_meanings_ja'
                  : key === 'examples'     ? '_examples'
                  : key;
    data = sortData(data, { key: sortKey, dir: sortState.kanji.dir });

    updateSortIndicators('kanji-table', 'kanji');
    els.kanjiCount.textContent = `${data.length} 件`;

    if (data.length === 0) {
        els.kanjiTable.innerHTML = `<tr><td colspan="7" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <div>該当する漢字が見つかりません</div>
        </td></tr>`;
        return;
    }

    els.kanjiTable.innerHTML = data.map(item => {
        const originalIndex = item._kanjiIndex;
        const isHighlight = highlightKanji && item.kanji === highlightKanji;
        // 元の値と比較して変更済みかチェック
        const orig = kanjiDataOriginal[item.kanji] || {};
        const isDirtyOn  = JSON.stringify(item.on_readings)  !== JSON.stringify(orig.on_readings);
        const isDirtyKun = JSON.stringify(item.kun_readings) !== JSON.stringify(orig.kun_readings);
        const isDirtyMen = JSON.stringify(item.meanings)     !== JSON.stringify(orig.meanings);
        const isDirtyMja = JSON.stringify(item.meanings_ja)  !== JSON.stringify(orig.meanings_ja);
        const rowDirty   = isDirtyOn || isDirtyKun || isDirtyMen || isDirtyMja;
        return `<tr data-index="${originalIndex}"${isHighlight ? ' class="highlight-row"' : ''}>
            <td class="kanji-cell">${escapeHtml(item.kanji || '')}</td>
            <td><input class="inline-input${isDirtyOn  ? ' inline-input--dirty' : ''}" data-index="${originalIndex}" data-field="on_readings"  value="${escapeHtml((item.on_readings  || []).join(' '))}"></td>
            <td><input class="inline-input${isDirtyKun ? ' inline-input--dirty' : ''}" data-index="${originalIndex}" data-field="kun_readings" value="${escapeHtml((item.kun_readings || []).join(' '))}"></td>
            <td><input class="inline-input${isDirtyMen ? ' inline-input--dirty' : ''}" data-index="${originalIndex}" data-field="meanings"     value="${escapeHtml((item.meanings     || []).join(', '))}"></td>
            <td><input class="inline-input${isDirtyMja ? ' inline-input--dirty' : ''}" data-index="${originalIndex}" data-field="meanings_ja"  value="${escapeHtml((item.meanings_ja  || []).join(', '))}"></td>
            <td><span class="badge badge-blue">${(item.examples || []).length}</span></td>
            <td class="kanji-actions">
                <button class="btn btn-sm btn-secondary" data-modal-index="${originalIndex}">詳細</button>
                ${rowDirty ? `<button class="btn btn-sm btn-ghost" data-undo-kanji="${escapeHtml(item.kanji)}" title="この行の変更を元に戻す">↩</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

let _modalOpener = null; // モーダルを開いたボタンを記憶（閉じたときフォーカスを戻す）

function openModal(index) {
    const item = kanjiData[index];
    if (!item) return;
    _modalOpener = document.activeElement;
    els.modalTitle.textContent = `「${item.kanji || ''}」の詳細`;
    els.detailKanji.textContent = item.kanji || '';
    els.detailExamplesCount.textContent = (item.examples || []).length + ' 件';
    els.detailOn.textContent = (item.on_readings || []).join('　') || '—';
    els.detailKun.textContent = (item.kun_readings || []).join('　') || '—';
    els.detailMeanings.textContent = (item.meanings || []).join('、') || '—';
    els.detailMeaningsJa.textContent = (item.meanings_ja || []).join('、') || '—';
    els.detailExamples.textContent = JSON.stringify(item.examples || [], null, 2);
    els.modal.classList.add('active');
    // フォーカスを閉じるボタンに移動
    els.modalClose.focus();
    // フォーカストラップ
    els.modal.addEventListener('keydown', trapFocus);
}

function closeModal() {
    els.modal.classList.remove('active');
    els.modal.removeEventListener('keydown', trapFocus);
    // フォーカスをモーダルを開いたボタンに戻す
    if (_modalOpener && typeof _modalOpener.focus === 'function') {
        _modalOpener.focus();
    }
    _modalOpener = null;
}

function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const focusable = [...els.modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
}

function updateKanjiFieldInline(input) {
    const index = parseInt(input.dataset.index, 10);
    const field = input.dataset.field;
    const item = kanjiData[index];
    if (!item) return;

    const raw = input.value.trim();
    item[field] = parseKanjiField(field, raw); // admin-logic-browser.js

    // 元の値と比較して変更があれば input にマーク
    const orig = kanjiDataOriginal[item.kanji];
    if (orig) {
        const origVal = (orig[field] || []).join(field.includes('meanings') ? ', ' : ' ');
        input.classList.toggle('inline-input--dirty', raw !== origVal);
    }
    setDirty(true);
}

// 漢字インライン編集を元の値に戻す（行単位）
function resetKanjiRow(kanjiChar) {
    const orig = kanjiDataOriginal[kanjiChar];
    const item = kanjiData.find(d => d.kanji === kanjiChar);
    if (!orig || !item) return;
    item.on_readings  = [...orig.on_readings];
    item.kun_readings = [...orig.kun_readings];
    item.meanings     = [...orig.meanings];
    item.meanings_ja  = [...orig.meanings_ja];
    renderKanjiTable();
    // 他に dirty な行がなければダーティフラグをクリア
    const anyDirty = kanjiData.some(d => {
        const o = kanjiDataOriginal[d.kanji];
        if (!o) return false;
        return JSON.stringify(d.on_readings)  !== JSON.stringify(o.on_readings) ||
               JSON.stringify(d.kun_readings) !== JSON.stringify(o.kun_readings) ||
               JSON.stringify(d.meanings)     !== JSON.stringify(o.meanings)     ||
               JSON.stringify(d.meanings_ja)  !== JSON.stringify(o.meanings_ja);
    });
    if (!anyDirty) setDirty(false);
    showToast(`${kanjiChar} の変更を元に戻しました`);
}


// 例文の変更をメモリ上の examplesData に反映してダーティフラグを立てる
function updateSentenceInMemory(input) {
    const sentenceId = input.dataset.sentenceId;
    const grade      = input.dataset.grade;
    const kanji      = input.dataset.kanji;
    const wordIndex  = parseInt(input.dataset.wordIndex, 10);
    const newSentence = input.value.trim();

    // sentenceId があれば ID で特定、なければ (grade, kanji, wordIndex) で特定
    const entry = sentenceId
        ? examplesData.find(ex => ex.sentenceId === sentenceId)
        : examplesData.find(ex =>
            String(ex.grade) === String(grade) &&
            ex.kanji === kanji &&
            ex.wordIndex === wordIndex
          );
    if (entry) {
        entry.sentence = newSentence;
        entry._dirty = true;
    }
    setDirty(true);
}

// 例文行をメモリから削除してダーティフラグを立てる
function deleteExampleRow(dataIndex) {
    const entry = examplesData[dataIndex];
    if (!entry) return;
    const preview = entry.sentence ? `「${entry.sentence.slice(0, 20)}${entry.sentence.length > 20 ? '…' : ''}」` : '（空の例文）';
    if (!confirm(`${entry.kanji} の例文 ${preview} を削除しますか？\n※右上の保存ボタンを押すまで確定しません`)) return;
    deletedExamples.push({ ...entry });
    examplesData.splice(dataIndex, 1);
    setDirty(true);
    els.btnUndoDelete.style.display = '';
    renderExamplesTable(examplesData);
    showToast('行を削除しました（右上の保存ボタンで確定）');
}

// 例文タブの変更をまとめてファイルに保存する（変更のある漢字・語彙だけ差分更新）
async function saveExamples() {
    const dirtyEntries = examplesData.filter(ex => ex._dirty);
    if (dirtyEntries.length === 0 && deletedExamples.length === 0) {
        showToast('変更はありません');
        return;
    }

    // 変更・削除が発生したグレードをまとめる
    const gradeSet = [...new Set([
        ...dirtyEntries.map(ex => String(ex.grade)),
        ...deletedExamples.map(ex => String(ex.grade))
    ])];

    const saveBtn = document.getElementById('btn-save');
    setLoading(saveBtn, true);
    let savedCount = 0;
    try {
        for (const grade of gradeSet) {
            // サーバーから最新を取得（他の変更と競合しないよう）
            const data = await apiGet(`/grade/${encodeURIComponent(grade)}`);

            // 変更・削除が発生した (kanji文字, wordIndex) の組を列挙
            const allChanged = [
                ...dirtyEntries.filter(ex => String(ex.grade) === grade),
                ...deletedExamples.filter(ex => String(ex.grade) === grade)
            ];
            const affectedKeys = new Set(allChanged.map(ex => `${ex.kanji}\x00${ex.wordIndex}`));

            for (const key of affectedKeys) {
                const sep = key.indexOf('\x00');
                const kanjiChar = key.slice(0, sep);
                const wi = Number(key.slice(sep + 1));

                const item = data.find(d => d.kanji === kanjiChar);
                if (!item || !item.examples || !item.examples[wi]) continue;
                const exObj = item.examples[wi];

                // examplesData に残っている同 (grade, kanji, wordIndex) の行だけを
                // sentenceId ベースで再構築（削除済みは examplesData にないので自動除外）
                const remaining = examplesData
                    .filter(ex =>
                        String(ex.grade) === grade &&
                        ex.kanji === kanjiChar &&
                        ex.wordIndex === wi
                    )
                    .map(ex => ({ id: ex.sentenceId, text: ex.sentence }))
                    .filter(s => s.text.trim() !== '');

                exObj.sentences = remaining;
                savedCount++;
            }

            await apiPut(`/grade/${encodeURIComponent(grade)}`, data);
            if (String(currentGrade) === grade) kanjiData = data;
        }

        examplesData.forEach(ex => { ex._dirty = false; });
        deletedExamples = [];
        setDirty(false);
        els.btnUndoDelete.style.display = 'none';
        showToast(`${savedCount} 語彙の例文を保存しました（${gradeSet.join(', ')}級）`);
    } catch (e) {
        handleError('例文の保存に失敗しました', e);
    } finally {
        setLoading(saveBtn, false);
    }
}

async function saveCurrentGrade() {
    if (!currentGrade) {
        showToast('級を選択してください', 'error');
        return;
    }
    try {
        await apiPut(`/grade/${encodeURIComponent(currentGrade)}`, kanjiData);
        setDirty(false);
        showToast(`${currentGrade}級を保存しました`);
    } catch (e) {
        handleError('保存に失敗しました', e);
    }
}

// ── Word Relations: メモリ上のデータ ──────────────────────────────────────
// wordRelations.antonyms  : [{ word, antonym }, ...]
// wordRelations.synonyms  : [{ word, synonym }, ...]
// wordRelations.same_kun  : [{ reading, kanji[] }, ...]
// wordRelations.homophones: [{ kanji, homophones[] }, ...]  ※読み取り専用

async function loadRelations() {
    try {
        wordRelations = await apiGet('/word-relations');
        setDirty(false);
    } catch (e) {
        handleError('word-relations の読み込みに失敗しました', e);
    }
}

// ── 対義語テーブル ─────────────────────────────────────────────────────────
function renderAntonyms(data, search = '') {
    // 表示用にフィルタリング（元データのインデックスを保持）
    const rows = data.map((row, i) => ({ row, i })).filter(({ row }) =>
        !search || (row.word || '').includes(search) || (row.antonym || '').includes(search)
    );
    els.relAntonymsCount.textContent = search ? `${rows.length} / ${data.length} 件` : `${data.length} 件`;
    els.relAntonymsBody.innerHTML = rows.length === 0
        ? `<tr><td colspan="3" class="empty-state">${search ? '該当なし' : 'データなし — ＋追加で登録'}</td></tr>`
        : rows.map(({ row, i }) => `
        <tr data-rel-type="antonyms" data-rel-index="${i}">
            <td><input class="inline-input rel-input" data-rel-type="antonyms" data-rel-index="${i}" data-rel-field="word"    value="${escapeHtml(row.word    || '')}"></td>
            <td><input class="inline-input rel-input" data-rel-type="antonyms" data-rel-index="${i}" data-rel-field="antonym" value="${escapeHtml(row.antonym || '')}"></td>
            <td class="rel-actions"><button class="btn btn-sm btn-danger" data-rel-delete="antonyms" data-rel-index="${i}" title="削除">✕</button></td>
        </tr>`).join('');
}

// ── 類義語テーブル ─────────────────────────────────────────────────────────
function renderSynonyms(data, search = '') {
    const rows = data.map((row, i) => ({ row, i })).filter(({ row }) =>
        !search || (row.word || '').includes(search) || (row.synonym || '').includes(search)
    );
    els.relSynonymsCount.textContent = search ? `${rows.length} / ${data.length} 件` : `${data.length} 件`;
    els.relSynonymsBody.innerHTML = rows.length === 0
        ? `<tr><td colspan="3" class="empty-state">${search ? '該当なし' : 'データなし — ＋追加で登録'}</td></tr>`
        : rows.map(({ row, i }) => `
        <tr data-rel-type="synonyms" data-rel-index="${i}">
            <td><input class="inline-input rel-input" data-rel-type="synonyms" data-rel-index="${i}" data-rel-field="word"    value="${escapeHtml(row.word    || '')}"></td>
            <td><input class="inline-input rel-input" data-rel-type="synonyms" data-rel-index="${i}" data-rel-field="synonym" value="${escapeHtml(row.synonym || '')}"></td>
            <td class="rel-actions"><button class="btn btn-sm btn-danger" data-rel-delete="synonyms" data-rel-index="${i}" title="削除">✕</button></td>
        </tr>`).join('');
}

// ── 同訓異字テーブル ───────────────────────────────────────────────────────
function renderSameKun(data, search = '') {
    const rows = data.map((row, i) => ({ row, i })).filter(({ row }) =>
        !search || (row.reading || '').includes(search) || (row.kanji || []).some(k => k.includes(search))
    );
    els.relSameKunCount.textContent = search ? `${rows.length} / ${data.length} 件` : `${data.length} 件`;
    els.relSameKunBody.innerHTML = rows.length === 0
        ? `<tr><td colspan="3" class="empty-state">${search ? '該当なし' : 'データなし — ＋追加で登録'}</td></tr>`
        : rows.map(({ row, i }) => `
        <tr data-rel-type="same_kun" data-rel-index="${i}">
            <td><input class="inline-input rel-input" data-rel-type="same_kun" data-rel-index="${i}" data-rel-field="reading" value="${escapeHtml(row.reading || '')}"></td>
            <td><input class="inline-input rel-input rel-input--wide" data-rel-type="same_kun" data-rel-index="${i}" data-rel-field="kanji" value="${escapeHtml((row.kanji || []).join(' '))}"></td>
            <td class="rel-actions"><button class="btn btn-sm btn-danger" data-rel-delete="same_kun" data-rel-index="${i}" title="削除">✕</button></td>
        </tr>`).join('');
}

// ── 同音異字テーブル（編集可能）─────────────────────────────────────────
function renderHomophones(data, search = '', selectedKanji) {
    const rows = filterHomophones(data, search, selectedKanji);
    const filtered = Boolean(search) || selectedKanji instanceof Set;
    els.relHomophonesCount.textContent = filtered ? `${rows.length} / ${data.length} 件` : `${data.length} 件`;
    els.relHomophonesBody.innerHTML = rows.length === 0
        ? `<tr><td colspan="3" class="empty-state">${filtered ? '該当なし' : 'データなし — ＋追加で登録'}</td></tr>`
        : rows.map(({ row, i }) => {
            const manualBadge = row._manual
                ? `<span class="homo-chip homo-chip--manual" title="手動エントリ：自動生成で上書きされません">手動</span> `
                : `<span class="homo-chip homo-chip--auto" title="自動生成エントリ">自動</span> `;
            return `<tr data-rel-type="homophones" data-rel-index="${i}">
                <td><input class="inline-input rel-input" data-rel-type="homophones" data-rel-index="${i}" data-rel-field="kanji" value="${escapeHtml(row.kanji || '')}"></td>
                <td>
                    ${manualBadge}<input class="inline-input rel-input rel-input--wide" data-rel-type="homophones" data-rel-index="${i}" data-rel-field="homophones" value="${escapeHtml((row.homophones || []).join(' '))}">
                </td>
                <td class="rel-actions"><button class="btn btn-sm btn-danger" data-rel-delete="homophones" data-rel-index="${i}" title="削除">✕</button></td>
            </tr>`;
        }).join('');
}

// ── 行追加 ────────────────────────────────────────────────────────────────
async function addRelRow(type) {
    wordRelations[type] = wordRelations[type] || [];
    if (type === 'antonyms')        wordRelations.antonyms.push({ word: '', antonym: '' });
    else if (type === 'synonyms')   wordRelations.synonyms.push({ word: '', synonym: '' });
    else if (type === 'same_kun')   wordRelations.same_kun.push({ reading: '', kanji: [] });
    else if (type === 'homophones') wordRelations.homophones.push({ kanji: '', homophones: [], _manual: true });
    await rerenderRel(type);
    // 追加した行の最初の input にフォーカス
    document.getElementById(`rel-${type}-body`)?.querySelector('tr:last-child input')?.focus();
    setDirty(true);
}

// ── インライン編集: input の変更をメモリに反映 ───────────────────────────
function updateRelField(input) {
    const type  = input.dataset.relType;
    const index = parseInt(input.dataset.relIndex, 10);
    const field = input.dataset.relField;
    const arr   = wordRelations[type];
    if (!arr || !arr[index]) return;
    // スペース区切り配列フィールド
    if ((type === 'same_kun' && field === 'kanji') ||
        (type === 'homophones' && field === 'homophones')) {
        arr[index][field] = input.value.trim().split(/\s+/).filter(Boolean);
    } else {
        arr[index][field] = input.value.trim();
    }
    // homophones を編集したら手動フラグを立てる
    if (type === 'homophones') arr[index]._manual = true;
    setDirty(true);
}

// ── 行削除 ────────────────────────────────────────────────────────────────
function deleteRelRow(type, index) {
    const arr = wordRelations[type];
    if (!arr) return;
    arr.splice(index, 1);
    rerenderRel(type);
    setDirty(true);
}

// ── 現在の検索語でタイプに応じた render を呼ぶ ──────────────────────────
function rerenderRel(type) {
    return renderRelTab(type);
}

// ── 例文削除の Undo（最後に削除した1件を戻す）────────────────────────────
function undoDeleteExample() {
    if (deletedExamples.length === 0) return;
    const entry = deletedExamples.pop();
    examplesData.push(entry);
    if (deletedExamples.length === 0) els.btnUndoDelete.style.display = 'none';
    setDirty(examplesData.some(ex => ex._dirty) || deletedExamples.length > 0);
    renderExamplesTable(examplesData);
    showToast(`「${entry.sentence.slice(0, 20)}」の削除を元に戻しました`);
}

async function saveRelations() {
    try {
        const body = {
            antonyms:   wordRelations.antonyms   || [],
            synonyms:   wordRelations.synonyms   || [],
            same_kun:   wordRelations.same_kun    || [],
            homophones: wordRelations.homophones || []
        };
        await apiPut('/word-relations', body);
        setDirty(false);
        showToast('word-relations を保存しました');
    } catch (e) {
        handleError('保存に失敗しました', e);
    }
}

async function editFromAudit(grade, kanjiChar) {
    // 漢字データタブに切り替え
    currentTab = 'kanji';
    els.tabs.forEach(t => t.classList.remove('active'));
    els.panels.forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="kanji"]').classList.add('active');
    document.getElementById('tab-kanji').classList.add('active');
    els.pageTitle.textContent = TAB_TITLES.kanji;
    els.examplesFilterSection.style.display = 'none';
    // 検索ボックスをリセット
    globalSearchTerm = ''; searchTerm = ''; els.globalSearch.value = '';
    els.globalSearch.placeholder = '漢字・読み・意味で検索…';
    document.getElementById('topbar-search-wrap').style.display = '';

    // 級を選択して読み込み
    if (String(currentGrade) !== String(grade) || kanjiData.length === 0) {
        if (isDirty && !confirm('未保存の変更があります。このまま別の級を読み込むと変更が失われます。続けますか？')) {
            return;
        }
        currentGrade = String(grade);
        try {
            kanjiData = await apiGet(`/grade/${encodeURIComponent(currentGrade)}`);
            setDirty(false);
        } catch (e) {
            handleError('データの読み込みに失敗しました', e);
            return;
        }
    }

    // 該当漢字をハイライト
    highlightKanji = kanjiChar;
    renderKanjiTable();
    highlightKanji = null;

    // 該当行にスクロール
    const row = els.kanjiTable.querySelector('tr.highlight-row');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadExamples() {
    if (selectedGrades.length === 0) {
        showToast('級を選択してください', 'error');
        return;
    }
    setLoading(els.btnLoadExamples, true);
    try {
        const filter = currentExamplesFilter;
        const gradeQuery = selectedGrades.join(',');
        let query = `?grade=${encodeURIComponent(gradeQuery)}`;
        if (filter) query += `&filter=${encodeURIComponent(filter)}`;

        const examples = await apiGet('/examples' + query);
        examplesData = examples;
        deletedExamples = [];
        renderExamplesTable(examplesData);

        const gradeText = selectedGrades.length === allGrades.length ? '全級' : selectedGrades.map(g => g + '級').join(', ');
        els.pageTitle.textContent = `${gradeText}の例文一覧`;
        showToast(`${examples.length} 件の例文を読み込みました`);
    } catch (e) {
        handleError('例文一覧の取得に失敗しました', e);
    } finally {
        setLoading(els.btnLoadExamples, false);
    }
}

function renderExamplesTable(examples) {
    // クライアントサイド検索フィルター（_originalIndex は元配列の位置を保持）
    const filtered = globalSearchTerm
        ? examples
            .map((ex, i) => ({ ex, i }))
            .filter(({ ex }) => {
                const s = globalSearchTerm;
                return (ex.kanji || '').includes(s) ||
                    (ex.word  || '').includes(s)  ||
                    (ex.sentence || '').includes(s);
            })
            .map(({ ex, i }) => ({ ...ex, _originalIndex: i }))
        : examples.map((ex, i) => ({ ...ex, _originalIndex: i }));

    const TYPE_ORDER = { ok: 0, empty: 1, long: 2, too_long: 3, inappropriate: 4 };
    const withOrder = filtered.map(ex => ({ ...ex, _typeOrder: TYPE_ORDER[ex.type] ?? 9 }));
    const sorted = sortDataByTab(withOrder, 'examples');
    if (sortState.examples.key === 'type') {
        sorted.sort((a, b) => (a._typeOrder - b._typeOrder) * sortState.examples.dir);
    }

    updateSortIndicators('examples-table', 'examples');
    els.examplesCount.textContent = globalSearchTerm
        ? `${filtered.length} / ${examples.length} 件`
        : `${examples.length} 件`;

    if (examples.length === 0) {
        els.examplesTable.innerHTML = `<tr><td colspan="5" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <div>該当する例文が見つかりません</div>
        </td></tr>`;
        return;
    }

    const typeLabels = {
        ok: { text: 'OK', class: 'badge-green' },
        long: { text: '15文字超', class: 'badge-amber' },
        too_long: { text: '20文字超', class: 'badge-red' },
        inappropriate: { text: '不適切', class: 'badge-red' },
        empty: { text: 'なし', class: 'badge-blue' }
    };
    els.examplesTable.innerHTML = sorted.map((ex) => {
        const badge = typeLabels[ex.type] || typeLabels.ok;
        const dataIndex = ex._originalIndex;
        const charCount = countDisplayChars(ex.sentence);
        const countClass = charCount > 20 ? 'char-count too-long' : charCount > 15 ? 'char-count long' : 'char-count';
        return `<tr>
            <td><span class="badge badge-blue">${ex.grade}</span></td>
            <td class="kanji-cell">${escapeHtml(ex.kanji)}</td>
            <td><span class="badge ${badge.class}">${badge.text}</span></td>
            <td class="sentence-cell">
                <input type="text" class="sentence-input" value="${escapeHtml(ex.sentence)}" data-grade="${ex.grade}" data-kanji="${escapeHtml(ex.kanji)}" data-word-index="${ex.wordIndex}" data-sentence-id="${ex.sentenceId || ''}">
                <span class="${countClass}">${charCount}</span>
            </td>
            <td><button class="btn btn-sm btn-danger" data-delete-index="${dataIndex}">削除</button></td>
        </tr>`;
    }).join('');
}

async function runAudit() {
    if (selectedGrades.length === 0) {
        showToast('級を選択してください', 'error');
        return;
    }
    setLoading(els.btnRunAudit, true);
    try {
        const gradeQuery = selectedGrades.join(',');
        const issues = await apiGet('/audit?grade=' + encodeURIComponent(gradeQuery));
        auditData = issues;

        const gradeText = selectedGrades.length === allGrades.length ? '全級' : selectedGrades.map(g => g + '級').join(', ');
        els.pageTitle.textContent = `${gradeText}の監査結果`;

        renderAuditTable(auditData);
    } catch (e) {
        handleError('監査に失敗しました', e);
    } finally {
        setLoading(els.btnRunAudit, false);
    }
}

function renderAuditTable(issues) {
    // クライアントサイド検索フィルター
    const filtered = globalSearchTerm
        ? issues.filter(issue => {
            const s = globalSearchTerm;
            return (issue.kanji   || '').includes(s) ||
                   (issue.word    || '').includes(s) ||
                   (issue.sentence || '').includes(s);
        })
        : issues;

    const TYPE_ORDER = { long: 0, too_long: 1, inappropriate: 2 };
    let sorted = sortDataByTab(filtered, 'audit');
    if (sortState.audit.key === 'type') {
        sorted = [...filtered].sort((a, b) =>
            ((TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)) * sortState.audit.dir
        );
    }

    updateSortIndicators('audit-table', 'audit');
    els.auditCount.textContent = globalSearchTerm
        ? `${filtered.length} / ${issues.length} 件`
        : `${issues.length} 件`;

    if (filtered.length === 0) {
        const msg = globalSearchTerm ? '該当する監査結果が見つかりません' : '問題は見つかりませんでした';
        const icon = globalSearchTerm
            ? `<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>`
            : `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>`;
        els.auditTable.innerHTML = `<tr><td colspan="7" class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon}</svg>
                <div>${msg}</div>
            </td></tr>`;
        return;
    }

    els.auditTable.innerHTML = sorted.map(issue => {
        const typeLabel = issue.type === 'too_long' ? '20文字超' : (issue.type === 'inappropriate' ? '不適切' : '15文字超');
        const typeClass = issue.type === 'too_long' ? 'badge-red' : (issue.type === 'inappropriate' ? 'badge-red' : 'badge-amber');
        return `<tr>
                <td><span class="badge badge-blue">${issue.grade}</span></td>
                <td class="kanji-cell">${escapeHtml(issue.kanji)}</td>
                <td>${escapeHtml(issue.word)}</td>
                <td>${issue.len}</td>
                <td><span class="badge ${typeClass}">${typeLabel}</span></td>
                <td class="audit-sentence">${escapeHtml(issue.sentence)}</td>
                <td><button class="btn btn-sm" onclick="editFromAudit(${issue.grade}, '${escapeHtml(issue.kanji)}')">修正</button></td>
            </tr>`;
    }).join('');
}

init();
