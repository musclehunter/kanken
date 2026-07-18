/**
 * js/grader.js
 * 
 * Assess handwritten kanji using:
 * 1. Web Handwriting Recognition API (OS native, best, offline)
 * 2. KanjiVG stroke-matching (offline, works on Android/mobile)
 * 3. Visual Pixel overlap comparison (fallback)
 * 4. Self-assessment (fallback/manual override)
 */

import { dataManager } from './data-manager.js';

let recognizer = null;
let recognizerAttempted = false;

// Initialize Handwriting Recognition API if supported
async function initHandwritingAPI() {
    if (recognizerAttempted) return recognizer;
    recognizerAttempted = true;

    if ('createHandwritingRecognizer' in navigator) {
        try {
            // Query capability for Japanese first
            const status = await navigator.queryHandwritingRecognizer({
                languages: ['ja']
            });

            if (status && status.languages && status.languages.includes('ja')) {
                recognizer = await navigator.createHandwritingRecognizer({
                    languages: ['ja']
                });
                console.log('Handwriting Recognition API initialized successfully for Japanese');
            } else {
                console.log('Handwriting Recognition API does not support Japanese on this system');
            }
        } catch (e) {
            console.warn('Error querying Handwriting Recognition API:', e);
        }
    } else {
        console.log('Handwriting Recognition API not supported in this browser');
    }
    return recognizer;
}

// ---- KanjiVG stroke-matching helpers ----

// Number of points each stroke is resampled to for comparison
const SAMPLE_POINTS = 24;

// Resample a polyline (array of {x,y}) into `n` points evenly spaced by arc length
function resampleStroke(points, n) {
    if (!points || points.length === 0) return [];
    if (points.length === 1) {
        return new Array(n).fill(0).map(() => ({ x: points[0].x, y: points[0].y }));
    }

    // Cumulative arc lengths
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    const total = cum[cum.length - 1];
    if (total === 0) {
        return new Array(n).fill(0).map(() => ({ x: points[0].x, y: points[0].y }));
    }

    const out = [];
    let seg = 0;
    for (let i = 0; i < n; i++) {
        const target = (total * i) / (n - 1);
        while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
        const segLen = cum[seg + 1] - cum[seg];
        const t = segLen === 0 ? 0 : (target - cum[seg]) / segLen;
        out.push({
            x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
            y: points[seg].y + (points[seg + 1].y - points[seg].y) * t
        });
    }
    return out;
}

// Normalize a set of strokes to a unit square (aspect-preserving) based on global bounding box
function normalizeStrokes(strokes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes) {
        for (const p of s) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const scale = Math.max(w, h) || 1;
    // Center the smaller dimension inside the unit square
    const offX = (scale - w) / 2;
    const offY = (scale - h) / 2;
    return strokes.map(s => s.map(p => ({
        x: (p.x - minX + offX) / scale,
        y: (p.y - minY + offY) / scale
    })));
}

// Mean point-to-point Euclidean distance between two equal-length resampled strokes
function meanStrokeDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    }
    return sum / a.length;
}

// Convert a normalized distance into a 0..1 similarity score
function distanceToSimilarity(dist) {
    // In unit-square space, a mean distance of ~0.4 counts as no match
    const sim = 1 - dist / 0.4;
    return Math.max(0, Math.min(1, sim));
}

// Parse a KanjiVG SVG string into reference strokes (array of resampled point arrays)
function parseKanjiVGStrokes(svgText, n) {
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;left:-9999px;top:-9999px;';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    try {
        const pathEls = Array.from(container.querySelectorAll('path'));
        const strokes = [];
        for (const pathEl of pathEls) {
            let len = 0;
            try {
                len = pathEl.getTotalLength();
            } catch (e) {
                continue;
            }
            if (!len || len === 0) continue;
            const pts = [];
            for (let i = 0; i < n; i++) {
                const p = pathEl.getPointAtLength((len * i) / (n - 1));
                pts.push({ x: p.x, y: p.y });
            }
            strokes.push(pts);
        }
        return strokes;
    } finally {
        document.body.removeChild(container);
    }
}

