'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const DAY = 86400000;

/* ---- Apps Script サービスのモック ---- */
function createSheet(name) {
  const rows = [];
  const formats = [];
  const sheet = {
    name, rows, formats, frozen: 0,
    getLastRow: () => rows.length,
    getMaxRows: () => Math.max(1000, rows.length),
    setFrozenRows: n => { sheet.frozen = n; },
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues(values) {
        assert.equal(values.length, nr, '行数が一致しない');
        values.forEach((v, i) => {
          assert.equal(v.length, nc, '列数が一致しない');
          const row = rows[r - 1 + i] || (rows[r - 1 + i] = []);
          v.forEach((cell, j) => { row[c - 1 + j] = cell; });
        });
        return this;
      },
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = rows[r - 1 + i] || [];
          const o = [];
          for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(o);
        }
        return out;
      },
      clearContent() {
        for (let i = 0; i < nr; i++) {
          const row = rows[r - 1 + i];
          if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
        }
        return this;
      },
      setNumberFormat(f) { formats.push({ r, c, nr, nc, f }); return this; }
    })
  };
  return sheet;
}

function createEnv({ props = {}, lockAvailable = true } = {}) {
  const sheets = {};
  const cache = new Map();
  const lockStats = { tries: 0, releases: 0, timeouts: [] };
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = createSheet(n))
  };
  const ctx = {
    console, JSON, Date, Math, Object, Array, String, Number, isNaN, parseInt, isFinite, Error,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {} },
    LockService: {
      getScriptLock: () => ({
        tryLock: ms => { lockStats.tries++; lockStats.timeouts.push(ms); return env.lockAvailable; },
        releaseLock: () => { lockStats.releases++; }
      })
    },
    CacheService: {
      getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: content => ({ content, mime: null, setMimeType(m) { this.mime = m; return this; } })
    }
  };
  const env = { ctx, sheets, cache, lockStats, lockAvailable };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, 'Core.gs'), 'utf8'), ctx, { filename: 'Core.gs' });
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  env.post = body => {
    const out = ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
    assert.equal(out.mime, 'application/json');
    return JSON.parse(out.content);
  };
  return env;
}

let seq = 0;
function delivery(overrides = {}) {
  seq++;
  return {
    id: 'test-' + String(seq).padStart(6, '0'),
    occurredAt: new Date(Date.now() - 60000).toISOString(),
    productId: 'butaman', productName: '豚饅', quantity: 3, method: '店頭', deviceId: 'dev-1',
    ...overrides
  };
}

test('ping は ok を返す（doGet / doPost）', () => {
  const env = createEnv();
  assert.equal(env.post({ command: 'ping' }).ok, true);
  const g = JSON.parse(env.ctx.doGet({ parameter: {} }).content);
  assert.equal(g.ok, true);
  assert.equal(g.command, 'ping');
});

test('recordDelivery: シートに1行追記し、曜日・時間帯を保存する', () => {
  const env = createEnv();
  const d = delivery();
  const res = env.post({ command: 'recordDelivery', payload: { record: d } });
  assert.equal(res.ok, true);
  assert.equal(res.duplicate, false);
  const sheet = env.sheets['受渡記録'];
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0][0], '記録ID');
  assert.equal(sheet.frozen, 1);
  const row = sheet.rows[1];
  assert.equal(row[0], d.id);
  assert.equal(row[1], d.occurredAt);
  assert.match(row[3], /^[日月火水木金土]$/);
  assert.match(row[5], /^\d\d:\d\d-\d\d:\d\d$/);
  assert.equal(row[6], 'butaman');
  assert.equal(row[8], 3);
  assert.equal(row[9], '店頭');
  assert.ok(sheet.formats.some(f => f.f === '@'), '日付・時刻列はテキスト書式');
  assert.equal(env.lockStats.tries, 1);
  assert.equal(env.lockStats.releases, 1);
});

test('重複防止: 同じ記録IDの再送は追記しない（キャッシュ・シートの両方で判定）', () => {
  const env = createEnv();
  const d = delivery();
  env.post({ command: 'recordDelivery', payload: { record: d } });
  const again = env.post({ command: 'recordDelivery', payload: { record: d } });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(env.sheets['受渡記録'].rows.length, 2);

  // キャッシュが消えてもシート上のIDで重複を検出できる
  env.cache.clear();
  const third = env.post({ command: 'recordDeliveries', payload: { records: [d] } });
  assert.equal(third.results[0].duplicate, true);
  assert.equal(third.saved, 0);
  assert.equal(env.sheets['受渡記録'].rows.length, 2);
});

