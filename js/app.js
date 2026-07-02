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

// Application version (bump on each release)
export const APP_VERSION = '1.0.0';

class VIEWS_ROUTER {
    constructor() {
        this.currentGrade = 10; // Default is 10級 (Grade 1)
        this.kanjiData = []; // Current active kanji list
        this.studyIndex = 0; // Current card in flashcard study mode
        this.activeQuiz = null; // Active QuizSession instance
        this.unlockedGrades = this.getUnlockedGradesList();

        this.init();
    }

    // --- INITIALIZATION ---
    async init() {
        this.setupViewRouting();
        this.setupUIHandlers();

        // Display app version
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.innerText = `v${APP_VERSION}`;

        // Check recognition engine availability
        const engineText = await graderEngineStatus();
        document.getElementById('current-recognition-engine-status').innerText = engineText;

        // Load initial grade data (10級)
        this.kanjiData = await dataManager.getKanjiList(1);

        // Load default view based on hash or default to home
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

            case 'study':
                targetViewId = 'view-study';
                navActiveId = 'nav-home';
                this.renderStudyScreen();
                break;

            case 'quiz-select':
                targetViewId = 'view-quiz-select';
                navActiveId = 'nav-quiz';
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

        // Scroll window back to top on transitions
        document.getElementById('main-content').scrollTop = 0;
    }