export const grader = {
    // Check what engines are supported. Returns string description
    async detectEngine() {
        const apiObj = await initHandwritingAPI();
        if (apiObj) {
            return 'Handwriting Recognition API (OS内蔵・高精度)';
        }
        return 'KanjiVG字形マッチング (書き順・字形照合)';
    },

    // Main evaluation router
    async grade(canvasInstance, expectedKanji, forceSelfMode = false) {
        if (forceSelfMode) {
            return { mode: 'self', success: null };
        }

        const apiObj = await initHandwritingAPI();
        if (apiObj) {
            return await this.gradeWithAPI(canvasInstance, expectedKanji, apiObj);
        }

        // Try KanjiVG stroke-matching (offline, mobile-friendly)
        try {
            const strokeResult = await this.gradeWithStrokeMatch(canvasInstance, expectedKanji);
            if (strokeResult) {
                return strokeResult;
            }
        } catch (e) {
            console.warn('Stroke matching failed, falling back to pixel match:', e);
        }

        // Last resort: pixel overlap
        return this.gradeWithPixelMatch(canvasInstance, expectedKanji);
    },

    // 1. Chrome Handwriting Recognition API
    async gradeWithAPI(canvasInstance, expectedKanji, activeRecognizer) {
        const rawStrokes = canvasInstance.getStrokesData();
        if (rawStrokes.length === 0) {
            return { success: false, score: 0, feedback: '何も書かれていません', mode: 'api' };
        }

        try {
            // Map strokes into API format: array of objects with points array
            const apiStrokes = rawStrokes.map(stroke => ({
                points: stroke.map(p => ({ x: p.x, y: p.y }))
            }));

            // Get predictions
            const predictions = await activeRecognizer.getPrediction(apiStrokes);

            if (!predictions || predictions.length === 0 || !predictions[0].candidates || predictions[0].candidates.length === 0) {
                return { success: false, score: 0, feedback: '認識できませんでした', mode: 'api' };
            }

            const candidates = predictions[0].candidates;
            console.log('Recognized candidates:', candidates);

            // Check if correct kanji is in top 3 candidates to be forgivable of small variations
            const foundIndex = candidates.slice(0, 3).indexOf(expectedKanji);
            if (foundIndex !== -1) {
                // High matching score
                const score = Math.max(100 - (foundIndex * 15), 70); // 100% for 1st, 85% for 2nd, 70% for 3rd
                return {
                    success: true,
                    score: score,
                    feedback: `正解！ (${candidates[0]} と認識しました)`,
                    mode: 'api'
                };
            } else {
                return {
                    success: false,
                    score: 10,
                    feedback: `不一致 (認識結果: ${candidates.slice(0, 3).join(', ')})`,
                    mode: 'api'
                };
            }
        } catch (e) {
            console.error('Handwriting API grading failed, falling back to pixel match:', e);
            return this.gradeWithPixelMatch(canvasInstance, expectedKanji);
        }
    },

    // 2. KanjiVG stroke-matching (offline, mobile-friendly)
    // Returns null when no reference SVG is available so caller can fall back.
    async gradeWithStrokeMatch(canvasInstance, expectedKanji) {
        const rawStrokes = canvasInstance.getStrokesData();
        if (!rawStrokes || rawStrokes.length === 0) {
            return { success: false, score: 0, feedback: '何も書かれていません', mode: 'stroke' };
        }

        const svgText = await dataManager.getKanjiSVG(expectedKanji);
        if (!svgText) {
            return null; // No reference available -> fall back to pixel match
        }

        const refRaw = parseKanjiVGStrokes(svgText, SAMPLE_POINTS);
        if (!refRaw || refRaw.length === 0) {
            return null;
        }

        // Resample user strokes, then normalize both sets to a shared unit square
        const userResampled = rawStrokes.map(s => resampleStroke(s, SAMPLE_POINTS));
        const userNorm = normalizeStrokes(userResampled);
        const refNorm = normalizeStrokes(refRaw);

        // Greedy best-match assignment (order-tolerant, direction-tolerant).
        // Dividing by the larger stroke count penalizes missing/extra strokes.
        const used = new Array(refNorm.length).fill(false);
        const maxCount = Math.max(userNorm.length, refNorm.length);
        let simSum = 0;

        for (const uStroke of userNorm) {
            let bestSim = 0;
            let bestIdx = -1;
            for (let j = 0; j < refNorm.length; j++) {
                if (used[j]) continue;
                const rStroke = refNorm[j];
                const rReversed = rStroke.slice().reverse();
                const d = Math.min(
                    meanStrokeDistance(uStroke, rStroke),
                    meanStrokeDistance(uStroke, rReversed)
                );
                const sim = distanceToSimilarity(d);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIdx = j;
                }
            }
            if (bestIdx !== -1) {
                used[bestIdx] = true;
                simSum += bestSim;
            }
        }

        const shapeScore = simSum / maxCount; // 0..1
        let score = Math.round(shapeScore * 100);
        score = Math.max(0, Math.min(100, score));

        const isCorrect = score >= 55;
        const strokeDiff = userNorm.length - refNorm.length;

        let feedback;
        if (isCorrect) {
            feedback = `正解！ 字形が一致しています (${score}%)`;
        } else if (strokeDiff !== 0) {
            feedback = `字形が不一致 (${score}%) 画数: あなた${userNorm.length}画 / 正解${refNorm.length}画`;
        } else {
            feedback = `字形が不一致 (${score}%) 形をもう一度確認しましょう`;
        }

        return { success: isCorrect, score, feedback, mode: 'stroke' };
    },

    // 3. Pixel Match Fallback
    gradeWithPixelMatch(canvasInstance, expectedKanji) {
        const userImgData = canvasInstance.getImageData();
        const width = userImgData.width;
        const height = userImgData.height;

        // Create hidden canvas to draw reference character
        const refCanvas = document.createElement('canvas');
        refCanvas.width = width;
        refCanvas.height = height;
        const refCtx = refCanvas.getContext('2d', { willReadFrequently: true });

        // Clear and set brush parameters
        refCtx.fillStyle = '#000000';
        refCtx.fillRect(0, 0, width, height);

        // Draw reference character in white
        refCtx.fillStyle = '#ffffff';
        refCtx.textAlign = 'center';
        refCtx.textBaseline = 'middle';

        // Make text large but ensure it fits
        refCtx.font = `bold ${Math.round(width * 0.55)}px "Noto Serif JP", serif`;
        refCtx.fillText(expectedKanji, width / 2, height / 2);

        const refImgData = refCtx.getImageData(0, 0, width, height);

        // User image check (contains transparent backdrop. Pixels written are solid colors)
        // Counts:
        let matchCount = 0;
        let refPixelCount = 0;
        let userPixelCount = 0;
        let falsePositiveCount = 0;

        const refPixels = refImgData.data;
        const userPixels = userImgData.data;

        // Scan pixels
        for (let i = 0; i < refPixels.length; i += 4) {
            // ref is white (255) vs black (0)
            const isRefSolid = refPixels[i] > 128; // R channel of ref
            // user is drawn if alpha is high
            const isUserSolid = userPixels[i + 3] > 50; // Alpha channel of user

            if (isRefSolid) {
                refPixelCount++;
                if (isUserSolid) {
                    matchCount++;
                }
            }

            if (isUserSolid) {
                userPixelCount++;
                if (!isRefSolid) {
                    falsePositiveCount++;
                }
            }
        }

        if (userPixelCount === 0) {
            return { success: false, score: 0, feedback: '何も書かれていません', mode: 'pixel' };
        }

        // Calculate match metrics
        // Overlap fraction: sensitivity (how much user covered the reference)
        const coverage = refPixelCount > 0 ? matchCount / refPixelCount : 0;
        // Penalty fraction: how much user drew outside the lines
        const noise = refPixelCount > 0 ? falsePositiveCount / refPixelCount : 0;

        // Composite score
        let score = Math.round((coverage - noise * 0.15) * 100);
        score = Math.max(0, Math.min(100, score));

        // Threshold: standard is a bit forgiving (e.g. 50% match score is usually okay)
        const isCorrect = score >= 45;

        return {
            success: isCorrect,
            score: score,
            feedback: isCorrect ? 'よく描けています！' : 'なぞられたピクセルが少ない、またはハミ出しすぎです',
            mode: 'pixel'
        };
    }
};
