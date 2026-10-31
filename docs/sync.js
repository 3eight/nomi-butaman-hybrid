/*
 * 能美豚饅 ハイブリッド版 同期クライアント
 * - 受渡記録はまず端末内（localStorage）に保存し、送信キューに積む
 * - 回線が戻ったらまとめて GAS に送信（記録IDで重複防止されるので再送しても安全）
 * - storage / fetch を注入できるので Node でテスト可能
 */
var NomiSync = (function () {
  'use strict';

  var Core = (typeof NomiCore !== 'undefined') ? NomiCore
    : (typeof require === 'function' ? require('./core.js') : null);

  var KEY_RECORDS = 'nomi.records.v1';
  var KEY_QUEUE = 'nomi.queue.v1';
  var KEY_DEVICE = 'nomi.device.v1';
  var KEY_META = 'nomi.meta.v1';
  var KEY_OPS = 'nomi.ops.v1';
  var KEY_OPQ = 'nomi.opq.v1';
  var KEEP_OP_DAYS = 3;
  var KEEP_DAYS = 90;
  var BATCH = 50;

  function makeId(rand) {
    if (!rand && typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var r = rand || Math.random;
    var s = '';
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 24; i++) s += chars.charAt(Math.floor(r() * chars.length));
    return s;
  }

  function createSync(opts) {
    var storage = opts.storage;
    var fetchFn = opts.fetch;
    var cfg = opts.config || {};
    var clock = opts.now || function () { return new Date(); };
    var flushing = null;

    function load(key, fallback) {
      try {
        var raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    }
    function save(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* 容量不足などは無視 */ }
    }

    var records = load(KEY_RECORDS, []);
    var queue = load(KEY_QUEUE, []);
    var meta = load(KEY_META, { lastSyncAt: null, lastError: null });
    var ops = load(KEY_OPS, []);
    var opQueue = load(KEY_OPQ, []);
    var flushingOps = null;
    var deviceId = storage.getItem(KEY_DEVICE);
    if (!deviceId) { deviceId = 'dev-' + makeId(); storage.setItem(KEY_DEVICE, deviceId); }

    function persist() {
      var cutoff = clock().getTime() - KEEP_DAYS * 86400000;
      records = records.filter(function (r) { return new Date(r.occurredAt).getTime() >= cutoff; });
      save(KEY_RECORDS, records);
      save(KEY_QUEUE, queue);
      var opCutoff = clock().getTime() - KEEP_OP_DAYS * 86400000;
      ops = ops.filter(function (o) { return new Date(o.at).getTime() >= opCutoff; });
      save(KEY_OPS, ops);
      save(KEY_OPQ, opQueue);
      save(KEY_META, meta);
    }

    function call(command, payload) {
      if (!cfg.gasUrl) return Promise.reject(new Error('GASのURLが未設定です'));
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, cfg.timeoutMs || 15000) : null;
      // text/plain にすることで CORS プリフライトを避ける（GAS は OPTIONS に応答できないため）
      return fetchFn(cfg.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ command: command, payload: payload, key: cfg.sharedKey || '' }),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).finally(function () {
        if (timer) clearTimeout(timer);
      });
    }

    /** 受渡完了を記録（オフラインでも即座に成功） */
    function addDelivery(input) {
      var n = Core.normalizeDelivery({
        id: input.id || makeId(),
        occurredAt: input.occurredAt || clock().toISOString(),
        productId: input.productId,
        productName: input.productName,
        quantity: input.quantity,
        method: input.method,
        deviceId: deviceId
      }, { now: clock(), slotMinutes: cfg.slotMinutes });
      if (!n.ok) throw new Error(n.error);
      var rec = n.record;
      rec.pending = true;
      records = Core.mergeRecords(records, [rec]);
      queue.push(rec);
      persist();
      return rec;
    }

    function markSynced(id, error) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === id) {
          delete records[i].pending;
          if (error) records[i].syncError = error; else delete records[i].syncError;
        }
      }
    }

    /** 送信キューをまとめて送る。同時実行は1本に制限 */
    function flush() {
      if (flushing) return flushing;
      if (!queue.length) return Promise.resolve({ sent: 0, remaining: 0 });
      if (!cfg.gasUrl) return Promise.resolve({ sent: 0, remaining: queue.length, skipped: true });

      var batch = queue.slice(0, BATCH);
      var payload = batch.map(function (r) {
        return {
          id: r.id, occurredAt: r.occurredAt, productId: r.productId, productName: r.productName,
          quantity: r.quantity, method: r.method, deviceId: r.deviceId
        };
      });

      flushing = call('recordDeliveries', { records: payload }).then(function (res) {
        if (!res || !res.ok) {
          meta.lastError = (res && res.error) || '送信失敗';
          if (res && res.retryable === false && res.code !== 'busy' && res.code !== 'unauthorized') {
            // 恒久エラー（不正な一括要求など）はキューを詰まらせないよう個別にエラー扱い
            batch.forEach(function (r) { markSynced(r.id, meta.lastError); });
            removeFromQueue(batch.map(function (r) { return r.id; }));
          }
          persist();
          return { sent: 0, remaining: queue.length, error: meta.lastError };
        }
        var done = [];
        res.results.forEach(function (r) {
          if (!r || !r.id) return;
          done.push(r.id);
          markSynced(r.id, r.ok ? null : r.error);
        });
        removeFromQueue(done);
        meta.lastSyncAt = clock().toISOString();
        meta.lastError = null;
        persist();
        return { sent: done.length, remaining: queue.length };
      }, function (err) {
        meta.lastError = '未送信（電波待ち）: ' + ((err && err.message) || err);
        persist();
        return { sent: 0, remaining: queue.length, error: meta.lastError };
      }).then(function (result) {
        flushing = null;
        if (result.sent > 0 && queue.length) return flush();
        return result;
      });
      return flushing;
    }

    function removeFromQueue(ids) {
      var set = {};
      ids.forEach(function (id) { set[id] = true; });
      queue = queue.filter(function (r) { return !set[r.id]; });
    }

    /** 共有データ（他端末の記録）を取り込む */
    function pull() {
      if (!cfg.gasUrl) return Promise.resolve({ skipped: true });
      return call('listDeliveries', { sinceDays: cfg.lookbackDays || 56 }).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || '取得失敗');
        records = Core.mergeRecords(records, res.records || []);
        meta.lastSyncAt = clock().toISOString();
        persist();
        return { count: records.length };
      });
    }

    /* ---- 蒸し・販売の共有操作 ---- */
    function todayKey() { return Core.jstParts(clock()).dateKey; }

    /** 操作を記録（オフラインでも即座に反映。送信は flushOps） */
    function addOp(type, payload) {
      var n = Core.normalizeOp({ id: makeId(), type: type, payload: payload, at: clock().toISOString(), device: deviceId }, { now: clock() });
      if (!n.ok) throw new Error(n.error);
      n.op.pending = true;
      ops.push(n.op);
      opQueue.push(n.op);
      persist();
      return n.op;
    }

    function getOps(date) {
      var d = date || todayKey();
      return ops.filter(function (o) { return o.date === d; });
    }

    function flushOps() {
      if (flushingOps) return flushingOps;
      if (!opQueue.length) return Promise.resolve({ sent: 0, remaining: 0 });
      if (!cfg.gasUrl) return Promise.resolve({ sent: 0, remaining: opQueue.length, skipped: true });
      var batch = opQueue.slice(0, BATCH).map(function (o) {
        return { id: o.id, type: o.type, payload: o.payload, at: o.at, device: o.device };
      });
      flushingOps = call('appendOps', { ops: batch }).then(function (res) {
        if (!res || !res.ok) {
          meta.lastError = (res && res.error) || '送信失敗';
          persist();
          return { sent: 0, remaining: opQueue.length, error: meta.lastError };
        }
        var done = {};
        res.results.forEach(function (r) {
          if (!r || !r.id) return;
          done[r.id] = true;
          ops.forEach(function (o) {
            if (o.id === r.id) { delete o.pending; if (!r.ok) o.syncError = r.error; }
          });
        });
        opQueue = opQueue.filter(function (o) { return !done[o.id]; });
        meta.lastSyncAt = clock().toISOString();
        meta.lastError = null;
        persist();
        return { sent: Object.keys(done).length, remaining: opQueue.length };
      }, function (err) {
        meta.lastError = '未送信（電波待ち）: ' + ((err && err.message) || err);
        persist();
        return { sent: 0, remaining: opQueue.length, error: meta.lastError };
      }).then(function (result) {
        flushingOps = null;
        if (result.sent > 0 && opQueue.length) return flushOps();
        return result;
      });
      return flushingOps;
    }

    /** 他のスマホの操作を取り込む（当日分） */
    function pullOps(date) {
      if (!cfg.gasUrl) return Promise.resolve({ skipped: true });
      return call('listOps', { date: date || todayKey() }).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || '取得失敗');
        var known = {};
        ops.forEach(function (o) { known[o.id] = true; });
        var added = 0;
        (res.ops || []).forEach(function (o) {
          if (!known[o.id]) { ops.push(o); known[o.id] = true; added++; }
        });
        meta.lastSyncAt = clock().toISOString();
        persist();
        return { added: added };
      });
    }

    function forecast(at) {
      return Core.forecast(records, at || clock(), {
        leadMinutes: cfg.leadMinutes, slotMinutes: cfg.slotMinutes,
        minSamples: cfg.minSamples, lookbackDays: cfg.lookbackDays, excludeProducts: cfg.forecastExclude || ['potato']
      });
    }

    return {
      addDelivery: addDelivery,
      flush: flush,
      pull: pull,
      forecast: forecast,
      call: call,
      getRecords: function () { return records.slice(); },
      getQueue: function () { return queue.slice(); },
      addOp: addOp,
      getOps: getOps,
      flushOps: flushOps,
      pullOps: pullOps,
      todayKey: todayKey,
      getOpQueue: function () { return opQueue.slice(); },
      getMeta: function () { return { lastSyncAt: meta.lastSyncAt, lastError: meta.lastError, deviceId: deviceId }; }
    };
  }

  return { createSync: createSync, makeId: makeId };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NomiSync;
}
