/**
 * 能美豚饅 ハイブリッド版 Google Apps Script バックエンド
 *
 * - コマンド単位の API（POST 本文: {"command": "...", "payload": {...}, "key": "..."}）
 * - 書き込みは LockService（スクリプトロック）で直列化
 * - 記録IDによる重複防止（CacheService + シート上のID照合の二重チェック）
 *
 * スクリプトプロパティ（任意）:
 *   SPREADSHEET_ID : 保存先スプレッドシートID（未設定ならバインド先）
 *   SHARED_KEY     : 設定時、リクエストの key と一致しなければ拒否
 *
 * NomiCore は Core.gs（docs/core.js のコピー）で定義されます。
 */

var SHEET_RECORDS = '受渡記録';
var SHEET_KNOWLEDGE = '販売ナレッジ';
var SHEET_OPS = '操作ログ';
var OPS_HEADERS = ['操作ID', '出店日', '種類', '内容', '端末ID', '発生時刻', '受信時刻'];
var SHEET_CATALOG = '商品マスター';
var CATALOG_HEADERS = ['並び', '商品ID', '商品名', '略称', 'まん類', '調理方法', '価格', '販売中', '更新日時'];
var PROP_CATALOG = 'CATALOG_JSON';
var RECORD_HEADERS = ['記録ID', '受渡日時', '日付', '曜日', '時刻', '時間帯', '商品ID', '商品名', '数量', '方法', '端末ID', '受信日時'];
var KNOWLEDGE_HEADERS = ['曜日', '時間帯', '商品ID', '商品名', '実績回数', '合計数量', '1回平均', '状態', '更新日時'];
var LOCK_TIMEOUT_MS = 10000;
var MAX_BATCH = 50;
var DUP_CACHE_SECONDS = 21600; // 6時間（CacheService の上限）

var COMMANDS = {
  ping: cmdPing,
  recordDelivery: cmdRecordDelivery,
  recordDeliveries: cmdRecordDeliveries,
  listDeliveries: cmdListDeliveries,
  getForecast: cmdGetForecast,
  rebuildKnowledge: cmdRebuildKnowledge,
  appendOps: cmdAppendOps,
  listOps: cmdListOps,
  getCatalog: cmdGetCatalog,
  saveCatalog: cmdSaveCatalog
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  return respond_(dispatch_({ command: p.command || 'ping', payload: p, key: p.key }));
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respond_({ ok: false, error: 'JSONを解釈できません', code: 'bad_json' });
  }
  return respond_(dispatch_(body));
}

/** テストからも呼べる純粋なディスパッチャ */
function dispatch_(body) {
  try {
    if (!body || typeof body !== 'object') return fail_('bad_request', 'リクエストが不正です');
    var command = String(body.command || '');
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
      return fail_('unknown_command', '未対応のコマンドです: ' + command);
    }
    var expected = PropertiesService.getScriptProperties().getProperty('SHARED_KEY');
    if (expected && String(body.key || '') !== expected) {
      return fail_('unauthorized', '共有キーが一致しません');
    }
    var result = COMMANDS[command](body.payload || {});
    result.command = command;
    return result;
  } catch (err) {
    return fail_('server_error', String((err && err.message) || err), true);
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message, retryable) {
  return { ok: false, code: code, error: message, retryable: !!retryable };
}

/* ---------------- コマンド ---------------- */

function cmdPing() {
  return { ok: true, serverTime: new Date().toISOString() };
}

function cmdRecordDelivery(payload) {
  var res = cmdRecordDeliveries({ records: [payload.record || payload] });
  if (!res.ok) return res;
  var r = res.results[0];
  return r.ok ? { ok: true, id: r.id, duplicate: r.duplicate, record: r.record } : fail_('invalid', r.error);
}

