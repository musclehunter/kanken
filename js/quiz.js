/**
 * js/quiz.js
 * 
 * Orchestrates study quiz sessions (Reading, Stroke Count, Writing/Drawing).
 * Manages question pools, multiple choice distractors, and results handling.
 */

import { storage } from './storage.js';
import { grader } from './grader.js';
import { dataManager } from './data-manager.js';
import { HandwritingCanvas } from './canvas.js';

export class QuizSession {
    constructor(grade, mode, kanjiList, viewsManager) {
        this.grade = grade;
        this.mode = mode; // 'reading' | 'strokes' | 'writing'
        this.kanjiList = [...kanjiList];
        this.viewsManager = viewsManager;

        this.questions = [];
        this.currentIndex = 0;
        this.score = 0;
        this.wrongAnswers = []; // Store incorrect items for review screen

        this.canvas = null; // Canvas instance for writing mode
        this.currentGradingResult = null;

        this.initSession();
    }

    initSession() {
        // Pick 10 random kanji (or less if pool is smaller)
        const shuffled = this.kanjiList.sort(() => 0.5 - Math.random());
        this.questions = shuffled.slice(0, Math.min(10, shuffled.length));
        this.currentIndex = 0;
        this.score = 0;
        this.wrongAnswers = [];

        console.log(`Starting ${this.mode} quiz with ${this.questions.length} questions.`);

        // Load first question
        if (this.mode === 'writing') {
            this.initWritingCanvasOnce();
            this.loadWritingQuestion();
        } else {
            this.loadChoiceQuestion();
        }
    }

    initWritingCanvasOnce() {
        if (!this.canvas) {
            this.canvas = new HandwritingCanvas('handwriting-canvas');

            // Bind clear & check buttons
            document.getElementById('btn-canvas-clear').onclick = () => this.canvas.clear();
            document.getElementById('btn-canvas-check').onclick = () => this.evaluateWriting();

            // Bind manual override buttons
            document.getElementById('btn-self-correct').onclick = () => this.submitWritingResult(true);
            document.getElementById('btn-self-incorrect').onclick = () => this.submitWritingResult(false);
            document.getElementById('btn-writing-next').onclick = () => this.goToNextQuestion();
        }
    }

    // --- MULTIPLE CHOICE LOGIC (READING & STROKES) ---
    loadChoiceQuestion() {
        const q = this.questions[this.currentIndex];

        // UI Outlines
        document.getElementById('quiz-q-num').innerText = `${this.currentIndex + 1} / ${this.questions.length}`;
        document.getElementById('quiz-progress-bar').style.width = `${((this.currentIndex) / this.questions.length) * 100}%`;

        const charEl = document.getElementById('quiz-q-char');
        const promptEl = document.getElementById('quiz-q-prompt');
        const choicesEl = document.getElementById('quiz-choices');

        choicesEl.innerHTML = ''; // Clear options
        charEl.innerText = q.kanji;

        if (this.mode === 'reading') {
            promptEl.innerText = 'この漢字の正しい読み方は？ (代表的な読み)';
            this.renderReadingChoices(q);
        } else if (this.mode === 'strokes') {
            promptEl.innerText = 'この漢字の総画数は？';
            this.renderStrokeChoices(q);
        }
    }

    generateDistractors(correctValue, allPossibleValues, isNum = false) {
        const choices = new Set([correctValue]);

        // Shuffle pool to pick random items
        const pool = [...allPossibleValues].sort(() => 0.5 - Math.random());

        // Add distractors
        for (let item of pool) {
            if (choices.size >= 4) break;
            if (item !== correctValue) {
                choices.add(item);
            }
        }

        // If still not enough choices (e.g. not enough inputs), generate generic values
        while (choices.size < 4) {
            if (isNum) {
                const dummyNum = Math.max(1, correctValue + (choices.size * (Math.random() > 0.5 ? 1 : -1)));
                choices.add(dummyNum);
            } else {
                choices.add('？');
            }
        }

        return [...choices].sort(() => 0.5 - Math.random());
    }