test('重複防止: 1回の一括送信内に同じIDがあっても1行だけ', () => {
  const env = createEnv();
  const d = delivery();
  const res = env.post({ command: 'recordDeliveries', payload: { records: [d, d, delivery()] } });
  assert.equal(res.saved, 2);
  assert.deepEqual(res.results.map(r => r.duplicate), [false, true, false]);
  assert.equal(env.sheets['受渡記録'].rows.length, 3);
});

test('LockService: ロックを取れなければ書き込まず再送可能エラーを返す', () => {
  const env = createEnv();
  env.lockAvailable = false;
  const res = env.post({ command: 'recordDelivery', payload: { record: delivery() } });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'busy');
  assert.equal(res.retryable, true);
  assert.equal(env.sheets['受渡記録'], undefined);
  assert.equal(env.lockStats.timeouts[0], 10000);
});

test('LockService: 処理中に例外が出てもロックを解放する', () => {
  const env = createEnv();
  env.ctx.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('シートが開けません'); };
  const res = env.post({ command: 'recordDelivery', payload: { record: delivery() } });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'server_error');
  assert.equal(res.retryable, true);
  assert.equal(env.lockStats.tries, 1);
  assert.equal(env.lockStats.releases, 1);
});

test('検証: 不正な記録は保存せず個別エラーを返す', () => {
  const env = createEnv();
  const res = env.post({ command: 'recordDeliveries', payload: { records: [delivery({ quantity: -1 }), delivery()] } });
  assert.equal(res.ok, true);
  assert.equal(res.saved, 1);
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].error, /数量/);
  const single = env.post({ command: 'recordDelivery', payload: { record: delivery({ occurredAt: new Date(Date.now() + 3600000).toISOString() }) } });
  assert.equal(single.ok, false);
  assert.equal(single.code, 'invalid');
  assert.equal(env.post({ command: 'recordDeliveries', payload: { records: [] } }).ok, false);
  const tooMany = Array.from({ length: 51 }, () => delivery());
  assert.equal(env.post({ command: 'recordDeliveries', payload: { records: tooMany } }).code, 'invalid');
});

test('数式インジェクション対策: = で始まる文字列はテキスト化して保存', () => {
  const env = createEnv();
  env.post({ command: 'recordDelivery', payload: { record: delivery({ productName: '=HYPERLINK("x")', method: '+店頭' }) } });
  const row = env.sheets['受渡記録'].rows[1];
  assert.equal(row[7], '\'=HYPERLINK("x")');
  assert.equal(row[9], "'+店頭");
});

test('コマンド: 未対応・JSON不正・共有キー不一致を拒否する', () => {
  const env = createEnv({ props: { SHARED_KEY: 'secret' } });
  assert.equal(env.post({ command: 'deleteAll', key: 'secret' }).code, 'unknown_command');
  assert.equal(env.post('{not json').code, 'bad_json');
  assert.equal(env.post({ command: 'ping', key: 'wrong' }).code, 'unauthorized');
  assert.equal(env.post({ command: 'ping', key: 'secret' }).ok, true);
});

test('listDeliveries / getForecast: 3週分の同曜日・時間帯実績で40分後の目安を返す', () => {
  const env = createEnv();
  const now = Date.now();
  const target = now + 40 * 60000;
  const recs = [7, 14, 21].map((w, i) => delivery({ occurredAt: new Date(target - w * DAY).toISOString(), quantity: 4 + i }));
  env.post({ command: 'recordDeliveries', payload: { records: recs.slice(0, 2) } });

  const learning = env.post({ command: 'getForecast', payload: { now: new Date(now).toISOString() } });
  assert.equal(learning.forecast.status, 'learning');
  assert.equal(learning.forecast.needed, 1);

  env.post({ command: 'recordDeliveries', payload: { records: recs.slice(2) } });
  const ready = env.post({ command: 'getForecast', payload: { now: new Date(now).toISOString() } });
  assert.equal(ready.forecast.status, 'ready');
  assert.equal(ready.forecast.total, 5); // (4+5+6)/3 = 5

  const list = env.post({ command: 'listDeliveries', payload: { sinceDays: 30 } });
  assert.equal(list.records.length, 3);
  assert.equal(list.records[0].productName, '豚饅');
  assert.equal(env.post({ command: 'listDeliveries', payload: { sinceDays: 10 } }).records.length, 1);
});

test('rebuildKnowledge: 販売ナレッジシートを作り直す', () => {
  const env = createEnv();
  env.post({ command: 'recordDeliveries', payload: { records: [delivery(), delivery({ productId: 'anman', productName: 'あんまん' })] } });
  const res = env.post({ command: 'rebuildKnowledge' });
  assert.equal(res.ok, true);
  assert.equal(res.rows, 2);
  const k = env.sheets['販売ナレッジ'];
  assert.equal(k.rows[0][0], '曜日');
  assert.equal(k.rows.length, 3);
  assert.equal(k.rows[1][7], '学習中');
  // 再実行しても行が増え続けない
  env.post({ command: 'rebuildKnowledge' });
  assert.equal(k.rows.length, 3);
});

