const CACHE_NAME = 'kanji-master-v222';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/data-manager.js',
    './js/canvas.js',
    './js/grader.js',
    './js/quiz.js',
    './js/storage.js',
    './js/grades/kentei-10.json',
    './manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching app shell');
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate Event
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event
self.addEventListener('fetch', (e) => {
    // Only cache GET requests
    if (e.request.method !== 'GET') return;

    // Skip API requests to kanjiapi.dev or kanjivg - handle those in runtime or data-manager
    const url = new URL(e.request.url);
    if (url.origin.includes('kanjiapi.dev') || url.origin.includes('githubusercontent')) {
        return; // Let the browser handle these normally, data-manager will cache in IndexedDB
    }

    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(e.request).then((networkResponse) => {
                // Cache new static content if it is from our origin
                if (networkResponse && networkResponse.status === 200 && url.origin === location.origin) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Fallback for offline if not found
                console.log('[Service Worker] Fetch failed offline');
            });
        })
    );
});
