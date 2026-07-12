/**
 * js/data-manager.js
 * 
 * Manages Kanji data and KanjiVG SVG data caching using IndexedDB.
 * Supports on-demand loading of higher grades and offline capability.
 */

const DB_NAME = 'KanjiMasterDB';
const DB_VERSION = 1;

// GitHub Pages remote sync URL
const REMOTE_URL_BASE = 'https://musclehunter.github.io/kanken/';

let dbPromise = null;

// Initialize IndexedDB
function getDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('kanji')) {
                db.createObjectStore('kanji', { keyPath: 'kanji' });
            }
            if (!db.objectStoreNames.contains('svg')) {
                db.createObjectStore('svg', { keyPath: 'kanji' });
            }
        };

        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });

    return dbPromise;
}

export const dataManager = {
    // Get Kanji list for a specific grade
    async getKanjiList(gradeId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('kanji', 'readonly');
            const store = transaction.objectStore('kanji');
            const request = store.getAll();

            request.onsuccess = () => {
                const allKanji = request.result;
                resolve(allKanji.filter(k => k.kentei_grade === gradeId));
            };

            request.onerror = () => reject(request.error);
        });
    },

    // Get word relations (antonyms, synonyms, same_kun) from cache or local file
    async getWordRelations() {
        const db = await getDB();
        const cached = await new Promise((resolve) => {
            const tx = db.transaction('kanji', 'readonly');
            const store = tx.objectStore('kanji');
            const req = store.get('__word_relations__');
            req.onsuccess = () => resolve(req.result ? req.result.data : null);
            req.onerror = () => resolve(null);
        });
        if (cached) return cached;

        try {
            const res = await fetch('./js/grades/word-relations.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const tx = db.transaction('kanji', 'readwrite');
            tx.objectStore('kanji').put({ kanji: '__word_relations__', data });
            return data;
        } catch (e) {
            console.error('Failed to load word-relations.json:', e);
            return { antonyms: [], synonyms: [], same_kun: [] };
        }
    },

    // Load examples for a grade (best-effort; falls back to embedded examples)
    async loadExamples(gradeId) {
        try {
            const res = await fetch(`./js/grades/examples-${gradeId}.json`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.examples || null;
        } catch (e) {
            console.warn(`No separate examples file for grade ${gradeId}:`, e.message);
            return null;
        }
    },

    // Merge examples into kanji list
    mergeExamples(list, examples) {
        if (!examples) return list;
        return list.map(item => {
            const ex = examples[item.kanji];
            if (ex) {
                return { ...item, examples: ex };
            }
            return item;
        });
    },

    // Download grade on-demand from local JSON files
    async downloadGrade(gradeId) {
        console.log(`Loading grade ${gradeId} from local assets...`);
        const filename = `kentei-${gradeId}.json`;

        try {
            const [res, examples] = await Promise.all([
                fetch(`./js/grades/${filename}`),
                this.loadExamples(gradeId)
            ]);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let list = await res.json();
            list = this.mergeExamples(list, examples);

            const db = await getDB();
            const tx = db.transaction('kanji', 'readwrite');
            const store = tx.objectStore('kanji');

            // Clear old entries for this grade before inserting new data
            const allReq = store.getAll();
            await new Promise((resolve, reject) => {
                allReq.onsuccess = () => {
                    const oldEntries = allReq.result || [];
                    for (const entry of oldEntries) {
                        if (entry.kentei_grade === gradeId && entry.kanji !== '__word_relations__') {
                            store.delete(entry.kanji);
                        }
                    }
                    resolve();
                };
                allReq.onerror = () => reject(allReq.error);
            });

            for (const item of list) {
                store.put(item);
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            return list;
        } catch (e) {
            console.error(`Error loading Grade ${gradeId} from local json:`, e);
            throw e;
        }
    },

    // Get KanjiVG SVG string for stroke rendering
    async getKanjiSVG(char) {
        const db = await getDB();

        // 1. Try to read from db first
        const cached = await new Promise((resolve) => {
            const tx = db.transaction('svg', 'readonly');
            const store = tx.objectStore('svg');
            const req = store.get(char);
            req.onsuccess = () => resolve(req.result ? req.result.svg : null);
            req.onerror = () => resolve(null);
        });

        if (cached) {
            return cached;
        }

        // 2. Fetch KanjiVG SVG.
        //    Prefer the bundled local copy (same-origin, offline), then remote CDN/raw.
        const codePoint = char.codePointAt(0).toString(16).padStart(5, '0');
        const sources = [
            `./kanjivg/${codePoint}.svg`,
            `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/${codePoint}.svg`,
            `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${codePoint}.svg`
        ];

        for (const svgUrl of sources) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 6000);
                let svgText;
                try {
                    const res = await fetch(svgUrl, { signal: controller.signal });
                    if (!res.ok) throw new Error(`KanjiVG SVG not found: HTTP ${res.status}`);
                    svgText = await res.text();
                } finally {
                    clearTimeout(timer);
                }

                // Save to IndexedDB
                const tx = db.transaction('svg', 'readwrite');
                tx.objectStore('svg').put({ kanji: char, svg: svgText });

                return svgText;
            } catch (e) {
                console.warn(`Failed to retrieve KanjiVG SVG for '${char}' from ${svgUrl}:`, e);
                // Try next source
            }
        }

        return null;
    },

    // Sync from remote GitHub Pages repository, fallback to local bundle
    async syncGrade(gradeId) {
        const filename = `kentei-${gradeId}.json`;
        const remoteUrl = `${REMOTE_URL_BASE}js/grades/${filename}?t=${Date.now()}`;
        const remoteExamplesUrl = `${REMOTE_URL_BASE}js/grades/examples-${gradeId}.json?t=${Date.now()}`;
        try {
            console.log(`Syncing Grade ${gradeId} from remote: ${remoteUrl}`);
            const res = await fetch(remoteUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let list = await res.json();

            // Try to sync examples file as well
            try {
                const exRes = await fetch(remoteExamplesUrl);
                if (exRes.ok) {
                    const exData = await exRes.json();
                    list = this.mergeExamples(list, exData.examples || null);
                }
            } catch (exError) {
                console.warn(`Examples remote sync failed for grade ${gradeId}:`, exError);
            }

            const db = await getDB();
            const tx = db.transaction('kanji', 'readwrite');
            const store = tx.objectStore('kanji');

            // Clear old entries for this grade before inserting new ones
            const allReq = store.getAll();
            await new Promise((resolve, reject) => {
                allReq.onsuccess = () => {
                    const oldEntries = allReq.result || [];
                    for (const entry of oldEntries) {
                        if (entry.kentei_grade === gradeId && entry.kanji !== '__word_relations__') {
                            store.delete(entry.kanji);
                        }
                    }
                    resolve();
                };
                allReq.onerror = () => reject(allReq.error);
            });

            for (const item of list) {
                store.put(item);
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            // Also attempt to sync word relations
            try {
                const relRes = await fetch(`${REMOTE_URL_BASE}js/grades/word-relations.json?t=${Date.now()}`);
                if (relRes.ok) {
                    const data = await relRes.json();
                    const tx2 = db.transaction('kanji', 'readwrite');
                    tx2.objectStore('kanji').put({ kanji: '__word_relations__', data });
                    await new Promise((resolve, reject) => {
                        tx2.oncomplete = () => resolve();
                        tx2.onerror = () => reject(tx2.error);
                    });
                }
            } catch (relError) {
                console.warn('Word relations remote sync failed, keeping local/cached version', relError);
            }

            return true;
        } catch (e) {
            console.warn(`Failed online sync, falling back to local files:`, e);
            try {
                await this.downloadGrade(gradeId);
                return true;
            } catch (localErr) {
                console.error('Local fallback sync also failed:', localErr);
                return false;
            }
        }
    }
};
