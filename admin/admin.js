const API_BASE = '/api';
const TAB_TITLES = {
    kanji: '漢字データ',
    relations: 'Word Relations',
    examples: '例文一覧',
    audit: '監査'
};

let currentGrade = null;
let kanjiData = [];
let wordRelations = {};
let sortKey = 'kanji';
let sortDir = 1;
let searchTerm = '';
let allGrades = [];
let selectedGrades = [];

const els = {
    pageTitle: document.getElementById('page-title'),
    gradeToggles: document.getElementById('grade-toggles'),
    btnSelectAllGrades: document.getElementById('btn-select-all-grades'),
    btnDeselectAllGrades: document.getElementById('btn-deselect-all-grades'),
    btnSave: document.getElementById('btn-save'),
    btnReload: document.getElementById('btn-reload'),
    btnAddKanji: document.getElementById('btn-add-kanji'),
    kanjiSearch: document.getElementById('kanji-search'),
    kanjiCount: document.getElementById('kanji-count'),
    kanjiTable: document.querySelector('#kanji-table tbody'),
    auditTable: document.querySelector('#audit-table tbody'),
    auditCount: document.getElementById('audit-count'),
    btnRunAudit: document.getElementById('btn-run-audit'),
    examplesTable: document.querySelector('#examples-table tbody'),
    examplesCount: document.getElementById('examples-count'),
    examplesFilter: document.getElementById('examples-filter'),
    btnLoadExamples: document.getElementById('btn-load-examples'),
    tabs: document.querySelectorAll('.nav-tab'),
    panels: document.querySelectorAll('.tab-panel'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalClose: document.getElementById('modal-close'),
    kanjiForm: document.getElementById('kanji-form'),
    editIndex: document.getElementById('edit-index'),
    editKanji: document.getElementById('edit-kanji'),
    editExamplesCount: document.getElementById('edit-examples-count'),
    editOn: document.getElementById('edit-on_readings'),
    editKun: document.getElementById('edit-kun_readings'),
    editMeanings: document.getElementById('edit-meanings'),
    editMeaningsJa: document.getElementById('edit-meanings_ja'),
    editExamples: document.getElementById('edit-examples'),
    btnDeleteKanji: document.getElementById('btn-delete-kanji'),
    relationsAntonyms: document.getElementById('relations-antonyms'),
    relationsSynonyms: document.getElementById('relations-synonyms'),
    relationsSameKun: document.getElementById('relations-same_kun'),
    relationsHomophones: document.getElementById('relations-homophones'),
    btnSaveRelations: document.getElementById('btn-save-relations'),
    relationsStatus: document.getElementById('relations-status'),
    toast: document.getElementById('toast')
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

async function init() {
    try {
        const grades = await apiGet('/grades');
        allGrades = grades.map(g => g.grade).sort((a, b) => a - b);
        selectedGrades = [...allGrades];
        renderGradeToggles();
        if (selectedGrades.length > 0) {
            currentGrade = String(selectedGrades[0]);
            await loadGrade(currentGrade);
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

    // 漢字データタブでは選択変更時に先頭の級を読み込む
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (activeTab === 'kanji') {
        const first = selectedGrades[0];
        if (first !== undefined) {
            currentGrade = String(first);
            loadGrade(currentGrade);
        }
    }
}

function selectAllGrades() {
    selectedGrades = [...allGrades];
    renderGradeToggles();
}

function deselectAllGrades() {
    selectedGrades = [];
    renderGradeToggles();
}

function bindEvents() {
    els.btnSelectAllGrades.addEventListener('click', selectAllGrades);
    els.btnDeselectAllGrades.addEventListener('click', deselectAllGrades);

    els.btnReload.addEventListener('click', () => {
        if (currentGrade) loadGrade(currentGrade);
    });

    els.btnSave.addEventListener('click', saveCurrentGrade);
    els.btnAddKanji.addEventListener('click', () => openModal());
    els.kanjiSearch.addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        renderKanjiTable();
    });

    document.querySelectorAll('#kanji-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (sortKey === key) sortDir *= -1;
            else { sortKey = key; sortDir = 1; }
            renderKanjiTable();
        });
    });

    els.modalClose.addEventListener('click', closeModal);
    els.kanjiForm.addEventListener('submit', saveKanji);
    els.btnDeleteKanji.addEventListener('click', deleteKanji);

    els.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            els.tabs.forEach(t => t.classList.remove('active'));
            els.panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('tab-' + tabName).classList.add('active');
            els.pageTitle.textContent = TAB_TITLES[tabName];
            if (tabName === 'relations') loadRelations();
        });
    });

    els.btnSaveRelations.addEventListener('click', saveRelations);
    els.btnRunAudit.addEventListener('click', runAudit);
    els.btnLoadExamples.addEventListener('click', loadExamples);

    // モーダル外クリックで閉じる
    els.modal.addEventListener('click', (e) => {
        if (e.target === els.modal) closeModal();
    });
}

