/**
 * js/data-manager.js
 * 
 * Manages Kanji data and KanjiVG SVG data caching using IndexedDB.
 * Supports on-demand loading of higher grades and offline capability.
 */

import { initialKanjiData } from './data.js';

const DB_NAME = 'KanjiMasterDB';
const DB_VERSION = 1;

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
        if (gradeId === 10) {
            // For Grade 10, we always have baseline data.js initial list
            return initialKanjiData;
        }

        // Otherwise read from DB filtered by kentei_grade
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

    // Download grade on-demand from local JSON files
    async downloadGrade(gradeId) {
        console.log(`Loading grade ${gradeId} from local assets...`);
        let filename = '';

        switch (gradeId) {
            case 9: filename = 'grade-2.json'; break;
            case 8: filename = 'grade-3.json'; break;
            case 7: filename = 'grade-4.json'; break;
            case 6: filename = 'grade-5.json'; break;
            case 5: filename = 'grade-6.json'; break;
            case 4: filename = 'grade-8.json'; break;
            case 1.5: filename = 'jinmeiyo.json'; break;
            case 1: filename = 'extra-jis.json'; break;
            default: throw new Error(`Invalid grade: ${gradeId}`);
        }

        try {
            const res = await fetch(`./js/grades/${filename}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const list = await res.json();

            const db = await getDB();
            const tx = db.transaction('kanji', 'readwrite');
            const store = tx.objectStore('kanji');

            // Store all kanji items in IndexedDB with local kentei_grade pointer
            for (const item of list) {
                item.kentei_grade = gradeId;
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

        // 2. Fetch from GitHub KanjiVG repository
        const codePoint = char.charCodeAt(0).toString(16).padStart(5, '0');
        const svgUrl = `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${codePoint}.svg`;

        try {
            const res = await fetch(svgUrl);
            if (!res.ok) throw new Error(`KanjiVG SVG not found: HTTP ${res.status}`);
            const svgText = await res.text();

            // Save to IndexedDB
            const tx = db.transaction('svg', 'readwrite');
            tx.objectStore('svg').put({ kanji: char, svg: svgText });

            return svgText;
        } catch (e) {
            console.warn(`Failed to retrieve KanjiVG SVG for '${char}':`, e);
            return null;
        }
    },

    // Sync is simple local reload
    async syncGrade(gradeId) {
        try {
            await this.downloadGrade(gradeId);
            return true;
        } catch (e) {
            return false;
        }
    }
};
