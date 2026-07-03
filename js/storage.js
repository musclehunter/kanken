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

    // Check if a kanji is studied (either manually or via quiz)
    isStudied(kanji) {
        const record = this.getHistory(kanji);
        if (!record) return false;
        if (record.manually_studied) return true;
        const types = ['reading', 'writing', 'radical', 'antonym', 'homophone', 'same_kun'];
        return types.some(t => (record[`${t}_attempts`] || 0) > 0);
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
                const hasAttempts = types.some(t => (record[`${t}_attempts`] || 0) > 0);
                if (hasAttempts || record.manually_studied) totalStudied++;
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