async function loadGrade(grade) {
    try {
        kanjiData = await apiGet(`/grade/${encodeURIComponent(grade)}`);
        renderKanjiTable();
        if (els.pageTitle) els.pageTitle.textContent = `${grade}級の漢字データ`;
        showToast(`${grade}級を読み込みました`);
    } catch (e) {
        handleError('データの読み込みに失敗しました', e);
    }
}

function renderKanjiTable() {
    let data = kanjiData.filter(item => {
        if (!searchTerm) return true;
        const s = searchTerm;
        return (item.kanji || '').includes(s) ||
            (item.on_readings || []).join(' ').toLowerCase().includes(s) ||
            (item.kun_readings || []).join(' ').toLowerCase().includes(s) ||
            (item.meanings || []).join(' ').toLowerCase().includes(s) ||
            (item.meanings_ja || []).join(' ').toLowerCase().includes(s);
    });

    data.sort((a, b) => {
        let av, bv;
        if (sortKey === 'kanji') { av = a.kanji || ''; bv = b.kanji || ''; }
        else if (sortKey === 'examples') { av = (a.examples || []).length; bv = (b.examples || []).length; }
        else { av = ((a[sortKey] || []).join(' ')); bv = ((b[sortKey] || []).join(' ')); }
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
    });

    els.kanjiCount.textContent = `${data.length} 件`;

    if (data.length === 0) {
        els.kanjiTable.innerHTML = `<tr><td colspan="7" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <div>該当する漢字が見つかりません</div>
        </td></tr>`;
        return;
    }

    els.kanjiTable.innerHTML = data.map(item => {
        const originalIndex = kanjiData.indexOf(item);
        return `<tr data-index="${originalIndex}">
            <td class="kanji-cell">${item.kanji || ''}</td>
            <td>${(item.on_readings || []).join(' ')}</td>
            <td>${(item.kun_readings || []).join(' ')}</td>
            <td>${(item.meanings || []).join(', ')}</td>
            <td>${(item.meanings_ja || []).join(', ')}</td>
            <td><span class="badge badge-blue">${(item.examples || []).length}</span></td>
            <td><button class="btn btn-sm" onclick="openModal(${originalIndex})">編集</button></td>
        </tr>`;
    }).join('');
}

function openModal(index = -1) {
    const isNew = index === -1;
    const item = isNew ? {} : kanjiData[index];
    els.modalTitle.textContent = isNew ? '漢字を追加' : `「${item.kanji || ''}」を編集`;
    els.editIndex.value = isNew ? '' : index;
    els.editKanji.value = item.kanji || '';
    els.editExamplesCount.value = (item.examples || []).length + ' 件';
    els.editOn.value = (item.on_readings || []).join(' ');
    els.editKun.value = (item.kun_readings || []).join(' ');
    els.editMeanings.value = (item.meanings || []).join('\n');
    els.editMeaningsJa.value = (item.meanings_ja || []).join('\n');
    els.editExamples.value = JSON.stringify(item.examples || [], null, 2);
    els.btnDeleteKanji.style.display = isNew ? 'none' : 'inline-flex';
    els.modal.classList.add('active');
}