function cmdRecordDeliveries(payload) {
  var input = payload.records;
  if (!Array.isArray(input) || input.length === 0) return fail_('invalid', '記録がありません');
  if (input.length > MAX_BATCH) return fail_('invalid', '一度に送れるのは' + MAX_BATCH + '件までです');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail_('busy', '混み合っています。自動で再送します', true);
  }
  try {
    var sheet = getSheet_(SHEET_RECORDS, RECORD_HEADERS);
    var cache = CacheService.getScriptCache();
    var existingIds = loadIdSet_(sheet);
    var now = new Date();
    var receivedAt = now.toISOString();
    var rows = [];
    var results = [];

    for (var i = 0; i < input.length; i++) {
      var n = NomiCore.normalizeDelivery(input[i], { now: now });
      if (!n.ok) {
        results.push({ ok: false, id: input[i] && input[i].id, error: n.error });
        continue;
      }
      var rec = n.record;
      if (existingIds[rec.id] || cache.get('dup:' + rec.id)) {
        results.push({ ok: true, id: rec.id, duplicate: true });
        continue;
      }
      existingIds[rec.id] = true;
      rows.push([
        rec.id, rec.occurredAt, rec.dateKey, rec.weekday, rec.time, rec.slot,
        rec.productId, rec.productName, rec.quantity, rec.method, rec.deviceId, receivedAt
      ].map(NomiCore.safeCell));
      results.push({ ok: true, id: rec.id, duplicate: false, record: rec });
    }

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RECORD_HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
      for (var j = 0; j < results.length; j++) {
        if (results[j].ok && !results[j].duplicate) cache.put('dup:' + results[j].id, '1', DUP_CACHE_SECONDS);
      }
    }
    return { ok: true, saved: rows.length, results: results };
  } finally {
    lock.releaseLock();
  }
}

function cmdListDeliveries(payload) {
  var days = clampInt_(payload.sinceDays, 1, 90, NomiCore.DEFAULTS.lookbackDays);
  var since = Date.now() - days * 24 * 60 * 60 * 1000;
  var records = readRecords_().filter(function (r) {
    return new Date(r.occurredAt).getTime() >= since;
  });
  return { ok: true, sinceDays: days, records: records };
}

function cmdGetForecast(payload) {
  var now = payload.now ? new Date(payload.now) : new Date();
  if (isNaN(now.getTime())) return fail_('invalid', '日時が不正です');
  return { ok: true, forecast: NomiCore.forecast(readRecords_(), now) };
}

function cmdRebuildKnowledge() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return fail_('busy', '混み合っています', true);
  try {
    var rows = NomiCore.summarize(readRecords_());
    var sheet = getSheet_(SHEET_KNOWLEDGE, KNOWLEDGE_HEADERS);
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, KNOWLEDGE_HEADERS.length).clearContent();
    var stamp = new Date().toISOString();
    if (rows.length) {
      var values = rows.map(function (k) {
        return [k.weekday, k.slot, k.productId, k.productName, k.samples, k.totalQuantity, k.average, k.status, stamp].map(NomiCore.safeCell);
      });
      sheet.getRange(2, 1, values.length, KNOWLEDGE_HEADERS.length).setValues(values);
    }
    return { ok: true, rows: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/** 蒸し・販売の共有操作を追記（操作IDで重複防止） */
function cmdAppendOps(payload) {
  var input = payload.ops;
  if (!Array.isArray(input) || input.length === 0) return fail_('invalid', '操作がありません');
  if (input.length > MAX_BATCH) return fail_('invalid', '一度に送れるのは' + MAX_BATCH + '件までです');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return fail_('busy', '混み合っています。自動で再送します', true);
  try {
    var sheet = getSheet_(SHEET_OPS, OPS_HEADERS);
    var cache = CacheService.getScriptCache();
    var existing = loadIdSet_(sheet);
    var now = new Date();
    var rows = [];
    var results = [];
    for (var i = 0; i < input.length; i++) {
      var n = NomiCore.normalizeOp(input[i], { now: now });
      if (!n.ok) { results.push({ ok: false, id: input[i] && input[i].id, error: n.error }); continue; }
      var op = n.op;
      if (existing[op.id] || cache.get('op:' + op.id)) { results.push({ ok: true, id: op.id, duplicate: true }); continue; }
      existing[op.id] = true;
      rows.push([op.id, op.date, op.type, JSON.stringify(op.payload), op.device, op.at, now.toISOString()].map(NomiCore.safeCell));
      results.push({ ok: true, id: op.id, duplicate: false });
    }
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, OPS_HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
      results.forEach(function (r) { if (r.ok && !r.duplicate) cache.put('op:' + r.id, '1', DUP_CACHE_SECONDS); });
    }
    return { ok: true, saved: rows.length, results: results };
  } finally {
    lock.releaseLock();
  }
}

/** 指定した出店日（日本時間の日付）の操作を返す */
function cmdListOps(payload) {
  var date = String(payload.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail_('invalid', '日付が不正です');
  var sheet = getSheet_(SHEET_OPS, OPS_HEADERS);
  var last = sheet.getLastRow();
  var ops = [];
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, OPS_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (!v[0] || String(v[1]) !== date) continue;
      var payloadObj;
      try { payloadObj = JSON.parse(String(v[3])); } catch (e) { continue; }
      ops.push({ id: String(v[0]), date: String(v[1]), type: String(v[2]), payload: payloadObj, device: String(v[4]), at: String(v[5]) });
    }
  }
  return { ok: true, date: date, ops: ops, serverTime: new Date().toISOString() };
}

