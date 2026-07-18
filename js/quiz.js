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
    constructor(grade, mode, kanjiList, viewsManager, config = null) {
        this.grade = grade;
        this.mode = mode; // 'reading' | 'writing' | 'radical' | 'antonym' | 'homophone' | 'same_kun'
        this.kanjiList = [...kanjiList];
        this.viewsManager = viewsManager;
        this.config = config || storage.getQuizConfig(grade, mode) || { count: 20, method: 'random' };

        this.questions = [];
        this.currentIndex = 0;
        this.score = 0;
        this.wrongAnswers = [];

        this.canvas = null;
        this.currentGradingResult = null;
        this.wordRelations = null;
        this.quizStartTime = null;
        this.timerInterval = null;
        this.timerRemaining = 0;

        this.initSession();
    }

    selectQuestions() {
        const { count, method } = this.config;
        const max = count === 0 ? this.kanjiList.length : count; // 0 = 全問
        let pool = [...this.kanjiList];

        switch (method) {
            case 'random':
                pool = this.shuffle(pool);
                break;
            case 'unasked':
                pool = storage.getUnaskedKanji(this.mode, this.kanjiList);
                if (pool.length === 0) pool = this.shuffle([...this.kanjiList]);
                break;
            case 'studied':
                pool = storage.getStudiedKanji(this.kanjiList);
                if (pool.length === 0) pool = this.shuffle([...this.kanjiList]);
                break;
            case 'unstudied':
                pool = storage.getUnstudiedKanji(this.kanjiList);
                if (pool.length === 0) pool = this.shuffle([...this.kanjiList]);
                break;
            case 'sequential': {
                const startPos = storage.getSequentialPosition(this.grade, this.mode);
                pool = this.kanjiList.slice(startPos);
                if (pool.length === 0) {
                    // 全問終了 → 最初に戻る
                    pool = [...this.kanjiList];
                    storage.setSequentialPosition(this.grade, this.mode, 0);
                }
                break;
            }
            case 'wrong':
                pool = storage.getWrongKanjiForMode(this.mode, this.kanjiList);
                if (pool.length === 0) pool = this.shuffle([...this.kanjiList]);
                break;
            case 'custom':
                // config.selectedKanji に含まれる漢字のみ
                if (this.config.selectedKanji) {
                    const sel = new Set(this.config.selectedKanji);
                    pool = this.kanjiList.filter(k => sel.has(k.kanji));
                }
                break;
            default:
                pool = this.shuffle(pool);
        }

        return pool.slice(0, Math.min(max, pool.length));
    }

    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    async initSession() {
        this.questions = this.selectQuestions();
        this.currentIndex = 0;
        this.score = 0;
        this.wrongAnswers = [];

        // Start quiz timer for time attack mode
        if (this.config.timeAttack) {
            this.quizStartTime = Date.now();
        }

        // Show/hide timer display
        const timerEl = document.getElementById('quiz-timer');
        const writingTimerEl = document.getElementById('writing-quiz-timer');
        if (this.config.timeAttack) {
            if (timerEl) timerEl.style.display = 'block';
            if (writingTimerEl) writingTimerEl.style.display = 'block';
        } else {
            if (timerEl) timerEl.style.display = 'none';
            if (writingTimerEl) writingTimerEl.style.display = 'none';
        }

        if (this.mode === 'antonym' || this.mode === 'same_kun' || this.mode === 'homophone') {
            this.wordRelations = await dataManager.getWordRelations();
        }

        // Update quiz type title
        const modeTitles = {
            reading: '「読み」クイズ',
            writing: '「書き取り」試験',
            radical: '「部首」クイズ',
            antonym: '「対義語」クイズ',
            homophone: '「同音異字」クイズ',
            same_kun: '「同訓異字」クイズ'
        };
        const titleEl = document.getElementById('quiz-type-title');
        if (titleEl) titleEl.innerText = modeTitles[this.mode] || 'クイズ';

        console.log(`Starting ${this.mode} quiz with ${this.questions.length} questions.`);

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
            document.getElementById('btn-writing-back').onclick = () => {
                this.viewsManager.activeQuiz = null;
                window.location.hash = 'study';
            };
        }
    }

    startTimer() {
        this.stopTimer();
        if (!this.config.timeAttack) return;

        this.timerRemaining = this.config.timeLimit || 15;
        this.updateTimerDisplay();

        this.timerInterval = setInterval(() => {
            this.timerRemaining--;
            this.updateTimerDisplay();
            if (this.timerRemaining <= 0) {
                this.stopTimer();
                this.handleTimeUp();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        const sec = this.timerRemaining;
        const timerSecEl = document.getElementById('quiz-timer-seconds');
        const writingTimerSecEl = document.getElementById('writing-quiz-timer-seconds');
        if (timerSecEl) timerSecEl.innerText = sec;
        if (writingTimerSecEl) writingTimerSecEl.innerText = sec;

        // Change color when running low
        const timerEl = document.getElementById('quiz-timer');
        const writingTimerEl = document.getElementById('writing-quiz-timer');
        const lowClass = sec <= 5 ? 'timer-low' : '';
        if (timerEl) timerEl.className = `quiz-timer ${lowClass}`;
        if (writingTimerEl) writingTimerEl.className = `quiz-timer ${lowClass}`;
    }

    handleTimeUp() {
        // Time's up = incorrect
        const q = this.questions[this.currentIndex];
        this.wrongAnswers.push(q);
        if (this.mode !== 'writing') {
            storage.saveQuizResult(q.kanji, this.mode, false);
        }
        this.goToNextQuestion();
    }

    loadChoiceQuestion() {
        const q = this.questions[this.currentIndex];

        document.getElementById('quiz-q-num').innerText = `${this.currentIndex + 1} / ${this.questions.length}`;
        document.getElementById('quiz-progress-bar').style.width = `${((this.currentIndex) / this.questions.length) * 100}%`;

        const charEl = document.getElementById('quiz-q-char');
        const promptEl = document.getElementById('quiz-q-prompt');
        const choicesEl = document.getElementById('quiz-choices');

        choicesEl.innerHTML = '';

        const modeConfig = {
            reading: { prompt: 'この漢字の正しい読み方は？', render: 'renderReadingChoices' },
            radical: { prompt: 'この漢字の部首は？', render: 'renderRadicalChoices' },
            antonym: { prompt: 'この熟語の対義語を選んでください', render: 'renderAntonymChoices' },
            homophone: { prompt: 'この読みに当てはまる漢字は？', render: 'renderHomophoneChoices' },
            same_kun: { prompt: 'この訓読みに当てはまる漢字は？', render: 'renderSameKunChoices' }
        };

        const config = modeConfig[this.mode];
        if (!config) return;

        promptEl.innerText = config.prompt;
        charEl.innerText = q.kanji;
        const contextEl = document.getElementById('quiz-q-context');
        contextEl.style.display = 'none';
        contextEl.innerText = '';
        this[config.render](q);
        this.startTimer();
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
        const charEl = document.getElementById('quiz-q-char');
        const promptEl = document.getElementById('quiz-q-prompt');
        const contextEl = document.getElementById('quiz-q-context');

        let correct = '';

        if (questionItem.examples && questionItem.examples.length > 0) {
            // 例文の中でsentencesを持つものを優先的に選ぶ
            const exsWithSentences = questionItem.examples.filter(e => e.sentences && e.sentences.length > 0);
            const ex = exsWithSentences.length > 0
                ? exsWithSentences[Math.floor(Math.random() * exsWithSentences.length)]
                : questionItem.examples[Math.floor(Math.random() * questionItem.examples.length)];

            if (ex.sentences && ex.sentences.length > 0) {
                // 文章問題: 文章内の単語に下線を引いて読みを問う
                const sentence = ex.sentences[Math.floor(Math.random() * ex.sentences.length)];
                charEl.innerHTML = sentence.replace(ex.word, `<span class="furigana-target">${ex.word}</span>`);
                charEl.style.fontSize = '1.4rem';
                charEl.style.lineHeight = '1.8';
                promptEl.innerText = '下線の言葉の読みは？';
            } else {
                // 例文のみ（文章なし）: 単語を表示して読みを問う
                charEl.innerHTML = `<span class="furigana-target">${ex.word}</span>`;
                charEl.style.fontSize = '2rem';
                charEl.style.lineHeight = '1';
                promptEl.innerText = '下線の言葉の読みは？';
            }
            contextEl.style.display = 'none';
            // Use the full word reading as the correct answer
            correct = ex.reading;

            // Build distractor pool from other examples' readings of all kanji in the same grade
            const allExampleReadings = new Set();
            this.kanjiList.forEach(k => {
                if (k.examples) {
                    k.examples.forEach(e => {
                        if (e.reading !== correct) allExampleReadings.add(e.reading);
                    });
                }
            });

            const choices = this.generateDistractors(correct, allExampleReadings, false);

            choices.forEach(c => {
                const btn = document.createElement('button');
                btn.className = 'choice-btn font-japanese';
                btn.innerText = c;
                btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
                document.getElementById('quiz-choices').appendChild(btn);
            });
        } else {
            // No examples: show kanji alone, ask for reading
            const correctRaw = questionItem.kun_readings[0] || questionItem.on_readings[0] || '不明';
            const hasOkurigana = correctRaw.includes('.') || correctRaw.includes('-');
            if (hasOkurigana) {
                const okurigana = correctRaw.split(/[.\-]/)[1] || '';
                charEl.innerHTML = `${questionItem.kanji}<span class="okurigana">${okurigana}</span>`;
            } else {
                charEl.innerText = questionItem.kanji;
            }
            charEl.style.fontSize = '';
            promptEl.innerText = 'この漢字の読み方は？';
            contextEl.style.display = 'none';
            correct = hasOkurigana ? correctRaw.split(/[.\-]/)[0] : correctRaw;

            // Build distractor pool from all kanji readings
            const allReadings = new Set();
            this.kanjiList.forEach(k => {
                k.kun_readings.forEach(r => {
                    const parts = r.split(/[.\-]/);
                    allReadings.add(parts[0]);
                });
                k.on_readings.forEach(r => allReadings.add(r));
            });

            const choices = this.generateDistractors(correct, allReadings, false);

            choices.forEach(c => {
                const btn = document.createElement('button');
                btn.className = 'choice-btn font-japanese';
                btn.innerText = c;
                btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
                document.getElementById('quiz-choices').appendChild(btn);
            });
        }
    }

    renderRadicalChoices(questionItem) {
        const correct = questionItem.radical_name || '不明';
        const correctDisplay = questionItem.radical ? `${questionItem.radical}（${questionItem.radical_name}）` : '不明';

        // Show example context
        const contextEl = document.getElementById('quiz-q-context');
        if (questionItem.examples && questionItem.examples.length > 0) {
            const ex = questionItem.examples[Math.floor(Math.random() * questionItem.examples.length)];
            const blanked = ex.word.replace(questionItem.kanji, '＿');
            contextEl.innerHTML = `<span class="context-sentence">${blanked}（${ex.reading}）</span>`;
            contextEl.style.display = 'block';
        } else {
            contextEl.style.display = 'none';
        }

        const allRadicals = new Set();
        this.kanjiList.forEach(k => {
            if (k.radical && k.radical_name) allRadicals.add(`${k.radical}（${k.radical_name}）`);
        });

        const choices = this.generateDistractors(correctDisplay, allRadicals, false);

        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn font-japanese';
            btn.innerText = c;
            btn.onclick = () => this.handleChoiceClick(btn, c === correctDisplay, questionItem);
            document.getElementById('quiz-choices').appendChild(btn);
        });
    }

    renderAntonymChoices(questionItem) {
        const antonyms = (this.wordRelations?.antonyms || []).filter(a => a.word.includes(questionItem.kanji));
        if (antonyms.length === 0) {
            this.goToNextQuestion();
            return;
        }
        const ant = antonyms[Math.floor(Math.random() * antonyms.length)];
        const correct = ant.antonym;

        document.getElementById('quiz-q-char').innerText = ant.word;

        const allAntonyms = new Set((this.wordRelations?.antonyms || []).map(a => a.antonym));
        const choices = this.generateDistractors(correct, allAntonyms, false);

        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn font-japanese';
            btn.innerText = c;
            btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
            document.getElementById('quiz-choices').appendChild(btn);
        });
    }

    renderHomophoneChoices(questionItem) {
        const correct = questionItem.kanji;
        let same = [];

        // まず word-relations.json の homophones を使用
        const relationEntry = (this.wordRelations?.homophones || []).find(h => h.kanji === correct);
        if (relationEntry && Array.isArray(relationEntry.homophones) && relationEntry.homophones.length > 0) {
            same = relationEntry.homophones.filter(k => k !== correct);
        }

        // フォールバック: 音読みが同じ漢字を動的に検索
        if (same.length === 0) {
            const reading = questionItem.on_readings[0];
            if (!reading) { this.goToNextQuestion(); return; }
            same = this.kanjiList
                .filter(k => k.on_readings.includes(reading) && k.kanji !== correct)
                .map(k => k.kanji);
        }

        if (same.length === 0) { this.goToNextQuestion(); return; }

        const allKanji = new Set(same);
        allKanji.add(correct);

        // Show example sentence with blank for context
        const contextEl = document.getElementById('quiz-q-context');
        if (questionItem.examples && questionItem.examples.length > 0) {
            const ex = questionItem.examples[Math.floor(Math.random() * questionItem.examples.length)];
            const blanked = ex.word.replace(questionItem.kanji, '＿');
            contextEl.innerHTML = `<span class="context-sentence">${blanked}（${ex.reading}）</span>`;
            contextEl.style.display = 'block';
        } else {
            const meanings = (questionItem.meanings_ja || questionItem.meanings || []).join(', ');
            contextEl.innerHTML = `<span class="context-sentence">意味: ${meanings}</span>`;
            contextEl.style.display = 'block';
        }

        document.getElementById('quiz-q-char').innerText = reading;

        const choices = this.generateDistractors(correct, allKanji, false);

        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn font-serif';
            btn.style.fontSize = '2rem';
            btn.innerText = c;
            btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
            document.getElementById('quiz-choices').appendChild(btn);
        });
    }

    renderSameKunChoices(questionItem) {
        const kun = questionItem.kun_readings[0];
        if (!kun) { this.goToNextQuestion(); return; }

        const cleanKun = kun.replace(/\.|\-/g, '');
        const sameKunGroups = (this.wordRelations?.same_kun || []).filter(g => g.reading === cleanKun);
        
        let candidates;
        if (sameKunGroups.length > 0) {
            candidates = sameKunGroups[0].kanji.filter(k => k !== questionItem.kanji);
        } else {
            candidates = this.kanjiList.filter(k => {
                if (k.kanji === questionItem.kanji) return false;
                return k.kun_readings.some(r => r.replace(/\.|\-/g, '') === cleanKun);
            }).map(k => k.kanji);
        }

        if (candidates.length === 0) { this.goToNextQuestion(); return; }

        const correct = questionItem.kanji;
        const allKanji = new Set(candidates);
        allKanji.add(correct);

        document.getElementById('quiz-q-char').innerText = cleanKun;

        const choices = this.generateDistractors(correct, allKanji, false);

        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn font-serif';
            btn.style.fontSize = '2rem';
            btn.innerText = c;
            btn.onclick = () => this.handleChoiceClick(btn, c === correct, questionItem);
            document.getElementById('quiz-choices').appendChild(btn);
        });
    }

    handleChoiceClick(selectedBtn, isCorrect, questionItem) {
        this.stopTimer();
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

            const correctMap = {
                reading: () => {
                    const raw = questionItem.kun_readings[0] || questionItem.on_readings[0] || '';
                    const hasOkuri = raw.includes('.') || raw.includes('-');
                    return hasOkuri ? raw.split(/[.\-]/)[0] : raw;
                },
                radical: () => questionItem.radical ? `${questionItem.radical}（${questionItem.radical_name}）` : '',
                antonym: () => {
                    const ants = (this.wordRelations?.antonyms || []).filter(a => a.word.includes(questionItem.kanji));
                    return ants.length > 0 ? ants[0].antonym : '';
                },
                homophone: () => questionItem.kanji,
                same_kun: () => questionItem.kanji
            };

            const correctAnswerText = correctMap[this.mode] ? correctMap[this.mode]() : '';

            Array.from(choicesEl.children).forEach(btn => {
                if (btn.innerText === correctAnswerText) {
                    btn.classList.add('correct');
                    btn.style.opacity = '1';
                }
            });
        }

        setTimeout(() => this.goToNextQuestion(), 1300);
    }

    // --- WRITING/DRAWING LOGIC (CANVAS WRITING) ---
    loadWritingQuestion() {
        const q = this.questions[this.currentIndex];
        this.currentQuestionSaved = false;

        document.getElementById('writing-quiz-q-num').innerText = `${this.currentIndex + 1} / ${this.questions.length}`;
        document.getElementById('writing-quiz-progress-bar').style.width = `${((this.currentIndex) / this.questions.length) * 100}%`;

        this.canvas.clear();

        document.getElementById('grading-panel').classList.add('hidden');
        document.getElementById('grader-overlay').classList.add('hidden');
        document.getElementById('grader-overlay').className = 'grader-overlay hidden';
        document.getElementById('btn-canvas-check').classList.remove('hidden');
        document.getElementById('btn-canvas-clear').disabled = false;
        document.getElementById('btn-writing-next').classList.add('hidden');
        document.getElementById('btn-writing-back').classList.remove('hidden');

        let promptText, hintText;
        if (q.examples && q.examples.length > 0) {
            const ex = q.examples[Math.floor(Math.random() * q.examples.length)];
            const blanked = ex.word.replace(q.kanji, '＿');
            promptText = `${blanked}（${ex.reading}）`;
            hintText = `意味: ${(q.meanings_ja || q.meanings || []).join(', ')}`;
        } else {
            const readPrompt = (q.kun_readings[0] || q.on_readings[0] || '').replace(/\.|\-/g, '');
            promptText = readPrompt;
            hintText = `意味: ${(q.meanings_ja || q.meanings || []).join(', ')}`;
        }

        document.getElementById('writing-q-word').innerText = promptText;
        document.getElementById('writing-q-hint').innerText = hintText;
        this.startTimer();
    }

    async evaluateWriting() {
        this.stopTimer();
        const q = this.questions[this.currentIndex];

        // Keep clear and check buttons enabled for re-grading

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
            this.saveWritingProgressOfQuestion();
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
        document.getElementById('btn-writing-back').classList.remove('hidden');

        this.saveWritingProgressOfQuestion();
    }

    saveWritingProgressOfQuestion() {
        const q = this.questions[this.currentIndex];
        const isCorrect = this.currentGradingResult.finalResult;

        if (!this.currentQuestionSaved) {
            this.currentQuestionSaved = true;
            this.currentQuestionResult = isCorrect;
            if (isCorrect) {
                this.score++;
                storage.saveQuizResult(q.kanji, 'writing', true);
            } else {
                this.wrongAnswers.push(q);
                storage.saveQuizResult(q.kanji, 'writing', false);
            }
        } else {
            if (this.currentQuestionResult !== isCorrect) {
                if (isCorrect) {
                    this.score++;
                    const idx = this.wrongAnswers.findIndex(w => w.kanji === q.kanji);
                    if (idx !== -1) this.wrongAnswers.splice(idx, 1);
                } else {
                    this.score--;
                    this.wrongAnswers.push(q);
                }
                this.currentQuestionResult = isCorrect;
            }
        }
    }

    // --- GENERAL TRANSITION SEQUENCE ---
    goToNextQuestion() {
        this.stopTimer();
        this.currentIndex++;

        // If quiz was started from study mode (single kanji), go back to study with next kanji
        if (this.questions.length === 1 && this.viewsManager.kanjiData.length > 0) {
            this.viewsManager.activeQuiz = null;
            this.viewsManager.studyIndex = Math.min(this.viewsManager.studyIndex + 1, this.viewsManager.kanjiData.length - 1);
            window.location.hash = 'study';
            return;
        }

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
        const accuracyEl = document.getElementById('results-accuracy');

        accuracyEl.innerText = `${percent}%`;

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

        // Timer info (for time attack mode)
        const timerInfoEl = document.getElementById('results-timer-info');
        if (this.config.timeAttack && this.quizStartTime) {
            const totalTime = Math.round((Date.now() - this.quizStartTime) / 1000);
            const avgTime = Math.round(totalTime / this.questions.length);
            timerInfoEl.innerText = `所要時間: ${totalTime}秒（1問平均 ${avgTime}秒）`;
            timerInfoEl.style.display = 'block';
        } else {
            timerInfoEl.style.display = 'none';
        }

        // Session history bars
        const historyEl = document.getElementById('results-history');
        const historyBarsEl = document.getElementById('results-history-bars');
        const sessions = storage.getQuizSessions(this.grade, this.mode).slice(-5);
        if (sessions.length > 0) {
            historyBarsEl.innerHTML = sessions.map(s => {
                const sPercent = Math.round((s.score / s.total) * 100);
                const isCurrent = s.id === this.lastSessionId;
                return `<div class="history-bar-item ${isCurrent ? 'current' : ''}">
                    <div class="history-bar" style="height: ${sPercent}%"></div>
                    <span class="history-bar-label">${sPercent}%</span>
                </div>`;
            }).join('');
            historyEl.style.display = 'block';
        } else {
            historyEl.style.display = 'none';
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

        // Retry-wrong button: only show if there are wrong answers
        const retryWrongBtn = document.getElementById('btn-results-retry-wrong');
        if (this.wrongAnswers.length > 0) {
            retryWrongBtn.style.display = 'block';
            retryWrongBtn.onclick = () => {
                // Deduplicate wrong answers
                const uniqueWrong = [];
                const seen = new Set();
                this.wrongAnswers.forEach(q => {
                    if (!seen.has(q.kanji)) {
                        seen.add(q.kanji);
                        uniqueWrong.push(q);
                    }
                });
                const wrongConfig = { count: 0, method: 'custom', selectedKanji: uniqueWrong.map(q => q.kanji) };
                this.activeQuiz = new QuizSession(this.grade, this.mode, uniqueWrong, this.viewsManager, wrongConfig);
                if (this.mode === 'writing') {
                    window.location.hash = 'quiz-writing';
                } else {
                    window.location.hash = 'quiz-active';
                }
            };
        } else {
            retryWrongBtn.style.display = 'none';
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

        // Save session history
        const sessionId = Date.now();
        this.lastSessionId = sessionId;
        storage.saveQuizSession(this.grade, this.mode, this.config, {
            score: this.score,
            total: this.questions.length,
            wrongKanji: this.wrongAnswers.map(q => q.kanji)
        });

        // Update sequential position
        if (this.config.method === 'sequential') {
            const startPos = storage.getSequentialPosition(this.grade, this.mode);
            const newPos = startPos + this.questions.length;
            const total = this.kanjiList.length;
            storage.setSequentialPosition(this.grade, this.mode, newPos >= total ? 0 : newPos);
        }

        // Transition to Results screen
        window.location.hash = 'results';
    }
}
