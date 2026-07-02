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
                strokes_attempts: 0,
                strokes_correct: 0,
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

        gradeKanjiList.forEach(item => {
            const record = history[item.kanji];
            if (record) {
                // Calculate failure rate
                const totalAttempts = record.reading_attempts + record.writing_attempts + record.strokes_attempts;
                const totalCorrect = record.reading_correct + record.writing_correct + record.strokes_correct;

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

        gradeKanjiList.forEach(item => {
            const record = history[item.kanji];
            if (record && (record.reading_attempts > 0 || record.writing_attempts > 0 || record.strokes_attempts > 0)) {
                totalStudied++;
            }
        });

        return {
            studied: totalStudied,
            total: gradeKanjiList.length,
            percentage: gradeKanjiList.length > 0 ? Math.round((totalStudied / gradeKanjiList.length) * 100) : 0
        };
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