/** 商品マスターを返す（未登録なら null。端末側は既定値を使う） */
function cmdGetCatalog() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_CATALOG);
  return { ok: true, catalog: raw ? JSON.parse(raw) : null };
}

/** 商品マスターを保存（版番号で同時編集の上書きを防止） */
function cmdSaveCatalog(payload) {
  var n = NomiCore.normalizeCatalog(payload.catalog);
  if (!n.ok) return fail_('invalid', n.error);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return fail_('busy', '混み合っています。もう一度保存してください', true);
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(PROP_CATALOG);
    var current = raw ? JSON.parse(raw) : null;
    var currentVersion = current ? current.version : 0;
    if (Number(payload.baseVersion || 0) !== currentVersion) {
      return { ok: false, code: 'conflict', error: '他の端末で商品が更新されています。最新を読み込みました', catalog: current, retryable: false };
    }
    var catalog = n.catalog;
    catalog.version = currentVersion + 1;
    catalog.updatedAt = new Date().toISOString();
    props.setProperty(PROP_CATALOG, JSON.stringify(catalog));
    writeCatalogSheet_(catalog);
    return { ok: true, catalog: catalog };
  } finally {
    lock.releaseLock();
  }
}

/** 人が見る用の一覧をシートに書き出す（正本はスクリプトプロパティ） */
function writeCatalogSheet_(catalog) {
  var sheet = getSheet_(SHEET_CATALOG, CATALOG_HEADERS);
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, CATALOG_HEADERS.length).clearContent();
  var label = { steam: '蒸し', fry: '揚げ', '': '—' };
  var rows = catalog.products.map(function (p, i) {
    var keys = p.methods.length ? p.methods : [''];
    return [i + 1, p.id, p.name, p.short, p.man ? 'はい' : 'いいえ',
      keys.map(function (m) { return label[m]; }).join('・'),
      keys.map(function (m) { return label[m] + ':' + (typeof p.prices[m] === 'number' ? p.prices[m] + '円' : '未設定'); }).join(' / '),
      p.enabled ? '販売中' : '停止', catalog.updatedAt].map(NomiCore.safeCell);
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, CATALOG_HEADERS.length).setValues(rows);
}

/** 時間主導トリガー用（例: 毎晩1回） */
function rebuildKnowledgeTrigger() {
  return cmdRebuildKnowledge();
}

/**
 * 初回セットアップ: スクリプトエディタでこの関数を1回実行し、権限を承認してください。
 * シートの作成と、販売ナレッジの毎晩3時の自動再集計トリガー登録を行います（何度実行しても安全）。
 */
function setup() {
  getSheet_(SHEET_RECORDS, RECORD_HEADERS);
  getSheet_(SHEET_KNOWLEDGE, KNOWLEDGE_HEADERS);
  getSheet_(SHEET_OPS, OPS_HEADERS);
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'rebuildKnowledgeTrigger';
  });
  if (!exists) {
    ScriptApp.newTrigger('rebuildKnowledgeTrigger').timeBased().everyDays(1).atHour(3).create();
  }
  return 'セットアップ完了';
}

/* ---------------- シート操作 ---------------- */

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    // 日付・時刻文字列がシート側で自動変換されないよう、数量以外の文字列列はテキスト書式に固定
    if (name === SHEET_OPS) {
      sheet.getRange(1, 1, sheet.getMaxRows(), OPS_HEADERS.length).setNumberFormat('@');
    }
    if (name === SHEET_RECORDS) {
      sheet.getRange(1, 1, sheet.getMaxRows(), 8).setNumberFormat('@');
      sheet.getRange(1, 10, sheet.getMaxRows(), 3).setNumberFormat('@');
    }
  }
  return sheet;
}

function loadIdSet_(sheet) {
  var set = {};
  var last = sheet.getLastRow();
  if (last < 2) return set;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) if (values[i][0]) set[String(values[i][0])] = true;
  return set;
}

function readRecords_() {
  var sheet = getSheet_(SHEET_RECORDS, RECORD_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, RECORD_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (!v[0]) continue;
    var occurred = v[1] instanceof Date ? v[1].toISOString() : String(v[1]);
    out.push({
      id: String(v[0]), occurredAt: occurred, dateKey: String(v[2]), weekday: String(v[3]),
      time: String(v[4]), slot: String(v[5]), productId: String(v[6]), productName: String(v[7]),
      quantity: Number(v[8]), method: String(v[9])
    });
  }
  return out;
}

function clampInt_(value, min, max, fallback) {
  var n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
