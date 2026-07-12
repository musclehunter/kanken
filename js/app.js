/**
 * js/app.js
 * 
 * Main SPA Router and Views Controller. Handles initialization,
 * navigation events, card pagination, settings bindings, and
 * KanjiVG structural rendering.
 */

import { storage } from './storage.js';
import { dataManager } from './data-manager.js';
import { QuizSession } from './quiz.js';
import { HandwritingCanvas } from './canvas.js';

// Application version (bump on each release)
export const APP_VERSION = '2.1.12';

class VIEWS_ROUTER {
    constructor() {
        this.currentGrade = parseInt(storage.getSetting('current_grade', '10'), 10);
        this.kanjiData = []; // Current active kanji list
        this.studyIndex = 0; // Current card in flashcard study mode
        this.studyOrder = 'default'; // Current study order mode
        this.activeQuiz = null; // Active QuizSession instance
        this.studyCanvas = null; // Practice canvas for study mode
        this.unlockedGrades = this.getUnlockedGradesList();

        this.init();
    }

    // --- INITIALIZATION ---
    async init() {
        this.setupViewRouting();
        this.setupUIHandlers();

        // Force SW update check
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg) reg.update();
            });
        }

        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            let versionText = `v${APP_VERSION}`;
            try {
                const manifest = await fetch('./manifest.json').then(r => r.json());
                if (manifest.version && manifest.version !== APP_VERSION) {
                    versionText += ` (manifest: v${manifest.version})`;
                }
            } catch (e) { /* ignore */ }
            versionEl.innerText = versionText;
        }

        const engineText = await graderEngineStatus();
        document.getElementById('current-recognition-engine-status').innerText = engineText;

        this.kanjiData = await dataManager.getKanjiList(this.currentGrade);
        if (this.kanjiData.length === 0) {
            await dataManager.downloadGrade(this.currentGrade);
            this.kanjiData = await dataManager.getKanjiList(this.currentGrade);
        }

        this.handleRoute(window.location.hash);
    }

    getUnlockedGradesList() {
        let unlocked = storage.getJson('unlocked_grades');
        if (!unlocked) {
            unlocked = [10]; // 10級 is open by default
            storage.setJson('unlocked_grades', unlocked);
        }
        return unlocked;
    }

    setupViewRouting() {
        window.addEventListener('hashchange', () => this.handleRoute(window.location.hash));

        // Initial load tracking
        if (!window.location.hash) {
            window.location.hash = '#home';
        }
    }

    handleRoute(hash) {
        const route = hash.replace('#', '') || 'home';
        console.log(`Navigating to route: ${route}`);

        // Hide all views, deactivate nav items
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

        // Target view detection
        let targetViewId = 'view-home';
        let navActiveId = null;

        switch (route) {
            case 'home':
                targetViewId = 'view-home';
                navActiveId = null;
                this.renderHomeScreen();
                break;

            case 'mode-select':
                targetViewId = 'view-mode-select';
                navActiveId = null;
                this.renderModeSelectScreen();
                break;

            case 'study-order':
                targetViewId = 'view-study-order';
                navActiveId = 'nav-study';
                this.renderStudyOrderScreen();
                break;

            case 'study':
                targetViewId = 'view-study';
                navActiveId = 'nav-study';
                this.renderStudyScreen();
                break;

            case 'kanji-list':
                targetViewId = 'view-kanji-list';
                navActiveId = 'nav-kanji-list';
                this.renderKanjiListScreen();
                break;

            case 'quiz-select':
                targetViewId = 'view-quiz-select';
                navActiveId = 'nav-quiz';
                this.renderQuizSelectScreen();
                break;

            case 'quiz-active':
                targetViewId = 'view-quiz-active';
                navActiveId = 'nav-quiz';
                if (!this.activeQuiz) window.location.hash = 'quiz-select';
                break;

            case 'quiz-writing':
                targetViewId = 'view-quiz-writing';
                navActiveId = 'nav-quiz';
                if (!this.activeQuiz) window.location.hash = 'quiz-select';
                break;

            case 'results':
                targetViewId = 'view-results';
                navActiveId = 'nav-quiz';
                break;

            case 'settings':
                targetViewId = 'view-settings';
                navActiveId = 'nav-settings';
                this.renderSettingsScreen();
                break;

            default:
                targetViewId = 'view-home';
                navActiveId = null;
        }

        // Render target view
        const viewContainer = document.getElementById(targetViewId);
        if (viewContainer) {
            viewContainer.classList.add('active');
        }

        const activeNav = document.getElementById(navActiveId);
        if (activeNav) {
            activeNav.classList.add('active');
        }

        // Update breadcrumb
        this.updateBreadcrumb(route);

        // Update header grade label
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };
        const headerGradeLabel = document.getElementById('header-grade-label');
        if (headerGradeLabel) {
            headerGradeLabel.innerText = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;
        }

        // Scroll window back to top on transitions
        document.getElementById('main-content').scrollTop = 0;
    }

    updateBreadcrumb(route) {
        const breadcrumb = document.getElementById('breadcrumb');
        const breadcrumbText = document.getElementById('breadcrumb-text');
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };
        const gradeLabel = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;

        const crumbs = {
            'home': null,
            'mode-select': `${gradeLabel}`,            'study-order': `${gradeLabel} › 学習 › 順序選択`,
            'study': `${gradeLabel} › 学習`,
            'quiz-select': `${gradeLabel} › テスト`,
            'quiz-active': `${gradeLabel} › テスト › 進行中`,
            'quiz-writing': `${gradeLabel} › テスト › 書き取り`,
            'results': `${gradeLabel} › テスト › 結果`,
            'settings': '設定'
        };

        const text = crumbs[route];
        if (text) {
            breadcrumbText.innerText = text;
            breadcrumb.style.display = 'block';
        } else {
            breadcrumb.style.display = 'none';
        }
    }

    // --- UI BINDINGS ---
    setupUIHandlers() {
        document.getElementById('btn-settings').onclick = () => {
            window.location.hash = 'settings';
        };

        document.querySelectorAll('.btn-back').forEach(btn => {
            btn.onclick = () => {
                window.history.back();
            };
        });

        document.querySelectorAll('.start-grade-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const card = e.target.closest('.grade-card');
                const gradeVal = parseFloat(card.dataset.grade);
                btn.textContent = '読み込み中...';
                btn.disabled = true;
                this.currentGrade = gradeVal;
                this.studyIndex = 0;
                storage.saveSetting('current_grade', gradeVal);
                this.kanjiData = await dataManager.getKanjiList(gradeVal);
                if (this.kanjiData.length === 0) {
                    try {
                        await dataManager.downloadGrade(gradeVal);
                        this.kanjiData = await dataManager.getKanjiList(gradeVal);
                    } catch (err) {
                        alert('データの取得に失敗しました。インターネット接続を確認して再度お試しください。');
                        btn.textContent = '始める';
                        btn.disabled = false;
                        return;
                    }
                }
                window.location.hash = 'mode-select';
            };
        });

        document.querySelectorAll('.start-mode-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const mode = e.target.closest('.mode-card').dataset.mode;
                this.kanjiData = await dataManager.getKanjiList(this.currentGrade);
                if (mode === 'study') {
                    this.studyIndex = 0;
                    window.location.hash = 'study-order';
                } else if (mode === 'test') {
                    window.location.hash = 'quiz-select';
                } else if (mode === 'kanji-list') {
                    window.location.hash = 'kanji-list';
                }
            };
        });

        // Study order selection
        document.querySelectorAll('.order-card').forEach(btn => {
            btn.onclick = async () => {
                this.studyOrder = btn.dataset.order;
                this.kanjiData = await dataManager.getKanjiList(this.currentGrade);
                this.kanjiData = this.applyStudyOrder(this.kanjiData);
                this.studyIndex = 0;
                window.location.hash = 'study';
            };
        });

        document.getElementById('btn-study-prev').onclick = () => this.navigateStudyCard(-1);
        document.getElementById('btn-study-next').onclick = () => this.navigateStudyCard(1);

        document.getElementById('btn-study-mark').onclick = () => {
            const k = this.kanjiData[this.studyIndex];
            if (!k) return;
            if (storage.isStudied(k.kanji)) {
                storage.unmarkStudied(k.kanji);
            } else {
                storage.markStudied(k.kanji);
            }
            this.updateMarkButton(k.kanji);
        };

        document.getElementById('btn-study-test').onclick = () => {
            const currentKanjiItem = this.kanjiData[this.studyIndex];
            this.activeQuiz = new QuizSession(this.currentGrade, 'writing', [currentKanjiItem], this);
            this.activeQuiz.questions = [currentKanjiItem];
            window.location.hash = 'quiz-writing';
        };

        document.getElementById('btn-study-canvas-clear').onclick = () => {
            if (this.studyCanvas) this.studyCanvas.clear();
        };

        document.querySelectorAll('.mode-card .start-quiz-btn').forEach(btn => {
            btn.onclick = (e) => {
                const mode = e.target.closest('.mode-card').dataset.mode;
                this.showQuizConfigPanel(mode);
            };
        });

        // Quiz config panel handlers
        const configPanel = document.getElementById('quiz-config-panel');
        const configClose = document.getElementById('quiz-config-close');
        const configStart = document.getElementById('quiz-config-start');

        if (configClose) {
            configClose.onclick = () => {
                configPanel.style.display = 'none';
            };
        }

        if (configStart) {
            configStart.onclick = () => {
                const mode = configPanel.dataset.mode;
                const count = parseInt(configPanel.dataset.selectedCount || '20', 10);
                const method = configPanel.dataset.selectedMethod || 'random';
                const timeAttack = configPanel.dataset.ta === 'on';
                const timeLimit = parseInt(configPanel.dataset.taTime || '15', 10);

                const config = { count, method, timeAttack, timeLimit };
                storage.saveQuizConfig(this.currentGrade, mode, config);

                this.activeQuiz = new QuizSession(
                    this.currentGrade,
                    mode,
                    this.kanjiData,
                    this,
                    config
                );

                configPanel.style.display = 'none';

                if (mode === 'writing') {
                    window.location.hash = 'quiz-writing';
                } else {
                    window.location.hash = 'quiz-active';
                }
            };
        }

        // Config option button handlers (count)
        document.querySelectorAll('#quiz-config-count .config-option-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#quiz-config-count .config-option-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                configPanel.dataset.selectedCount = btn.dataset.count;
            };
        });

        // Config option button handlers (method)
        document.querySelectorAll('#quiz-config-method .config-option-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#quiz-config-method .config-option-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                configPanel.dataset.selectedMethod = btn.dataset.method;

                // Show sequential progress info
                const seqInfo = document.getElementById('quiz-config-sequential-info');
                const seqPos = document.getElementById('quiz-config-seq-pos');
                if (btn.dataset.method === 'sequential') {
                    const pos = storage.getSequentialPosition(this.currentGrade, configPanel.dataset.mode);
                    seqPos.innerText = `進捗: ${pos} / ${this.kanjiData.length}`;
                    seqInfo.style.display = 'block';
                } else {
                    seqInfo.style.display = 'none';
                }
            };
        });

        // Time attack toggle handlers
        document.querySelectorAll('.quiz-config-section .config-option-btn[data-ta]').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.quiz-config-section .config-option-btn[data-ta]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                configPanel.dataset.ta = btn.dataset.ta;

                const taTimeSection = document.getElementById('quiz-config-ta-time');
                taTimeSection.style.display = btn.dataset.ta === 'on' ? 'flex' : 'none';
            };
        });

        // Time limit selection handlers
        document.querySelectorAll('#quiz-config-ta-options .config-option-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#quiz-config-ta-options .config-option-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                configPanel.dataset.taTime = btn.dataset.time;
            };
        });
    }

    // Helper trigger to redirect straight to single study from review badges
    showStudyForKanji(kanjiChar) {
        const idx = this.kanjiData.findIndex(k => k.kanji === kanjiChar);
        if (idx !== -1) {
            this.studyIndex = idx;
            window.location.hash = 'study';
        }
    }

    showQuizConfigPanel(mode) {
        const panel = document.getElementById('quiz-config-panel');
        const titleEl = document.getElementById('quiz-config-title');
        const statsEl = document.getElementById('quiz-config-stats');

        // Insert panel right after the clicked mode card
        const clickedCard = document.querySelector(`.mode-card[data-mode="${mode}"]`);
        if (clickedCard && clickedCard.nextElementSibling !== panel) {
            clickedCard.insertAdjacentElement('afterend', panel);
        }

        const modeTitles = {
            reading: '読み', writing: '書き取り', radical: '部首',
            antonym: '対義語', homophone: '同音異字', same_kun: '同訓異字'
        };
        titleEl.innerText = `${modeTitles[mode] || mode} - 出題設定`;
        panel.dataset.mode = mode;

        // Load saved config
        const savedConfig = storage.getQuizConfig(this.currentGrade, mode);
        panel.dataset.selectedCount = String(savedConfig.count);
        panel.dataset.selectedMethod = savedConfig.method;
        panel.dataset.ta = savedConfig.timeAttack ? 'on' : 'off';
        panel.dataset.taTime = String(savedConfig.timeLimit || 15);

        // Highlight saved selections
        document.querySelectorAll('#quiz-config-count .config-option-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.count, 10) === savedConfig.count);
        });
        document.querySelectorAll('#quiz-config-method .config-option-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.method === savedConfig.method);
        });

        // Time attack toggle state
        document.querySelectorAll('.quiz-config-section .config-option-btn[data-ta]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.ta === (savedConfig.timeAttack ? 'on' : 'off'));
        });
        const taTimeSection = document.getElementById('quiz-config-ta-time');
        taTimeSection.style.display = savedConfig.timeAttack ? 'flex' : 'none';
        document.querySelectorAll('#quiz-config-ta-options .config-option-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.time, 10) === (savedConfig.timeLimit || 15));
        });

        // Show sequential progress if applicable
        const seqInfo = document.getElementById('quiz-config-sequential-info');
        const seqPos = document.getElementById('quiz-config-seq-pos');
        if (savedConfig.method === 'sequential') {
            const pos = storage.getSequentialPosition(this.currentGrade, mode);
            seqPos.innerText = `進捗: ${pos} / ${this.kanjiData.length}`;
            seqInfo.style.display = 'block';
        } else {
            seqInfo.style.display = 'none';
        }

        // Show stats
        const stats = storage.getTypeStats(this.currentGrade, mode, this.kanjiData);
        const unasked = storage.getUnaskedKanji(mode, this.kanjiData).length;
        const studied = storage.getStudiedKanji(this.kanjiData).length;
        const wrong = storage.getWrongKanjiForMode(mode, this.kanjiData).length;

        statsEl.innerHTML = `
            <div class="quiz-config-stat-item">
                <span class="stat-label">正答率</span>
                <span class="stat-value">${stats.accuracy}%</span>
            </div>
            <div class="quiz-config-stat-item">
                <span class="stat-label">出題済</span>
                <span class="stat-value">${stats.uniqueKanji}/${stats.totalKanji}</span>
            </div>
            <div class="quiz-config-stat-item">
                <span class="stat-label">未出題</span>
                <span class="stat-value">${unasked}</span>
            </div>
            <div class="quiz-config-stat-item">
                <span class="stat-label">学習済</span>
                <span class="stat-value">${studied}</span>
            </div>
            <div class="quiz-config-stat-item">
                <span class="stat-label">要復習</span>
                <span class="stat-value">${wrong}</span>
            </div>
        `;

        panel.style.display = 'block';
    }

    renderModeSelectScreen() {
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };
        const label = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;
        document.getElementById('mode-select-title').innerText = `${label} - モード選択`;
    }

    renderStudyOrderScreen() {
        // Nothing dynamic needed, cards are static in HTML
    }

    renderQuizSelectScreen() {
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };
        const label = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;
        const titleEl = document.querySelector('#view-quiz-select .view-title');
        if (titleEl) titleEl.innerText = `${label} - テスト選択`;
    }

    applyStudyOrder(list) {
        const sorted = [...list];
        switch (this.studyOrder) {
            case 'random':
                return sorted.sort(() => 0.5 - Math.random());
            case 'strokes':
                return sorted.sort((a, b) => (a.stroke_count || 0) - (b.stroke_count || 0));
            case 'radical':
                return sorted.sort((a, b) => {
                    const ra = (a.radical || '') + (a.radical_name || '');
                    const rb = (b.radical || '') + (b.radical_name || '');
                    return ra.localeCompare(rb, 'ja');
                });
            case 'onyomi':
                return sorted.sort((a, b) => {
                    const oa = (a.on_readings[0] || '');
                    const ob = (b.on_readings[0] || '');
                    return oa.localeCompare(ob, 'ja');
                });
            case 'kunyomi':
                return sorted.sort((a, b) => {
                    const ka = (a.kun_readings[0] || '').replace(/[.\-]/g, '');
                    const kb = (b.kun_readings[0] || '').replace(/[.\-]/g, '');
                    return ka.localeCompare(kb, 'ja');
                });
            case 'unstudied':
                return sorted.filter(k => !storage.isStudied(k.kanji));
            case 'weak':
                return storage.getWeightedKanjiOrder(sorted);
            default:
                return sorted;
        }
    }

    updateMarkButton(kanji) {
        const btn = document.getElementById('btn-study-mark');
        const badge = document.getElementById('study-status-badge');
        if (!btn) return;
        const isStudied = storage.isStudied(kanji);
        if (isStudied) {
            btn.innerText = '覚え直す';
            btn.classList.remove('btn-success');
            btn.classList.add('btn-outline');
            if (badge) {
                badge.innerText = '学習済み';
                badge.className = 'study-status-badge studied';
            }
        } else {
            btn.innerText = '覚えた';
            btn.classList.remove('btn-outline');
            btn.classList.add('btn-success');
            if (badge) {
                badge.innerText = '未学習';
                badge.className = 'study-status-badge unstudied';
            }
        }
    }

    renderHomeScreen() {
        const gradeNames = {
            10: '小学1年生レベル',
            9: '小学2年生レベル',
            8: '小学3年生レベル',
            7: '小学4年生レベル',
            6: '小学5年生レベル',
            5: '小学6年生レベル',
            4: '常用漢字レベル',
            3: '常用漢字レベル',
            2.5: '常用漢字レベル',
            2: '常用漢字+人名用漢字レベル',
            1.5: '常用+人名用+JIS水準レベル',
            1: '常用+人名用+JIS水準レベル'
        };
        const gradeCounts = {
            10: '80', 9: '240', 8: '440', 7: '642',
            6: '835', 5: '1,026', 4: '1,339', 3: '1,623',
            2.5: '1,951', 2: '2,136', 1.5: '約3,000', 1: '約6,000'
        };
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };

        const progress = storage.getGradeProgress(this.kanjiData);

        // Show "continue" section for the currently selected grade
        const continueSection = document.getElementById('continue-section');
        const continueLabel = document.getElementById('continue-grade-label');
        const continueProgress = document.getElementById('continue-progress-text');
        const continueBtn = document.getElementById('btn-continue-grade');
        if (continueSection && continueLabel && continueBtn) {
            continueLabel.innerText = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;
            continueProgress.innerText = `学んだ漢字: ${progress.studied}/${progress.total} (${progress.percentage}%)`;
            continueSection.style.display = 'flex';
            continueBtn.onclick = () => {
                window.location.hash = 'mode-select';
            };
        }

        // Highlight the currently selected grade card
        document.querySelectorAll('.grade-card').forEach(c => c.classList.remove('selected'));
        const currentCard = document.querySelector(`.grade-card[data-grade="${this.currentGrade}"]`);
        if (currentCard) {
            currentCard.classList.add('selected');
            const progFill = currentCard.querySelector('.progress-fill');
            const progText = currentCard.querySelector('.progress-text');
            if (progFill) progFill.style.width = `${progress.percentage}%`;
            if (progText) progText.innerText = `学んだ漢字: ${progress.studied}/${progress.total} (${progress.percentage}%)`;
        }

        const allGrades = [10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2, 1.5, 1];
        allGrades.forEach(g => {
            const card = document.querySelector(`.grade-card[data-grade="${g}"]`);
            if (card) {
                dataManager.getKanjiList(g).then(list => {
                    const prog = storage.getGradeProgress(list);
                    const progFill = card.querySelector('.progress-fill');
                    const progText = card.querySelector('.progress-text');
                    if (progFill) progFill.style.width = `${prog.percentage}%`;
                    if (progText) progText.innerText = `学んだ漢字: ${prog.studied}/${prog.total} (${prog.percentage}%)`;
                }).catch(() => {});

                card.querySelector('.start-grade-btn').onclick = async () => {
                    this.currentGrade = g;
                    this.studyIndex = 0;
                    storage.saveSetting('current_grade', g);
                    this.kanjiData = await dataManager.getKanjiList(g);
                    if (this.kanjiData.length === 0) {
                        try {
                            await dataManager.downloadGrade(g);
                            this.kanjiData = await dataManager.getKanjiList(g);
                        } catch (err) {
                            alert('データの取得に失敗しました。インターネット接続を確認して再度お試しください。');
                            return;
                        }
                    }
                    window.location.hash = 'mode-select';
                };
            }
        });
    }

    async renderStudyScreen() {
        if (this.kanjiData.length === 0) return;

        if (this.studyIndex < 0) this.studyIndex = 0;
        if (this.studyIndex >= this.kanjiData.length) this.studyIndex = this.kanjiData.length - 1;

        const k = this.kanjiData[this.studyIndex];
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };
        const label = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;

        document.getElementById('study-title').innerText = `漢字学習 (${label})`;
        document.getElementById('study-progress').innerText = `${this.studyIndex + 1} / ${this.kanjiData.length}`;
        document.getElementById('study-kanji').innerText = k.kanji;
        document.getElementById('study-strokes').innerText = `${k.stroke_count}画`;
        document.getElementById('study-radical').innerText = k.radical_name ? `${k.radical}（${k.radical_name}）` : 'なし';
        document.getElementById('study-onyomi').innerText = k.on_readings.join('、') || 'なし';
        document.getElementById('study-kunyomi').innerText = k.kun_readings.join('、') || 'なし';

        // Update mark button state
        this.updateMarkButton(k.kanji);

        // Init practice canvas
        if (!this.studyCanvas) {
            this.studyCanvas = new HandwritingCanvas('study-practice-canvas');
        } else {
            this.studyCanvas.clear();
        }

        const exContainer = document.getElementById('study-examples-container');
        const exList = document.getElementById('study-examples');
        if (k.examples && k.examples.length > 0) {
            const seen = new Set();
            const unique = k.examples.filter(ex => {
                const normalized = ex.reading.replace(/[ァ-ン]/g, c => 
                    String.fromCharCode(c.charCodeAt(0) - 0x60)
                );
                if (seen.has(normalized)) return false;
                seen.add(normalized);
                return true;
            });
            exContainer.style.display = '';
            exList.innerHTML = unique.map(ex =>
                `<span class="example-item font-japanese">${ex.word}（${ex.reading}）</span>`
            ).join('');
        } else {
            exContainer.style.display = 'none';
        }

        const homoContainer = document.getElementById('study-homophones-container');
        const homoList = document.getElementById('study-homophones');
        if (k.homophones && k.homophones.length > 0) {
            homoContainer.style.display = '';
            homoList.innerHTML = k.homophones.map(h =>
                `<span class="homophone-item font-serif">${h}</span>`
            ).join('');
        } else {
            homoContainer.style.display = 'none';
        }

        const svgContainer = document.getElementById('stroke-svg-container');
        svgContainer.innerHTML = '<span class="placeholder-text">書き順読み込み中...</span>';

        const svgText = await dataManager.getKanjiSVG(k.kanji);
        if (svgText) {
            svgContainer.innerHTML = svgText;
            const svgElement = svgContainer.querySelector('svg');
            if (svgElement) {
                svgElement.setAttribute('width', '100%');
                svgElement.setAttribute('height', '100%');
                this.playStrokeAnimation(svgElement);
                svgContainer.style.cursor = 'pointer';
                svgContainer.onclick = () => this.playStrokeAnimation(svgElement);
            }
        } else {
            svgContainer.innerHTML = '<span class="placeholder-text">書き順データなし</span>';
        }
    }

    navigateStudyCard(direction) {
        this.studyIndex += direction;
        this.renderStudyScreen();
    }

    playStrokeAnimation(svgElement) {
        const paths = svgElement.querySelectorAll('path');
        paths.forEach((path) => {
            path.setAttribute('class', 'stroke-anim');
            path.style.animation = 'none';
            path.style.strokeDasharray = 'none';
            void path.offsetWidth;
            const length = path.getTotalLength();
            path.style.strokeDasharray = length;
            path.style.strokeDashoffset = length;
            void path.offsetWidth;
            path.style.animation = `drawStroke 1s cubic-bezier(0.4, 0, 0.2, 1) forwards`;
        });
        paths.forEach((path, index) => {
            path.style.animationDelay = `${index * 0.9}s`;
        });
    }

    // --- RENDER DOM: SETTINGS ---
    renderSettingsScreen() {
        // Current grader select setting reflect
        const select = document.getElementById('setting-grader-mode');
        select.value = storage.getSetting('grader-mode', 'auto');

        select.onchange = (e) => {
            storage.saveSetting('grader-mode', e.target.value);
        };

        document.getElementById('btn-sync-data').onclick = async (e) => {
            const btn = e.target;
            btn.innerText = '同期中...';
            btn.disabled = true;

            let success = await dataManager.syncGrade(this.currentGrade);

            if (success) {
                alert('同期に成功しました！最新のデータを読み込みました。');
            } else {
                alert('同期に失敗しました。オフラインになっている可能性があります。');
            }

            btn.innerText = '同期する';
            btn.disabled = false;
        };

        // Full reset handler
        document.getElementById('btn-reset-data').onclick = () => {
            if (confirm('本当にすべての学習データと進捗状況を消去しますか？')) {
                storage.clearAll();
                alert('データをリセットしました。アプリを再読込します。');
                window.location.hash = 'home';
                window.location.reload();
            }
        };

        // Cache clear handler
        document.getElementById('btn-clear-cache').onclick = async (e) => {
            const btn = e.target;
            btn.innerText = 'クリア中...';
            btn.disabled = true;
            try {
                // Unregister all service workers
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const reg of regs) await reg.unregister();
                }
                // Clear all caches
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (const key of keys) await caches.delete(key);
                }
                // Clear IndexedDB
                indexedDB.deleteDatabase('KanjiMasterDB');
                alert('キャッシュをクリアしました。再読み込みします。');
                window.location.hash = 'home';
                window.location.reload();
            } catch (err) {
                alert('キャッシュクリアに失敗しました: ' + err.message);
                btn.innerText = 'キャッシュクリア';
                btn.disabled = false;
            }
        };
    }

    // --- KANJI LIST SCREEN ---
    renderKanjiListScreen() {
        const gradeLabels = { 2.5: '準2級', 1.5: '準1級' };
        const label = gradeLabels[this.currentGrade] || `${this.currentGrade}級`;
        document.getElementById('kanji-list-title').innerText = `${label} - 漢字リスト`;

        this.kanjiListSelected = new Set();

        // Populate radical filter
        const radicalSelect = document.getElementById('filter-radical');
        const radicals = [...new Set(this.kanjiData.map(k => k.radical_name).filter(Boolean))].sort();
        radicalSelect.innerHTML = '<option value="all">部首: すべて</option>' +
            radicals.map(r => `<option value="${r}">${r}</option>`).join('');

        // Populate stroke count filters
        const strokesMin = document.getElementById('filter-strokes-min');
        const strokesMax = document.getElementById('filter-strokes-max');
        const strokeCounts = [...new Set(this.kanjiData.map(k => k.stroke_count))].sort((a, b) => a - b);
        strokesMin.innerHTML = '<option value="0">画数: 下限なし</option>' +
            strokeCounts.map(s => `<option value="${s}">${s}画以上</option>`).join('');
        strokesMax.innerHTML = '<option value="99">画数: 上限なし</option>' +
            strokeCounts.map(s => `<option value="${s}">${s}画以下</option>`).join('');

        this.updateKanjiGrid();

        // Filter event listeners
        ['filter-status', 'filter-radical', 'filter-strokes-min', 'filter-strokes-max', 'filter-reading'].forEach(id => {
            const el = document.getElementById(id);
            el.oninput = () => this.updateKanjiGrid();
            el.onchange = () => this.updateKanjiGrid();
        });

        // Select all
        document.getElementById('select-all').onchange = (e) => {
            if (e.target.checked) {
                this.getFilteredKanji().forEach(k => this.kanjiListSelected.add(k.kanji));
            } else {
                this.kanjiListSelected.clear();
            }
            this.updateKanjiGridSelection();
        };

        // Batch test
        document.getElementById('btn-batch-test').onclick = () => {
            if (this.kanjiListSelected.size === 0) return;
            const batchMode = document.getElementById('batch-test-mode').value;
            const selectedItems = this.kanjiData.filter(k => this.kanjiListSelected.has(k.kanji));
            const config = { count: 0, method: 'custom', selectedKanji: [...this.kanjiListSelected] };
            this.activeQuiz = new QuizSession(this.currentGrade, batchMode, selectedItems, this, config);
            if (batchMode === 'writing') {
                window.location.hash = 'quiz-writing';
            } else {
                window.location.hash = 'quiz-active';
            }
        };
    }

    getFilteredKanji() {
        const status = document.getElementById('filter-status').value;
        const radical = document.getElementById('filter-radical').value;
        const strokesMin = parseInt(document.getElementById('filter-strokes-min').value);
        const strokesMax = parseInt(document.getElementById('filter-strokes-max').value);
        const readingQuery = document.getElementById('filter-reading').value.trim().toLowerCase();

        return this.kanjiData.filter(k => {
            if (status === 'studied' && !storage.isStudied(k.kanji)) return false;
            if (status === 'unstudied' && storage.isStudied(k.kanji)) return false;
            if (radical !== 'all' && k.radical_name !== radical) return false;
            if (k.stroke_count < strokesMin || k.stroke_count > strokesMax) return false;
            if (readingQuery) {
                const allReadings = [...k.on_readings, ...k.kun_readings].join(' ').toLowerCase();
                if (!allReadings.includes(readingQuery)) return false;
            }
            return true;
        });
    }

    updateKanjiGrid() {
        const filtered = this.getFilteredKanji();
        const grid = document.getElementById('kanji-grid');
        const studiedCount = filtered.filter(k => storage.isStudied(k.kanji)).length;
        document.getElementById('kanji-list-count').innerText = `${studiedCount} / ${filtered.length}`;

        grid.innerHTML = filtered.map(k => {
            const isStudied = storage.isStudied(k.kanji);
            const isSelected = this.kanjiListSelected.has(k.kanji);
            return `<div class="kanji-grid-item ${isStudied ? 'studied' : 'unstudied'} ${isSelected ? 'selected' : ''}" data-kanji="${k.kanji}">
                <input type="checkbox" class="kanji-checkbox" ${isSelected ? 'checked' : ''} />
                <button class="kanji-toggle-btn" data-kanji="${k.kanji}">${isStudied ? '✓' : '○'}</button>
                <span class="kanji-char font-serif">${k.kanji}</span>
            </div>`;
        }).join('');

        // Bind events
        grid.querySelectorAll('.kanji-grid-item').forEach(item => {
            // Checkbox click = toggle selection
            const cb = item.querySelector('.kanji-checkbox');
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleKanjiSelection(item.dataset.kanji);
            });

            // Toggle button = toggle studied/unstudied
            const toggleBtn = item.querySelector('.kanji-toggle-btn');
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleKanjiStudied(item.dataset.kanji);
            });

            // Tap on item (not checkbox or toggle) = go to study
            item.addEventListener('click', () => {
                const kanji = item.dataset.kanji;
                const idx = this.kanjiData.findIndex(k => k.kanji === kanji);
                if (idx !== -1) {
                    this.studyIndex = idx;
                    window.location.hash = 'study';
                }
            });
        });

        this.updateSelectedCount();
    }

    toggleKanjiStudied(kanji) {
        if (storage.isStudied(kanji)) {
            storage.unmarkStudied(kanji);
        } else {
            storage.markStudied(kanji);
        }
        this.updateKanjiGrid();
    }

    toggleKanjiSelection(kanji) {
        if (this.kanjiListSelected.has(kanji)) {
            this.kanjiListSelected.delete(kanji);
        } else {
            this.kanjiListSelected.add(kanji);
        }
        this.updateKanjiGridSelection();
    }

    updateKanjiGridSelection() {
        document.querySelectorAll('.kanji-grid-item').forEach(item => {
            const isSelected = this.kanjiListSelected.has(item.dataset.kanji);
            item.classList.toggle('selected', isSelected);
            const cb = item.querySelector('.kanji-checkbox');
            if (cb) cb.checked = isSelected;
        });
        this.updateSelectedCount();
    }

    updateSelectedCount() {
        const count = this.kanjiListSelected.size;
        document.getElementById('selected-count').innerText = `${count}個選択中`;
        document.getElementById('btn-batch-test').disabled = count === 0;
    }
}

// Helper detection status
async function graderEngineStatus() {
    const { grader } = await import('./grader.js');
    return await grader.detectEngine();
}

// Keep the app height in sync with the actual visible viewport so the bottom
// navigation is never hidden behind the mobile browser UI / system nav bar.
function setAppHeight() {
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppHeight);
}

// --- BOOT AND SERVICE WORKER REGISTRATION ---
window.addEventListener('DOMContentLoaded', () => {
    setAppHeight();

    // Start Routing
    window.appRouter = new VIEWS_ROUTER();

    // Register service worker if available in navigator and running on HTTPS or localhost
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered successfully:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        });
    }
});