    // --- UI BINDINGS ---
    setupUIHandlers() {
        // Header settings button click
        document.getElementById('btn-settings').onclick = () => {
            window.location.hash = 'settings';
        };

        // Generic Back buttons click triggers browser history back
        document.querySelectorAll('.btn-back').forEach(btn => {
            btn.onclick = () => {
                window.history.back();
            };
        });

        // --- HOME SCREEN CLICK HANDLERS ---
        // Start 10級 button
        document.querySelector('.start-grade-btn').onclick = () => {
            this.currentGrade = 10;
            this.studyIndex = 0;
            window.location.hash = 'study';
        };

        // Locked grade download trigger simulation
        document.querySelectorAll('.download-grade-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const card = e.target.closest('.grade-card');
                const gradeVal = parseFloat(card.dataset.grade);

                btn.textContent = '取得中...';
                btn.disabled = true;

                try {
                    // Map kentei grade to API/data grade
                    const gradeToAPI = {
                        10: 1, 9: 2, 8: 3, 7: 4, 6: 5, 5: 6,
                        4: 4, 3: 3, 2.5: 2.5, 2: 2,
                        1.5: 1.5, 1: 1
                    };
                    const targetAPIGrade = gradeToAPI[gradeVal];
                    await dataManager.downloadGrade(targetAPIGrade);

                    // Mark as unlocked
                    this.unlockedGrades.push(gradeVal);
                    storage.setJson('unlocked_grades', this.unlockedGrades);

                    // Force layout refresh
                    this.renderHomeScreen();
                } catch (err) {
                    alert('データの取得に失敗しました。インターネット接続を確認して再度お試しください。');
                    btn.textContent = '開放する';
                    btn.disabled = false;
                }
            };
        });

        // --- FLASHCARD NAVIGATION CLICK HANDLERS ---
        document.getElementById('btn-study-prev').onclick = () => this.navigateStudyCard(-1);
        document.getElementById('btn-study-next').onclick = () => this.navigateStudyCard(1);

        // Test this specific character click inside Card study view
        document.getElementById('btn-study-test').onclick = () => {
            const currentKanjiItem = this.kanjiData[this.studyIndex];
            // Create single question session targeting this character
            this.activeQuiz = new QuizSession(this.currentGrade, 'writing', [currentKanjiItem], this);
            this.activeQuiz.questions = [currentKanjiItem]; // Ensure it is exactly this one
            window.location.hash = 'quiz-writing';
        };

        // --- QUIZ SELECTION MODE CLICK HANDLERS ---
        document.querySelectorAll('.mode-card .start-quiz-btn').forEach(btn => {
            btn.onclick = (e) => {
                const mode = e.target.closest('.mode-card').dataset.mode;

                // Start quiz orchestration
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

        // Exit quiz buttons
        const exitQuiz = () => {
            if (confirm('テストを途中で終了しますか？これまでの回答は保存されません。')) {
                this.activeQuiz = null;
                window.location.hash = 'quiz-select';
            }
        };
        document.getElementById('btn-exit-quiz').onclick = exitQuiz;
        document.getElementById('btn-exit-writing-quiz').onclick = exitQuiz;
    }

    // Helper trigger to redirect straight to single study from review badges
    showStudyForKanji(kanjiChar) {
        const idx = this.kanjiData.findIndex(k => k.kanji === kanjiChar);
        if (idx !== -1) {
            this.studyIndex = idx;
            window.location.hash = 'study';
        }
    }

    // --- RENDER DOM: HOME SCREEN ---
    renderHomeScreen() {
        // Progress calculation Grade 10
        const progress = storage.getGradeProgress(this.kanjiData);
        const gr10Card = document.querySelector('.grade-card[data-grade="10"]');
        gr10Card.querySelector('.progress-fill').style.width = `${progress.percentage}%`;
        gr10Card.querySelector('.progress-text').innerText = `学んだ漢字: ${progress.studied}/${progress.total} (${progress.percentage}%)`;

        // Names & counts mapping for all grades
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
            10: '80',
            9: '240',
            8: '440',
            7: '642',
            6: '835',
            5: '1,026',
            4: '2,060',
            3: '2,060',
            2.5: '2,060',
            2: '2,923',
            1.5: '5,923',
            1: '5,923'
        };
        const gradeLabels = {
            2.5: '準2級',
            1.5: '準1級'
        };

        // Render unlocked card status modifications
        this.unlockedGrades = this.getUnlockedGradesList();
        this.unlockedGrades.forEach(g => {
            const card = document.querySelector(`.grade-card[data-grade="${g}"]`);
            if (card && card.classList.contains('locked')) {
                card.classList.remove('locked');
                card.innerHTML = `
          <div class="grade-badge">${gradeLabels[g] || g + '級'}</div>
          <div class="grade-info">
            <h3>${gradeNames[g] || '小学校レベル'}</h3>
            <p class="grade-char-count">配当漢字 ${gradeCounts[g] || '0'}字</p>
          </div>
          <div class="grade-progress-container" id="progress-${g}">
            <div class="progress-bar">
              <div class="progress-fill" style="width: 0%"></div>
            </div>
            <span class="progress-text">学んだ漢字: 0/0 (0%)</span>
          </div>
          <button class="btn btn-primary start-grade-btn">始める</button>
        `;

                // Dynamically compute progress for newly unlocked higher grades
                const gradeToAPI2 = {
                    10: 1, 9: 2, 8: 3, 7: 4, 6: 5, 5: 6,
                    4: 4, 3: 3, 2.5: 2.5, 2: 2,
                    1.5: 1.5, 1: 1
                };
                const targetAPIGrade = gradeToAPI2[g];
                dataManager.getKanjiList(targetAPIGrade).then(list => {
                    const prog = storage.getGradeProgress(list);
                    const block = document.getElementById(`progress-${g}`);
                    block.querySelector('.progress-fill').style.width = `${prog.percentage}%`;
                    block.querySelector('.progress-text').innerText = `学んだ漢字: ${prog.studied}/${prog.total} (${prog.percentage}%)`;
                });

                // Set action binding
                card.querySelector('.start-grade-btn').onclick = async () => {
                    this.currentGrade = g;
                    this.studyIndex = 0;
                    const gradeToAPI3 = {
                        10: 1, 9: 2, 8: 3, 7: 4, 6: 5, 5: 6,
                        4: 4, 3: 3, 2.5: 2.5, 2: 2,
                        1.5: 1.5, 1: 1
                    };
                    const targetAPIGrade = gradeToAPI3[g];
                    this.kanjiData = await dataManager.getKanjiList(targetAPIGrade);
                    window.location.hash = 'study';
                };
            }
        });
    }

    // --- RENDER DOM: STUDY FLASHCARDS ---
    async renderStudyScreen() {
        if (this.kanjiData.length === 0) return;

        // Boundaries checks
        if (this.studyIndex < 0) this.studyIndex = 0;
        if (this.studyIndex >= this.kanjiData.length) this.studyIndex = this.kanjiData.length - 1;

        const k = this.kanjiData[this.studyIndex];

        document.getElementById('study-progress').innerText = `${this.studyIndex + 1} / ${this.kanjiData.length}`;
        document.getElementById('study-kanji').innerText = k.kanji;
        document.getElementById('study-strokes').innerText = `${k.stroke_count}画`;
        document.getElementById('study-onyomi').innerText = k.on_readings.join('、') || 'なし';
        document.getElementById('study-kunyomi').innerText = k.kun_readings.join('、') || 'なし';

        // Fetch and render KanjiVG Stroke Animations helper
        const svgContainer = document.getElementById('stroke-svg-container');
        svgContainer.innerHTML = '<span class="placeholder-text">書き順読み込み中...</span>';

        const svgText = await dataManager.getKanjiSVG(k.kanji);
        if (svgText) {
            // Clear container and output SVG directly
            svgContainer.innerHTML = svgText;

            const svgElement = svgContainer.querySelector('svg');
            if (svgElement) {
                // Enforce aspect containment ratios
                svgElement.setAttribute('width', '100%');
                svgElement.setAttribute('height', '100%');

                // Find paths inside SVG and configure stroke drawing animation
                const paths = svgElement.querySelectorAll('path');
                paths.forEach((path, index) => {
                    const length = path.getTotalLength();
                    path.setAttribute('class', 'stroke-anim');
                    path.style.strokeDasharray = length;
                    path.style.strokeDashoffset = length;
                    // Trigger delays sequentially
                    path.style.animation = `drawStroke 1s cubic-bezier(0.4, 0, 0.2, 1) forwards`;
                    path.style.animationDelay = `${index * 0.9}s`;
                });
            }
        } else {
            svgContainer.innerHTML = '<span class="placeholder-text">書き順データなし</span>';
        }
    }

    navigateStudyCard(direction) {
        this.studyIndex += direction;
        this.renderStudyScreen();
    }

    // --- RENDER DOM: SETTINGS ---
    renderSettingsScreen() {
        // Current grader select setting reflect
        const select = document.getElementById('setting-grader-mode');
        select.value = storage.getSetting('grader-mode', 'auto');

        select.onchange = (e) => {
            storage.saveSetting('grader-mode', e.target.value);
        };

        // Sync button trigger check
        document.getElementById('btn-sync-data').onclick = async (e) => {
            const btn = e.target;
            btn.innerText = '同期中...';
            btn.disabled = true;

            let success = await dataManager.syncGrade(1); // Sync grade 1 lists

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
