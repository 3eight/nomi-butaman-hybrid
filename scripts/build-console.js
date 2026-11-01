import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function stripModuleSyntax(code) {
  return code
    // 複数行・単一行の import 文を除去
    .replace(/import\s+(?:\{[\s\S]*?\}|[\w*\s,]+)\s+from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s*['"][^'"]+['"];?/g, '')
    // export 文の除去
    .replace(/^export\s+(?:default\s+)?/gm, '');
}

function buildConsoleBundle() {
  const modelsCode = stripModuleSyntax(fs.readFileSync(path.join(ROOT_DIR, 'src', 'models.js'), 'utf-8'));
  const serviceCalcCode = stripModuleSyntax(fs.readFileSync(path.join(ROOT_DIR, 'src', 'serviceCalculator.js'), 'utf-8'));
  const storeMgrCode = stripModuleSyntax(fs.readFileSync(path.join(ROOT_DIR, 'src', 'storeManager.js'), 'utf-8'));
  const appJsCode = stripModuleSyntax(fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf-8'));

  const bundle = `/**
 * 能美豚饅 統合管理システム - GitHub Pages 自己完結バンドル
 * 生成日時: ${new Date().toISOString()}
 */

// === 1. Models ===
${modelsCode}

// === 2. Service Calculator ===
${serviceCalcCode}

// === 3. Store Manager ===
${storeMgrCode}

// === 4. App Controller ===
${appJsCode}
`;

  // 安全性検証: import/export が残っていないか検査
  const remainingImport = bundle.match(/import\s+[\s\S]*?from/);
  if (remainingImport) {
    throw new Error(`[BUILD ERROR] 残留 import 文が検出されました: ${remainingImport[0]}`);
  }

  const consoleDir = path.join(ROOT_DIR, 'docs', 'console');
  if (!fs.existsSync(consoleDir)) {
    fs.mkdirSync(consoleDir, { recursive: true });
  }

  // バンドル書き出し
  fs.writeFileSync(path.join(consoleDir, 'app.bundle.js'), bundle, 'utf-8');

  // アセットコピー
  fs.copyFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), path.join(consoleDir, 'styles.css'));
  fs.copyFileSync(path.join(ROOT_DIR, 'public', 'icon.svg'), path.join(consoleDir, 'icon.svg'));
  fs.copyFileSync(path.join(ROOT_DIR, 'public', 'manifest.webmanifest'), path.join(consoleDir, 'manifest.webmanifest'));

  // index.html の相対パス調整
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf-8')
    .replace(/\/public\/manifest\.webmanifest/g, 'manifest.webmanifest')
    .replace(/\/public\/icon\.svg/g, 'icon.svg')
    .replace(/\/public\/styles\.css/g, 'styles.css')
    .replace(/\/public\/app\.js/g, 'app.bundle.js');

  fs.writeFileSync(path.join(consoleDir, 'index.html'), indexHtml, 'utf-8');
  console.log('✅ GitHub Pages 用自己完結コンソール (docs/console/) を生成しました');
}

buildConsoleBundle();
