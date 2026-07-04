/**
 * js/storage.js
 * 
 * Simple persistent storage wrapper using localStorage
 * to track quiz history, settings, and statistics.
 */

const STORAGE_PREFIX = 'kanji_master_';

export const storage = {
    // Save check results: isCorrect is boolean
    saveQuizResult(kanji, type, isCorrect) {
        const key = `${STORAGE_PREFIX}history`;
        let history = this.getJson(key) || {};

        if (!history[kanji]) {
            history[kanji] = {
                reading_attempts: 0,
                reading_correct: 0,
                writing_attempts: 0,
                writing_correct: 0,
                radical_attempts: 0,
                radical_correct: 0,
                antonym_attempts: 0,
                antonym_correct: 0,
                homophone_attempts: 0,
                homophone_correct: 0,
                same_kun_attempts: 0,
                same_kun_correct: 0,
                manually_studied: false,
                last_attempt: null
            };
        }

        // Increment attempts and correct count
        const record = history[kanji];
        record[`${type}_attempts`]++;
        if (isCorrect) {
            record[`${type}_correct`]++;
        }
        record.last_attempt = Date.now();

        this.setJson(key, history);
    },

    // Mark kanji as manually studied (user pressed "覚えた" button)
    markStudied(kanji) {
        const key = `${STORAGE_PREFIX}history`;
        let history = this.getJson(key) || {};
        if (!history[kanji]) {
            history[kanji] = {
                reading_attempts: 0, reading_correct: 0,
                writing_attempts: 0, writing_correct: 0,
                radical_attempts: 0, radical_correct: 0,
                antonym_attempts: 0, antonym_correct: 0,
                homophone_attempts: 0, homophone_correct: 0,
                same_kun_attempts: 0, same_kun_correct: 0,
                manually_studied: false, last_attempt: null
            };
        }
        history[kanji].manually_studied = true;
        this.setJson(key, history);
    },

    // Unmark kanji as manually studied
    unmarkStudied(kanji) {
        const key = `${STORAGE_PREFIX}history`;
        let history = this.getJson(key) || {};
        if (history[kanji]) {
            history[kanji].manually_studied = false;
            this.setJson(key, history);
        }
    },

    // Check if a kanji is studied (either manually or via quiz correct answer)
    isStudied(kanji) {
        const record = this.getHistory(kanji);
        if (!record) return false;
        if (record.manually_studied) return true;
        const types = ['reading', 'writing', 'radical', 'antonym', 'homophone', 'same_kun'];
        return types.some(t => (record[`${t}_correct`] || 0) > 0);
    },

    // Get learning history for all or single kanji
    getHistory(kanji = null) {
        const key = `${STORAGE_PREFIX}history`;
        const history = this.getJson(key) || {};
        if (kanji) {
            return history[kanji] || null;
        }
        return history;
    },

    // Get list of wrong kanji for a grade (based on failing last attempt or low percentage)
    getWrongKanjiList(gradeKanjiList) {
        const history = this.getHistory();
        const wrongList = [];
        const types = ['reading', 'writing', 'radical', 'antonym', 'homophone', 'same_kun'];

        gradeKanjiList.forEach(item => {
            const record = history[item.kanji];
            if (record) {
                let totalAttempts = 0, totalCorrect = 0;
                for (const t of types) {
                    totalAttempts += record[`${t}_attempts`] || 0;
                    totalCorrect += record[`${t}_correct`] || 0;
                }

                if (totalAttempts > 0) {
                    const successRate = totalCorrect / totalAttempts;
                    if (successRate < 0.7) {
                        wrongList.push({
                            kanji: item.kanji,
                            reading: item.kun_readings[0] || item.on_readings[0] || '',
                            failRate: Math.round((1 - successRate) * 100)
                        });
                    }
                }
            }
        });

        return wrongList.sort((a, b) => b.failRate - a.failRate);
    },

    // Get statistics for the grade
    getGradeProgress(gradeKanjiList) {
        const history = this.getHistory();
        let totalStudied = 0;
        const types = ['reading', 'writing', 'radical', 'antonym', 'homophone', 'same_kun'];

        gradeKanjiList.forEach(item => {
            const record = history[item.kanji];
            if (record) {
                const hasCorrect = types.some(t => (record[`${t}_correct`] || 0) > 0);
                if (hasCorrect || record.manually_studied) totalStudied++;
            }
        });

        return {
            studied: totalStudied,
            total: gradeKanjiList.length,
            percentage: gradeKanjiList.length > 0 ? Math.round((totalStudied / gradeKanjiList.length) * 100) : 0
        };
    },

    // Get weight for a kanji based on learning history
    // Higher weight = should be studied first (more mistakes)
    getKanjiWeight(kanji) {
        const record = this.getHistory(kanji);
        if (!record) return 1.0;

        const types = ['reading', 'writing', 'radical', 'antonym', 'homophone', 'same_kun'];
        let totalAttempts = 0, totalCorrect = 0;
        for (const t of types) {
            totalAttempts += record[`${t}_attempts`] || 0;
            totalCorrect += record[`${t}_correct`] || 0;
        }

        if (totalAttempts === 0) return 1.0;

        const successRate = totalCorrect / totalAttempts;
        // Weight = 2.0 - successRate (range: 0.0→2.0, 1.0→1.0, 0.5→1.5)
        // More mistakes → higher weight → studied first
        const weight = 2.0 - successRate;
        return Math.max(0.1, Math.min(2.0, weight));
    },

    // Get sorted kanji list by weight (for study mode ordering)
    getWeightedKanjiOrder(gradeKanjiList) {
        return gradeKanjiList
            .map(item => ({ ...item, _weight: this.getKanjiWeight(item.kanji) }))
            .sort((a, b) => b._weight - a._weight);
    },

    // Save quiz session result
    saveQuizSession(grade, mode, config, results) {
        const key = `${STORAGE_PREFIX}sessions`;
        let sessions = this.getJson(key) || [];
        sessions.push({
            id: Date.now(),
            grade, mode, config,
            score: results.score,
            total: results.total,
            wrongKanji: results.wrongKanji || [],
            date: Date.now()
        });
        if (sessions.length > 200) sessions = sessions.slice(-200);
        this.setJson(key, sessions);
    },

    getQuizSessions(grade = null, mode = null) {
        const sessions = this.getJson(`${STORAGE_PREFIX}sessions`) || [];
        return sessions.filter(s =>
            (grade === null || s.grade === grade) &&
            (mode === null || s.mode === mode)
        );
    },

    getSequentialPosition(grade, mode) {
        const positions = this.getJson(`${STORAGE_PREFIX}seqpos`) || {};
        return positions[`${grade}_${mode}`] || 0;
    },

    setSequentialPosition(grade, mode, position) {
        const positions = this.getJson(`${STORAGE_PREFIX}seqpos`) || {};
        positions[`${grade}_${mode}`] = position;
        this.setJson(`${STORAGE_PREFIX}seqpos`, positions);
    },

    getTypeStats(grade, mode, gradeKanjiList) {
        const history = this.getHistory();
        let totalAttempts = 0, totalCorrect = 0, uniqueKanji = 0;
        gradeKanjiList.forEach(item => {
            const record = history[item.kanji];
            if (record) {
                const att = record[`${mode}_attempts`] || 0;
                const cor = record[`${mode}_correct`] || 0;
                if (att > 0) {
                    totalAttempts += att;
                    totalCorrect += cor;
                    uniqueKanji++;
                }
            }
        });
        return {
            attempts: totalAttempts,
            correct: totalCorrect,
            accuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
            uniqueKanji,
            totalKanji: gradeKanjiList.length
        };
    },

    getAskedKanji(mode, gradeKanjiList) {
        const history = this.getHistory();
        return gradeKanjiList.filter(item => {
            const record = history[item.kanji];
            return record && (record[`${mode}_attempts`] || 0) > 0;
        });
    },

    getUnaskedKanji(mode, gradeKanjiList) {
        const history = this.getHistory();
        return gradeKanjiList.filter(item => {
            const record = history[item.kanji];
            return !record || (record[`${mode}_attempts`] || 0) === 0;
        });
    },

    getStudiedKanji(gradeKanjiList) {
        return gradeKanjiList.filter(item => this.isStudied(item.kanji));
    },

    getUnstudiedKanji(gradeKanjiList) {
        return gradeKanjiList.filter(item => !this.isStudied(item.kanji));
    },

    getWrongKanjiForMode(mode, gradeKanjiList) {
        const history = this.getHistory();
        const wrongList = [];
        gradeKanjiList.forEach(item => {
            const record = history[item.kanji];
            if (record) {
                const att = record[`${mode}_attempts`] || 0;
                const cor = record[`${mode}_correct`] || 0;
                if (att > 0 && cor / att < 0.7) {
                    wrongList.push(item);
                }
            }
        });
        return wrongList;
    },

    saveQuizConfig(grade, mode, config) {
        const configs = this.getJson(`${STORAGE_PREFIX}quizconfig`) || {};
        configs[`${grade}_${mode}`] = config;
        this.setJson(`${STORAGE_PREFIX}quizconfig`, configs);
    },

    getQuizConfig(grade, mode) {
        const configs = this.getJson(`${STORAGE_PREFIX}quizconfig`) || {};
        return configs[`${grade}_${mode}`] || { count: 20, method: 'random' };
    },

    // Save Settings
    getSetting(key, defaultValue) {
        const val = localStorage.getItem(`${STORAGE_PREFIX}setting_${key}`);
        return val !== null ? val : defaultValue;
    },

    saveSetting(key, value) {
        localStorage.setItem(`${STORAGE_PREFIX}setting_${key}`, value);
    },

    // Clear everything
    clearAll() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(STORAGE_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    },

    // JSON Helpers
    getJson(key) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.error('Storage parse error:', e);
            return null;
        }
    },

    setJson(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error('Storage save error:', e);
        }
    }
};

