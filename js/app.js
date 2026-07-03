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
export const APP_VERSION = '2.1.7';

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
        let navActiveId = 'nav-home';

        switch (route) {
            case 'home':
                targetViewId = 'view-home';
                navActiveId = 'nav-home';
                this.renderHomeScreen();
                break;

            case 'mode-select':
                targetViewId = 'view-mode-select';
                navActiveId = 'nav-home';
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
                navActiveId = 'nav-home';
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

        document.querySelector('.start-grade-btn').onclick = () => {
            this.currentGrade = 10;
            this.studyIndex = 0;
            storage.saveSetting('current_grade', this.currentGrade);
            window.location.hash = 'mode-select';
        };

        document.querySelectorAll('.download-grade-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const card = e.target.closest('.grade-card');
                const gradeVal = parseFloat(card.dataset.grade);

                btn.textContent = '取得中...';
                btn.disabled = true;

                try {
                    await dataManager.downloadGrade(gradeVal);

                    this.unlockedGrades.push(gradeVal);
                    storage.setJson('unlocked_grades', this.unlockedGrades);

                    this.renderHomeScreen();
                } catch (err) {
                    alert('データの取得に失敗しました。インターネット接続を確認して再度お試しください。');
                    btn.textContent = '開放する';
                    btn.disabled = false;
                }
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
            const isStudied = storage.isStudied(k.kanji);
            if (isStudied) {
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

                this.activeQuiz = new QuizSession(
                    this.currentGrade,
                    mode,
                    this.kanjiData,
                    this
                );

                if (mode === 'writing') {
                    window.location.hash = 'quiz-writing';
                } else {
                    window.location.hash = 'quiz-active';
                }
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
        if (!btn) return;
        const isStudied = storage.isStudied(kanji);
        if (isStudied) {
            btn.innerText = '覚えた ✓';
            btn.classList.remove('btn-success');
            btn.classList.add('btn-outline');
        } else {
            btn.innerText = '覚えた';
            btn.classList.remove('btn-outline');
            btn.classList.add('btn-success');
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

        this.unlockedGrades = this.getUnlockedGradesList();
        const gradeNewCounts = {
            10: '80', 9: '160', 8: '200', 7: '202',
            6: '193', 5: '191', 4: '313', 3: '284',
            2.5: '328', 2: '185', 1.5: '約864', 1: '約3,000'
        };
        const gradeLowerCounts = {
            10: '', 9: ' + 下位 80字', 8: ' + 下位 240字', 7: ' + 下位 440字',
            6: ' + 下位 642字', 5: ' + 下位 835字', 4: ' + 下位 1,026字', 3: ' + 下位 1,339字',
            2.5: ' + 下位 1,623字', 2: ' + 下位 1,951字', 1.5: ' + 下位 2,136字', 1: ' + 下位 約3,000字'
        };
        this.unlockedGrades.forEach(g => {
            const card = document.querySelector(`.grade-card[data-grade="${g}"]`);
            if (card && card.classList.contains('locked')) {
                card.classList.remove('locked');
                card.innerHTML = `
          <div class="grade-info">
            <h3>${gradeLabels[g] || g + '級'}</h3>
            <p class="grade-level">${gradeNames[g] || '小学校レベル'}</p>
            <p class="grade-char-count">配当漢字 ${gradeNewCounts[g] || '0'}字${gradeLowerCounts[g] || ''}</p>
          </div>
          <div class="grade-progress-container" id="progress-${g}">
            <div class="progress-bar">
              <div class="progress-fill" style="width: 0%"></div>
            </div>
            <span class="progress-text">学んだ漢字: 0/0 (0%)</span>
          </div>
          <button class="btn btn-primary start-grade-btn">始める</button>
        `;

                dataManager.getKanjiList(g).then(list => {
                    const prog = storage.getGradeProgress(list);
                    const block = document.getElementById(`progress-${g}`);
                    if (block) {
                        block.querySelector('.progress-fill').style.width = `${prog.percentage}%`;
                        block.querySelector('.progress-text').innerText = `学んだ漢字: ${prog.studied}/${prog.total} (${prog.percentage}%)`;
                    }
                });

                card.querySelector('.start-grade-btn').onclick = async () => {
                    this.currentGrade = g;
                    this.studyIndex = 0;
                    storage.saveSetting('current_grade', g);
                    this.kanjiData = await dataManager.getKanjiList(g);
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