function closeModal() {
    els.modal.classList.remove('active');
}

function saveKanji(e) {
    e.preventDefault();
    const index = els.editIndex.value === '' ? -1 : parseInt(els.editIndex.value, 10);
    let examples;
    try {
        examples = JSON.parse(els.editExamples.value || '[]');
    } catch (err) {
        handleError('例文の JSON が不正です', err);
        return;
    }

    const item = {
        kanji: els.editKanji.value.trim(),
        on_readings: els.editOn.value.trim().split(/\s+/).filter(Boolean),
        kun_readings: els.editKun.value.trim().split(/\s+/).filter(Boolean),
        meanings: els.editMeanings.value.trim().split(/\n/).map(s => s.trim()).filter(Boolean),
        meanings_ja: els.editMeaningsJa.value.trim().split(/\n/).map(s => s.trim()).filter(Boolean),
        examples: examples
    };

    if (index === -1) {
        kanjiData.push(item);
    } else {
        kanjiData[index] = item;
    }

    renderKanjiTable();
    closeModal();
    showToast('漢字データを更新しました（保存は別途「保存」ボタン）');
}

function deleteKanji() {
    const index = parseInt(els.editIndex.value, 10);
    if (!confirm(`「${kanjiData[index].kanji}」を削除してよろしいですか？\nこの操作は元に戻せません。`)) return;
    kanjiData.splice(index, 1);
    renderKanjiTable();
    closeModal();
    showToast('漢字を削除しました（保存は別途「保存」ボタン）');
}

async function saveCurrentGrade() {
    if (!currentGrade) {
        showToast('級を選択してください', 'error');
        return;
    }
    try {
        await apiPut(`/grade/${encodeURIComponent(currentGrade)}`, kanjiData);
        showToast(`${currentGrade}級を保存しました`);
    } catch (e) {
        handleError('保存に失敗しました', e);
    }
}

async function loadRelations() {
    try {
        wordRelations = await apiGet('/word-relations');
        els.relationsAntonyms.value = JSON.stringify(wordRelations.antonyms || [], null, 2);
        els.relationsSynonyms.value = JSON.stringify(wordRelations.synonyms || [], null, 2);
        els.relationsSameKun.value = JSON.stringify(wordRelations.same_kun || [], null, 2);
        els.relationsHomophones.value = JSON.stringify(wordRelations.homophones || [], null, 2);
        els.relationsStatus.textContent = '読み込み済み';
    } catch (e) {
        handleError('word-relations の読み込みに失敗しました', e);
    }
}

async function saveRelations() {
    try {
        const body = {
            antonyms: JSON.parse(els.relationsAntonyms.value || '[]'),
            synonyms: JSON.parse(els.relationsSynonyms.value || '[]'),
            same_kun: JSON.parse(els.relationsSameKun.value || '[]'),
            homophones: JSON.parse(els.relationsHomophones.value || '[]')
        };
        await apiPut('/word-relations', body);
        els.relationsStatus.textContent = '保存しました';
        showToast('word-relations を保存しました');
    } catch (e) {
        handleError('保存に失敗しました', e);
    }
}

async function editFromAudit(grade, kanjiIndex) {
    // 漢字データタブに切り替え
    els.tabs.forEach(t => t.classList.remove('active'));
    els.panels.forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="kanji"]').classList.add('active');
    document.getElementById('tab-kanji').classList.add('active');
    els.pageTitle.textContent = TAB_TITLES.kanji;

    // 級を選択して読み込み
    if (String(currentGrade) !== String(grade) || kanjiData.length === 0) {
        currentGrade = String(grade);
        try {
            kanjiData = await apiGet(`/grade/${encodeURIComponent(currentGrade)}`);
        } catch (e) {
            handleError('データの読み込みに失敗しました', e);
            return;
        }
    }

    renderKanjiTable();
    openModal(kanjiIndex);
}

