// docs/core.js（正本）を gas/Core.gs にコピーする。--check なら差分があれば失敗する。
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'docs', 'core.js');
const dst = path.join(root, 'gas', 'Core.gs');
const banner = '// 自動生成: docs/core.js のコピーです。直接編集せず `npm run sync:gas` を実行してください。\n';
const expected = banner + fs.readFileSync(src, 'utf8');

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : '';
  if (actual !== expected) {
    console.error('gas/Core.gs が docs/core.js と一致しません。`npm run sync:gas` を実行してください。');
    process.exit(1);
  }
  console.log('gas/Core.gs は docs/core.js と一致しています。');
} else {
  fs.writeFileSync(dst, expected);
  console.log('gas/Core.gs を更新しました。');
}