    renderReadingChoices(questionItem) {
        // Get correct reading
        // Prefer hiragana/kunyomi or onyomi katakana
        const correct = questionItem.kun_readings[0] || questionItem.on_readings[0] || '不明';

        // Gather all other readings from same grade
        const allReadings = new Set();
        this.kanjiList.forEach(k => {
            k.kun_readings.forEach(r => allReadings.add(r));
            k.on_readings.forEach(r => allReadings.add(r));
        });

        const choices = this.generateDistractors(correct, allReadings, false);

        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn font-japanese';
            btn.innerText = c.replace(/\.|\-/g, ''); // Clean dots/hyphens for presentation
            btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
            document.getElementById('quiz-choices').appendChild(btn);
        });
    }

    renderStrokeChoices(questionItem) {
        const correct = questionItem.stroke_count;

        // Gather all stroke counts
        const allStrokes = this.kanjiList.map(k => k.stroke_count);
        const choices = this.generateDistractors(correct, allStrokes, true);

        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.innerText = `${c} 画`;
            btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
            document.getElementById('quiz-choices').appendChild(btn);
        });
    }

    handleChoiceClick(selectedBtn, isCorrect, questionItem) {
        // Disable other choice buttons
        const choicesEl = document.getElementById('quiz-choices');
        Array.from(choicesEl.children).forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.6';
        });

        selectedBtn.style.opacity = '1';

        if (isCorrect) {
            selectedBtn.classList.add('correct');
            this.score++;
            storage.saveQuizResult(questionItem.kanji, this.mode, true);
        } else {
            selectedBtn.classList.add('incorrect');
            this.wrongAnswers.push(questionItem);
            storage.saveQuizResult(questionItem.kanji, this.mode, false);

            // Highlight the correct option
            const correctAnswerText = this.mode === 'reading'
                ? (questionItem.kun_readings[0] || questionItem.on_readings[0] || '').replace(/\.|\-/g, '')
                : `${questionItem.stroke_count} 画`;

            Array.from(choicesEl.children).forEach(btn => {
                if (btn.innerText === correctAnswerText) {
                    btn.classList.add('correct');
                    btn.style.opacity = '1';
                }
            });
        }

        // Wait a brief second to show correctness, then proceed
        setTimeout(() => this.goToNextQuestion(), 1300);
    }

    // --- WRITING/DRAWING LOGIC (CANVAS WRITING) ---
    loadWritingQuestion() {
        const q = this.questions[this.currentIndex];

        // UI Init
        document.getElementById('writing-quiz-q-num').innerText = `${this.currentIndex + 1} / ${this.questions.length}`;
        document.getElementById('writing-quiz-progress-bar').style.width = `${((this.currentIndex) / this.questions.length) * 100}%`;

        this.canvas.clear();

        // Hide panels and overlays
        document.getElementById('grading-panel').classList.add('hidden');
        document.getElementById('grader-overlay').classList.add('hidden');
        document.getElementById('grader-overlay').className = 'grader-overlay hidden';
        document.getElementById('btn-canvas-check').classList.remove('hidden');
        document.getElementById('btn-canvas-clear').disabled = false;

        // Build prompt: present reading in hiragana or katakana (cleaning special symbols)
        const readPrompt = (q.kun_readings[0] || q.on_readings[0] || '').replace(/\.|\-/g, '');
        document.getElementById('writing-q-word').innerText = readPrompt;

        // Meanings hint
        document.getElementById('writing-q-hint').innerText = `意味 (Hint): ${q.meanings.join(', ')}`;
    }

    async evaluateWriting() {
        const q = this.questions[this.currentIndex];

        // Lock canvas from clearing during check
        document.getElementById('btn-canvas-clear').disabled = true;
        document.getElementById('btn-canvas-check').classList.add('hidden');

        // 1. Get user configuration default grader
        const defaultMode = storage.getSetting('grader-mode', 'auto');
        const isSelfOnly = defaultMode === 'self';

        // 2. Classify strokes using grader
        this.currentGradingResult = await grader.grade(this.canvas, q.kanji, isSelfOnly);

        // Update Canvas Overlay Status Symbols representation
        const overlay = document.getElementById('grader-overlay');
        const symbol = overlay.querySelector('.overlay-symbol');
        overlay.className = 'grader-overlay';

        // Update Reveal Section
        document.getElementById('reveal-correct-kanji').innerText = q.kanji;
        document.getElementById('reveal-onyomi').innerText = q.on_readings.join('、') || 'なし';
        document.getElementById('reveal-kunyomi').innerText = q.kun_readings.join('、') || 'なし';

        const panel = document.getElementById('grading-panel');
        const autoResultEl = document.getElementById('auto-grader-result');
        const selfGradingBtns = panel.querySelector('.self-grading-buttons');
        const nextBtn = document.getElementById('btn-writing-next');

        panel.classList.remove('hidden');

        if (this.currentGradingResult.mode === 'self') {
            // Self Assessment Mode
            autoResultEl.classList.add('hidden');
            selfGradingBtns.classList.remove('hidden');
            nextBtn.classList.add('hidden');

            // Draw standard question mark on overlay
            symbol.innerText = '？';
            symbol.style.color = '#a78bfa';
            overlay.classList.remove('hidden');
        } else {
            // Auto Graded Mode (Handwriting API or Pixel comparison)
            autoResultEl.classList.remove('hidden');
            selfGradingBtns.classList.add('hidden');
            nextBtn.classList.remove('hidden');

            const success = this.currentGradingResult.success;
            const scoreText = this.currentGradingResult.score !== undefined ? ` (一致率 ${this.currentGradingResult.score}%)` : '';

            const resText = document.getElementById('auto-result-text');
            resText.innerText = success ? '正解 🎉' : '不一致 ⚠️';
            resText.className = success ? 'status-correct' : 'status-incorrect';
            document.getElementById('auto-result-percentage').innerText = this.currentGradingResult.feedback;

            // Overlay feedback
            symbol.innerText = success ? '✓' : '✗';
            symbol.className = success ? 'overlay-symbol symbol-correct' : 'overlay-symbol symbol-incorrect';
            overlay.classList.remove('hidden');

            // Save result immediately
            this.currentGradingResult.finalResult = success;
        }
    }

    // Submit result for writing self-evaluation overrides
    submitWritingResult(isCorrect) {
        this.currentGradingResult.finalResult = isCorrect;

        // Update visual overlay feedback symbol
        const overlay = document.getElementById('grader-overlay');
        const symbol = overlay.querySelector('.overlay-symbol');
        symbol.innerText = isCorrect ? '✓' : '✗';
        symbol.className = isCorrect ? 'overlay-symbol symbol-correct' : 'overlay-symbol symbol-incorrect';

        // Hide user choice controls, show Next button
        document.getElementById('auto-grader-result').classList.add('hidden');
        document.getElementById('grading-panel').querySelector('.self-grading-buttons').classList.add('hidden');
        document.getElementById('btn-writing-next').classList.remove('hidden');
    }

    saveWritingProgressOfQuestion() {
        const q = this.questions[this.currentIndex];
        const isCorrect = this.currentGradingResult.finalResult;

        if (isCorrect) {
            this.score++;
            storage.saveQuizResult(q.kanji, 'writing', true);
        } else {
            this.wrongAnswers.push(q);
            storage.saveQuizResult(q.kanji, 'writing', false);
        }
    }

    // --- GENERAL TRANSITION SEQUENCE ---
    goToNextQuestion() {
        if (this.mode === 'writing') {
            this.saveWritingProgressOfQuestion();
        }

        this.currentIndex++;

        if (this.currentIndex < this.questions.length) {
            if (this.mode === 'writing') {
                this.loadWritingQuestion();
            } else {
                this.loadChoiceQuestion();
            }
        } else {
            this.endQuizSession();
        }
    }

    endQuizSession() {
        console.log('Quiz ended. Final Score:', this.score);

        // Set up results values
        document.getElementById('results-score').innerText = `${this.score} / ${this.questions.length}`;

        const percent = Math.round((this.score / this.questions.length) * 100);
        const titleEl = document.getElementById('results-title');
        const msgEl = document.getElementById('results-message');

        if (percent === 100) {
            titleEl.innerText = '素晴らしい！ 満点です 💮';
            msgEl.innerText = 'すべての問題に正しく答えることができました！漢字検定合格にグッと近づきました。';
        } else if (percent >= 70) {
            titleEl.innerText = '合格ライン突破！ 🎉';
            msgEl.innerText = 'よくできました！漢検の合格基準（通常70%〜80%以上）を満たしています。';
        } else {
            titleEl.innerText = 'お疲れ様でした！ 📝';
            msgEl.innerText = '間違えた箇所を復習して、次は合格ライン突破を目指しましょう！';
        }

        // Output wrong kanji list badges
        const wrongListContainer = document.getElementById('wrong-kanji-list');
        wrongListContainer.innerHTML = '';

        if (this.wrongAnswers.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'placeholder-text w-full text-center py-2';
            emptyMsg.innerText = '間違えた漢字はありません！完璧です。';
            wrongListContainer.appendChild(emptyMsg);
        } else {
            // Deduplicate wrong answers
            const uniqueWrong = [];
            const seen = new Set();
            this.wrongAnswers.forEach(q => {
                if (!seen.has(q.kanji)) {
                    seen.add(q.kanji);
                    uniqueWrong.push(q);
                }
            });

            uniqueWrong.forEach(q => {
                const badge = document.createElement('div');
                badge.className = 'wrong-kanji-badge';
                badge.innerHTML = `<span class="kanji font-serif">${q.kanji}</span><span class="reading font-japanese">${(q.kun_readings[0] || q.on_readings[0] || '').replace(/\.|\-/g, '')}</span>`;
                badge.onclick = () => {
                    // Go directly to study page for this kanji
                    this.viewsManager.showStudyForKanji(q.kanji);
                };
                wrongListContainer.appendChild(badge);
            });
        }

        // Set retry callback functions
        document.getElementById('btn-results-retry').onclick = () => {
            this.initSession();
            if (this.mode === 'writing') {
                window.location.hash = 'quiz-writing';
            } else {
                window.location.hash = 'quiz-active';
            }
        };

        document.getElementById('btn-results-home').onclick = () => {
            window.location.hash = 'home';
        };

        // Transition to Results screen
        window.location.hash = 'results';
    }
}