test('setup: シートを作成し、ナレッジ再集計トリガーを重複なく登録する', () => {
  const env = createEnv();
  const triggers = [];
  env.ctx.ScriptApp = {
    getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })),
    newTrigger: h => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => triggers.push(h) }) }) }) })
  };
  assert.equal(env.ctx.setup(), 'セットアップ完了');
  env.ctx.setup();
  assert.deepEqual(triggers, ['rebuildKnowledgeTrigger']);
  assert.equal(env.sheets['受渡記録'].rows[0][0], '記録ID');
  assert.equal(env.sheets['販売ナレッジ'].rows[0][0], '曜日');
});

test('appendOps / listOps: 操作ログを追記し、出店日で取り出す（重複防止・ロック）', () => {
  const env = createEnv();
  const now = new Date();
  const mk = (id, type, payload) => ({ id, type, payload, at: now.toISOString(), device: 'dev-1' });
  const ops = [mk('opaaaaaaaa1', 'batch_start', { batchId: 'b1', tier: 1, product: 'butaman', qty: 5 }), mk('opaaaaaaaa2', 'batch_ready', { batchId: 'b1' })];
  const res = env.post({ command: 'appendOps', payload: { ops } });
  assert.equal(res.ok, true);
  assert.equal(res.saved, 2);
  const again = env.post({ command: 'appendOps', payload: { ops: [ops[0], mk('bad', 'batch_start', {})] } });
  assert.equal(again.saved, 0);
  assert.equal(again.results[0].duplicate, true);
  assert.equal(again.results[1].ok, false);
  const sheet = env.sheets['操作ログ'];
  assert.equal(sheet.rows.length, 3);
  assert.equal(env.lockStats.releases, env.lockStats.tries);

  const date = env.ctx.NomiCore.jstParts(now).dateKey;
  const list = env.post({ command: 'listOps', payload: { date } });
  assert.equal(list.ok, true);
  assert.equal(list.ops.length, 2);
  assert.deepEqual(list.ops[0].payload, { batchId: 'b1', tier: 1, product: 'butaman', qty: 5 });
  assert.equal(env.post({ command: 'listOps', payload: { date: '2000-01-01' } }).ops.length, 0);
  assert.equal(env.post({ command: 'listOps', payload: { date: 'x' } }).code, 'invalid');

  env.lockAvailable = false;
  assert.equal(env.post({ command: 'appendOps', payload: { ops: [mk('opaaaaaaaa3', 'batch_ready', { batchId: 'b1' })] } }).code, 'busy');
});

test('getCatalog / saveCatalog: 商品マスターを版番号つきで保存し、古い版からの上書きを拒否', () => {
  const env = createEnv();
  assert.equal(env.post({ command: 'getCatalog' }).catalog, null);
  const catalog = {
    products: [
      { id: 'butaman', name: '豚まん', short: '豚', man: true, methods: ['steam', 'fry'], prices: { steam: 500, fry: 550 }, enabled: true },
      { id: 'potato', name: '=ポテト', short: 'ポテト', man: false, methods: [], prices: { '': 300 }, enabled: false }
    ],
    options: { serviceOn: true, serviceEvery: 5, friedFromSteamed: false }
  };
  const saved = env.post({ command: 'saveCatalog', payload: { catalog, baseVersion: 0 } });
  assert.equal(saved.ok, true);
  assert.equal(saved.catalog.version, 1);
  assert.equal(env.post({ command: 'getCatalog' }).catalog.products[0].prices.fry, 550);
  const sheet = env.sheets['商品マスター'];
  assert.equal(sheet.rows[0][1], '商品ID');
  assert.deepEqual(sheet.rows[1].slice(1, 8), ['butaman', '豚まん', '豚', 'はい', '蒸し・揚げ', '蒸し:500円 / 揚げ:550円', '販売中']);
  assert.equal(sheet.rows[2][2], "'=ポテト");

  const stale = env.post({ command: 'saveCatalog', payload: { catalog, baseVersion: 0 } });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'conflict');
  assert.equal(stale.catalog.version, 1);
  assert.equal(env.post({ command: 'saveCatalog', payload: { catalog: { products: [{ id: 'x', name: '' }] }, baseVersion: 1 } }).code, 'invalid');
  assert.equal(env.lockStats.releases, env.lockStats.tries);
});
