/**
 * build.js
 * 
 * ファイルハッシュで変更を検知し、自動でバージョンを更新するビルドスクリプト。
 * 実行: node build.js
 * 
 * - app.js の APP_VERSION
 * - manifest.json の version
 * - sw.js の CACHE_NAME (kanji-master-vXX)
 * を全て同期して更新する。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

// ハッシュ対象ファイル
const HASH_TARGETS = [
    'index.html',
    'css/style.css',
    'js/app.js',
    'js/data-manager.js',
    'js/canvas.js',
    'js/grader.js',
    'js/quiz.js',
    'js/storage.js',
    'manifest.json',
];

const HASH_STATE_FILE = path.join(ROOT, '.build-hash');
const VERSION_FILE = path.join(ROOT, '.build-version');

// 現在のバージョンを取得
function getCurrentVersion() {
    if (fs.existsSync(VERSION_FILE)) {
        return fs.readFileSync(VERSION_FILE, 'utf8').trim();
    }
    // manifest.json から読む
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    return manifest.version || '1.0.0';
}

// バージョンを bump (patch番号を+1)
function bumpVersion(version) {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0', 10) + 1;
    return `${parts[0]}.${parts[1] || '0'}.${patch}`;
}

// ファイルのハッシュを計算
function hashFiles(files) {
    const hasher = crypto.createHash('sha256');
    files.forEach(file => {
        const filePath = path.join(ROOT, file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath);
            hasher.update(file);
            hasher.update(content);
        }
    });
    return hasher.digest('hex');
}

// app.js の APP_VERSION を更新
function updateAppVersion(version) {
    const filePath = path.join(ROOT, 'js/app.js');
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(
        /export const APP_VERSION = '[^']+';/,
        `export const APP_VERSION = '${version}';`
    );
    fs.writeFileSync(filePath, content);
}

// manifest.json の version を更新
function updateManifestVersion(version) {
    const filePath = path.join(ROOT, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n');
}

// sw.js の CACHE_NAME を更新
function updateSWCacheVersion(version) {
    const filePath = path.join(ROOT, 'sw.js');
    let content = fs.readFileSync(filePath, 'utf8');
    // バージョンからキャッシュ番号を計算 (v2.1.3 -> 213, ただし下2桁はpatch)
    const parts = version.split('.');
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    const patch = parseInt(parts[2] || '0', 10);
    const cacheNum = major * 100 + minor * 10 + patch;
    content = content.replace(
        /const CACHE_NAME = 'kanji-master-v\d+';/,
        `const CACHE_NAME = 'kanji-master-v${cacheNum}';`
    );
    fs.writeFileSync(filePath, content);
}

// メイン処理
function main() {
    const prevHash = fs.existsSync(HASH_STATE_FILE) 
        ? fs.readFileSync(HASH_STATE_FILE, 'utf8').trim() 
        : '';
    
    const currentHash = hashFiles(HASH_TARGETS);
    const currentVersion = getCurrentVersion();

    if (prevHash === currentHash) {
        console.log(`✅ 変更なし (v${currentVersion})`);
        return;
    }

    // 変更あり → バージョンを bump
    const newVersion = bumpVersion(currentVersion);
    
    console.log(`📦 変更を検出しました`);
    console.log(`   ${currentVersion} → ${newVersion}`);
    
    // 各ファイルを更新
    updateAppVersion(newVersion);
    updateManifestVersion(newVersion);
    updateSWCacheVersion(newVersion);
    
    // ハッシュとバージョンを保存
    // 注意: ハッシュは更新後のファイル内容で再計算する（無限ループを防ぐため、
    // バージョン更新後のハッシュを保存）
    const newHash = hashFiles(HASH_TARGETS);
    fs.writeFileSync(HASH_STATE_FILE, newHash);
    fs.writeFileSync(VERSION_FILE, newVersion);
    
    console.log(`✅ バージョン更新完了: v${newVersion}`);
    console.log(`   - js/app.js (APP_VERSION)`);
    console.log(`   - manifest.json (version)`);
    console.log(`   - sw.js (CACHE_NAME)`);
}

main();