async function loadExamples() {
    try {
        if (selectedGrades.length === 0) {
            showToast('級を選択してください', 'error');
            return;
        }
        const filter = els.examplesFilter.value;
        const gradeQuery = selectedGrades.join(',');
        let query = `?grade=${encodeURIComponent(gradeQuery)}`;
        if (filter) query += `&filter=${encodeURIComponent(filter)}`;

        const examples = await apiGet('/examples' + query);
        renderExamplesTable(examples);

        const gradeText = selectedGrades.length === allGrades.length ? '全級' : selectedGrades.map(g => g + '級').join(', ');
        els.pageTitle.textContent = `${gradeText}の例文一覧`;
        showToast(`${examples.length} 件の例文を読み込みました`);
    } catch (e) {
        handleError('例文一覧の取得に失敗しました', e);
    }
}

function renderExamplesTable(examples) {
    els.examplesCount.textContent = `${examples.length} 件`;

    if (examples.length === 0) {
        els.examplesTable.innerHTML = `<tr><td colspan="8" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <div>該当する例文が見つかりません</div>
        </td></tr>`;
        return;
    }

    els.examplesTable.innerHTML = examples.map(ex => {
        const typeLabels = {
            ok: { text: 'OK', class: 'badge-green' },
            long: { text: '15文字超', class: 'badge-amber' },
            too_long: { text: '20文字超', class: 'badge-red' },
            inappropriate: { text: '不適切', class: 'badge-red' },
            empty: { text: 'なし', class: 'badge-blue' }
        };
        const badge = typeLabels[ex.type] || typeLabels.ok;
        return `<tr>
            <td><span class="badge badge-blue">${ex.grade}</span></td>
            <td class="kanji-cell">${ex.kanji}</td>
            <td>${ex.word}</td>
            <td>${ex.reading}</td>
            <td>${ex.len}</td>
            <td><span class="badge ${badge.class}">${badge.text}</span></td>
            <td class="audit-sentence">${ex.sentence}</td>
            <td><button class="btn btn-sm" onclick="editFromAudit(${ex.grade}, ${ex.kanjiIndex})">修正</button></td>
        </tr>`;
    }).join('');
}

async function runAudit() {
    try {
        if (selectedGrades.length === 0) {
            showToast('級を選択してください', 'error');
            return;
        }
        const gradeQuery = selectedGrades.join(',');
        const issues = await apiGet('/audit?grade=' + encodeURIComponent(gradeQuery));
        els.auditCount.textContent = `${issues.length} 件`;

        const gradeText = selectedGrades.length === allGrades.length ? '全級' : selectedGrades.map(g => g + '級').join(', ');
        els.pageTitle.textContent = `${gradeText}の監査結果`;

        if (issues.length === 0) {
            els.auditTable.innerHTML = `<tr><td colspan="7" class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                <div>問題は見つかりませんでした</div>
            </td></tr>`;
            return;
        }

        els.auditTable.innerHTML = issues.map(issue => {
            const typeLabel = issue.type === 'too_long' ? '20文字超' : (issue.type === 'inappropriate' ? '不適切' : '15文字超');
            const typeClass = issue.type === 'too_long' ? 'badge-red' : (issue.type === 'inappropriate' ? 'badge-red' : 'badge-amber');
            return `<tr>
                <td><span class="badge badge-blue">${issue.grade}</span></td>
                <td class="kanji-cell">${issue.kanji}</td>
                <td>${issue.word}</td>
                <td>${issue.len}</td>
                <td><span class="badge ${typeClass}">${typeLabel}</span></td>
                <td class="audit-sentence">${issue.sentence}</td>
                <td><button class="btn btn-sm" onclick="editFromAudit(${issue.grade}, ${issue.kanjiIndex})">修正</button></td>
            </tr>`;
        }).join('');
    } catch (e) {
        handleError('監査に失敗しました', e);
    }
}

init();
