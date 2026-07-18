/**
 * js/canvas.js
 * 
 * Manages drawing on HTML5 Canvas for both mouse and touch devices.
 * Tracks drawing strokes as a series of coordinates for the recognition engine.
 */

export class HandwritingCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentStroke = [];
        this.strokes = []; // Stores all completed strokes: [ [ {x, y, t}, ... ], ... ]

        this.setupBrush();
        this.setupEvents();
        this.resize();
    }

    setupBrush() {
        this.ctx.strokeStyle = '#f3f4f6'; // Light gray/white text color
        this.ctx.lineWidth = 10;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    setupEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e.clientX, e.clientY));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e.clientX, e.clientY));
        window.addEventListener('mouseup', () => this.stopDrawing());

        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];
                // Prevent scrolling while drawing
                e.preventDefault();
                this.startDrawing(touch.clientX, touch.clientY);
            }
        });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];
                e.preventDefault();
                this.draw(touch.clientX, touch.clientY);
            }
        });

        this.canvas.addEventListener('touchend', () => this.stopDrawing());
    }

    resize() {
        // Enforce 300x300 canvas backing store to match CSS dimensions
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width || 300;
        this.canvas.height = rect.height || 300;

        // Re-initialize brush state since resizing clears the canvas context
        this.setupBrush();
        this.clear();
    }

    getPointerPos(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
            t: Date.now() // Timestamp (useful for handwriting API query)
        };
    }

    startDrawing(clientX, clientY) {
        this.isDrawing = true;
        const pos = this.getPointerPos(clientX, clientY);

        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);

        this.currentStroke = [pos];
    }

    draw(clientX, clientY) {
        if (!this.isDrawing) return;

        const pos = this.getPointerPos(clientX, clientY);

        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.stroke();

        this.currentStroke.push(pos);
    }

    stopDrawing() {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.currentStroke.length > 0) {
            this.strokes.push(this.currentStroke);
            this.currentStroke = [];
        }
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.strokes = [];
        this.currentStroke = [];
    }

    // Get drawing strokes in a format compatible with Handwriting Recognition API
    getStrokesData() {
        return this.strokes.map(stroke =>
            stroke.map(pt => ({ x: pt.x, y: pt.y }))
        );
    }

    // Get raw imageData for pixel compare
    getImageData() {
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
}
