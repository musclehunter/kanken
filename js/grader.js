/**
 * js/grader.js
 * 
 * Assess handwritten kanji using:
 * 1. Web Handwriting Recognition API (OS native, best, offline)
 * 2. Visual Pixel overlap comparison (fallback)
 * 3. Self-assessment (fallback/manual override)
 */

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

export const grader = {
    // Check what engines are supported. Returns string description
    async detectEngine() {
        const apiObj = await initHandwritingAPI();
        if (apiObj) {
            return 'Handwriting Recognition API (OS内蔵・高精度)';
        }
        return 'ピクセルマッチング判定 (簡易判定)';
    },

    // Main evaluation router
    async grade(canvasInstance, expectedKanji, forceSelfMode = false) {
        if (forceSelfMode) {
            return { mode: 'self', success: null };
        }

        const apiObj = await initHandwritingAPI();
        if (apiObj) {
            return await this.gradeWithAPI(canvasInstance, expectedKanji, apiObj);
        } else {
            return this.gradeWithPixelMatch(canvasInstance, expectedKanji);
        }
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

    // 2. Pixel Match Fallback
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
