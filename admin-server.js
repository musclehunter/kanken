/**
 * admin-server.js
 *
 * ローカル専用のデータ管理サーバー。
 * 漢字データ、例文、word-relations などを一覧・編集・追加・削除できる管理画面を提供する。
 *
 * 使い方:
 *   node admin-server.js
 *   ブラウザで http://localhost:3456 を開く
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parse } = require('url');

const PORT = process.env.ADMIN_PORT || 3456;
const ROOT = __dirname;
const ADMIN_DIR = path.join(ROOT, 'admin');
const GRADES_DIR = path.join(ROOT, 'js', 'grades');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

function sendJSON(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : null);
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function getGradePath(grade) {
    return path.join(GRADES_DIR, `kentei-${grade}.json`);
}

function safePath(base, target) {
    const resolved = path.resolve(path.join(base, target));
    return resolved.startsWith(path.resolve(base)) ? resolved : null;
}

const server = http.createServer(async (req, res) => {
    const parsed = parse(req.url, true);
    const pathname = parsed.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
        try {
            if (pathname === '/api/grades' && req.method === 'GET') {
                const files = fs.readdirSync(GRADES_DIR)
                    .filter(f => f.match(/^kentei-(\d+(?:\.5)?)\.json$/))
                    .map(f => {
                        const m = f.match(/^kentei-(\d+(?:\.5)?)\.json$/);
                        return { grade: parseFloat(m[1]), filename: f };
                    })
                    .sort((a, b) => a.grade - b.grade);
                return sendJSON(res, 200, files);
            }

            const gradeMatch = pathname.match(/^\/api\/grade\/(.+)$/);
            if (gradeMatch) {
                const grade = decodeURIComponent(gradeMatch[1]);
                const file = getGradePath(grade);
                if (!fs.existsSync(file)) {
                    return sendJSON(res, 404, { error: `ファイルが見つかりません: ${file}` });
                }
                if (req.method === 'GET') {
                    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                    return sendJSON(res, 200, data);
                }
                if (req.method === 'PUT') {
                    const body = await readBody(req);
                    fs.writeFileSync(file, JSON.stringify(body, null, 2));
                    return sendJSON(res, 200, { success: true });
                }
            }

            if (pathname === '/api/word-relations' && req.method === 'GET') {
                const file = path.join(GRADES_DIR, 'word-relations.json');
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                return sendJSON(res, 200, data);
            }
            if (pathname === '/api/word-relations' && req.method === 'PUT') {
                const body = await readBody(req);
                const file = path.join(GRADES_DIR, 'word-relations.json');
                fs.writeFileSync(file, JSON.stringify(body, null, 2));
                return sendJSON(res, 200, { success: true });
            }

            if (pathname === '/api/audit' && req.method === 'GET') {
                const gradeParam = parsed.query.grade;
                const targetGrades = gradeParam ? gradeParam.split(',').map(Number).filter(g => !isNaN(g)) : null;
                console.log(`[audit] targetGrades=${targetGrades ? targetGrades.join(',') : 'all'}, raw=${parsed.query.grade}`);
                const issues = runAudit(targetGrades);
                console.log(`[audit] returned ${issues.length} issues`);
                return sendJSON(res, 200, issues);
            }

            if (pathname === '/api/examples' && req.method === 'GET') {
                const gradeParam = parsed.query.grade;
                const targetGrades = gradeParam ? gradeParam.split(',').map(Number).filter(g => !isNaN(g)) : null;
                const filter = parsed.query.filter || 'all'; // all, long, too_long, inappropriate
                const examples = getExamples(targetGrades, filter);
                return sendJSON(res, 200, examples);
            }

            return sendJSON(res, 404, { error: 'API endpoint not found' });
        } catch (e) {
            console.error('API error:', e);
            return sendJSON(res, 500, { error: e.message });
        }
    }

    // Static files under /admin
    const targetPath = pathname === '/' ? '/admin/index.html' : pathname;
    let filePath = safePath(ROOT, targetPath);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = safePath(ROOT, '/admin/index.html');
    }
    if (!filePath) {
        return sendJSON(res, 404, { error: 'Not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
});

const INAPPROPRIATE_KEYWORDS = [
    ' sex', 'sexual', 'セックス', 'エッチ', 'h', 'セクハラ', '猥褻', '淫乱', '痴漢', '性的',
    'レイプ', '強姦', '陵辱', '猥談', '下半身', '性的暴行',
    '死', '殺', '自殺', '死体', '遺体', '死骸', '自害', '心中',
    '差別', '人種差別', 'ヘイト', 'ナチ', 'ホロコースト',
    '暴力', '暴行', '殴', '殺害', '犯罪', '盗', '窃盗', '強盗', '薬物',
    '麻薬', '覚醒剤', 'コカイン', '大麻', 'ヘロイン',
    '自傷', '傷つける', '自虐', '切り傷', '流血',
    'トラウマ', '虐待', '児童虐待', '性的虐待'
];

function countChars(str) {
    return (str || '').replace(/[\s\n\r\t、。！？「」『』（）［］【】・･,\.!?\[\]\(\)\{\}"']/g, '').length;
}

function checkInappropriate(sentence) {
    const found = INAPPROPRIATE_KEYWORDS.filter(kw => sentence.includes(kw));
    return found;
}

function getExamples(targetGrades = null, filter = 'all') {
    const examples = [];
    const allGrades = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10];
    const grades = Array.isArray(targetGrades) && targetGrades.length > 0
        ? targetGrades
        : allGrades;
    const maxLen = 15;
    const strictMax = 20;

    for (const grade of grades) {
        const file = getGradePath(grade);
        if (!fs.existsSync(file)) continue;
        const list = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const item of list) {
            if (!item.examples) continue;
            for (let w = 0; w < item.examples.length; w++) {
                const ex = item.examples[w];
                if (!ex.sentences || ex.sentences.length === 0) {
                    if (filter === 'all') {
                        examples.push({
                            grade,
                            kanji: item.kanji,
                            wordIndex: w,
                            word: ex.word,
                            reading: ex.reading || '',
                            sentenceId: null,
                            sentence: '',
                            len: 0,
                            type: 'empty'
                        });
                    }
                    continue;
                }
                for (const sentObj of ex.sentences) {
                    // { id, text } 形式と旧来の文字列形式の両方を許容
                    const sentenceId = sentObj && typeof sentObj === 'object' ? sentObj.id : null;
                    const sentenceText = sentObj && typeof sentObj === 'object' ? sentObj.text : String(sentObj);
                    const len = countChars(sentenceText);
                    const bad = checkInappropriate(sentenceText);
                    const type = len > strictMax ? 'too_long' : (len > maxLen ? 'long' : (bad.length > 0 ? 'inappropriate' : 'ok'));

                    if (filter === 'all' ||
                        (filter === 'long' && (type === 'long' || type === 'too_long')) ||
                        (filter === 'too_long' && type === 'too_long') ||
                        (filter === 'inappropriate' && type === 'inappropriate') ||
                        (filter === 'empty' && type === 'empty')) {
                        examples.push({
                            grade,
                            kanji: item.kanji,
                            wordIndex: w,
                            word: ex.word,
                            reading: ex.reading || '',
                            sentenceId,
                            sentence: sentenceText,
                            len,
                            type,
                            keywords: bad.length > 0 ? bad : undefined
                        });
                    }
                }
            }
        }
    }
    return examples;
}

function runAudit(targetGrades = null) {
    return getExamples(targetGrades, 'all').filter(ex => ex.type !== 'ok' && ex.type !== 'empty').map(ex => {
        const { reading, keywords, ...rest } = ex;
        return keywords ? { ...rest, keywords } : rest;
    });
}

server.listen(PORT, () => {
    console.log(`🚀 管理サーバーを起動しました: http://localhost:${PORT}`);
    console.log(`   データディレクトリ: ${GRADES_DIR}`);
});
