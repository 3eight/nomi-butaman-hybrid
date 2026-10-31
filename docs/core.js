/*
 * 能美豚饅 ハイブリッド版 共通ロジック（ブラウザ / Google Apps Script / Node テスト共用）
 *
 * このファイルは docs/core.js が正本です。
 * gas/Core.gs は `npm run sync:gas` で生成されるコピーです（直接編集しないこと）。
 *
 * 時刻はすべて日本時間（UTC+9、サマータイムなし）で解釈します。
 */
var NomiCore = (function () {
  'use strict';

  var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var DEFAULTS = {
    slotMinutes: 30,     // 時間帯の幅（分）
    leadMinutes: 40,     // 何分後の需要を蒸し目安にするか
    minSamples: 3,       // 同じ曜日・時間帯で必要な実績回数（異なる日付の数）
    lookbackDays: 56     // 何日前までの実績を使うか（季節変動への追従）
  };

  function merge(base, extra) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined) out[k] = extra[k];
    return out;
  }

  function toDate(value) {
    var d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (isNaN(d.getTime())) throw new Error('不正な日時です: ' + value);
    return d;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 日本時間での日付・曜日・分を返す */
  function jstParts(value) {
    var d = toDate(value);
    var j = new Date(d.getTime() + JST_OFFSET_MS);
    var y = j.getUTCFullYear();
    var m = j.getUTCMonth() + 1;
    var day = j.getUTCDate();
    return {
      dateKey: y + '-' + pad2(m) + '-' + pad2(day),
      weekday: j.getUTCDay(),
      minutesOfDay: j.getUTCHours() * 60 + j.getUTCMinutes(),
      hhmm: pad2(j.getUTCHours()) + ':' + pad2(j.getUTCMinutes())
    };
  }

  function minutesToHHMM(min) {
    var m = ((min % 1440) + 1440) % 1440;
    if (min === 1440) return '24:00';
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /** 日時 → 曜日・時間帯 */
  function slotOf(value, slotMinutes) {
    var size = slotMinutes || DEFAULTS.slotMinutes;
    var p = jstParts(value);
    var index = Math.floor(p.minutesOfDay / size);
    var start = index * size;
    return {
      dateKey: p.dateKey,
      weekday: p.weekday,
      weekdayLabel: WEEKDAYS[p.weekday],
      slotIndex: index,
      slotLabel: minutesToHHMM(start) + '-' + minutesToHHMM(Math.min(start + size, 1440)),
      time: p.hhmm
    };
  }

  function sanitizeText(value, maxLen) {
    var s = value == null ? '' : String(value);
    s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  /**
   * 受渡記録を検証・正規化する。曜日・時間帯は受渡日時から必ず再計算する。
   * @returns {{ok:true, record:Object}|{ok:false, error:string}}
   */
  function normalizeDelivery(input, options) {
    var opt = merge(DEFAULTS, options);
    var now = opt.now ? toDate(opt.now) : new Date();
    if (!input || typeof input !== 'object') return { ok: false, error: '記録がありません' };

    var id = sanitizeText(input.id, 64);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { ok: false, error: '記録IDが不正です' };

    var productId = sanitizeText(input.productId, 32);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(productId)) return { ok: false, error: '商品IDが不正です' };
    var productName = sanitizeText(input.productName, 40) || productId;

    var qty = Number(input.quantity);
    if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > 999) {
      return { ok: false, error: '数量は1〜999の整数にしてください' };
    }

    var method = sanitizeText(input.method, 20);
    if (!method) return { ok: false, error: '受渡方法がありません' };

    var occurred;
    try {
      occurred = toDate(input.occurredAt);
    } catch (e) {
      return { ok: false, error: '受渡日時が不正です' };
    }
    if (occurred.getTime() > now.getTime() + 10 * 60 * 1000) {
      return { ok: false, error: '受渡日時が未来です' };
    }
    if (occurred.getTime() < now.getTime() - 60 * 24 * 60 * 60 * 1000) {
      return { ok: false, error: '受渡日時が古すぎます（60日以上前）' };
    }

    var slot = slotOf(occurred, opt.slotMinutes);
    return {
      ok: true,
      record: {
        id: id,
        occurredAt: occurred.toISOString(),
        dateKey: slot.dateKey,
        weekday: slot.weekdayLabel,
        time: slot.time,
        slot: slot.slotLabel,
        productId: productId,
        productName: productName,
        quantity: qty,
        method: method,
        deviceId: sanitizeText(input.deviceId, 64)
      }
    };
  }

  /**
   * 40分後の蒸し目安を計算する。
   * - 目標時刻 = now + leadMinutes。その曜日・時間帯と一致する過去実績を集める。
   * - 当日分は途中経過のため除外。lookbackDays より古い実績も除外。
   * - 異なる日付が minSamples 回以上あれば、商品ごとに「1回あたり平均数量」を切り上げて提示。
   * - 不足時は status: 'learning'。
   */
  function forecast(records, now, options) {
    var opt = merge(DEFAULTS, options);
    var nowDate = now ? toDate(now) : new Date();
    var target = new Date(nowDate.getTime() + opt.leadMinutes * 60 * 1000);
    var tSlot = slotOf(target, opt.slotMinutes);
    var minTime = nowDate.getTime() - opt.lookbackDays * 24 * 60 * 60 * 1000;

    var dates = {};
    var dateCount = 0;
    var totals = {};
    var names = {};
    var list = records || [];

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.occurredAt) continue;
      var t;
      try { t = toDate(r.occurredAt); } catch (e) { continue; }
      if (t.getTime() < minTime || t.getTime() > nowDate.getTime()) continue;
      var s = slotOf(t, opt.slotMinutes);
      if (s.weekday !== tSlot.weekday || s.slotIndex !== tSlot.slotIndex) continue;
      if (s.dateKey === tSlot.dateKey) continue;
      var q = Number(r.quantity);
      if (!isFinite(q) || q <= 0) continue;
      if (!dates[s.dateKey]) { dates[s.dateKey] = true; dateCount++; }
      var pid = r.productId || 'unknown';
      totals[pid] = (totals[pid] || 0) + q;
      if (r.productName) names[pid] = r.productName;
    }

    var base = {
      targetTime: target.toISOString(),
      targetHHMM: tSlot.time,
      weekday: tSlot.weekdayLabel,
      slot: tSlot.slotLabel,
      samples: dateCount,
      minSamples: opt.minSamples,
      leadMinutes: opt.leadMinutes
    };

    if (dateCount < opt.minSamples) {
      base.status = 'learning';
      base.needed = opt.minSamples - dateCount;
      base.total = null;
      base.byProduct = [];
      return base;
    }

    var byProduct = [];
    var total = 0;
    for (var pidKey in totals) {
      if (!Object.prototype.hasOwnProperty.call(totals, pidKey)) continue;
      var avg = totals[pidKey] / dateCount;
      var suggest = Math.ceil(avg);
      total += suggest;
      byProduct.push({
        productId: pidKey,
        productName: names[pidKey] || pidKey,
        average: Math.round(avg * 10) / 10,
        suggest: suggest
      });
    }
    byProduct.sort(function (a, b) { return b.suggest - a.suggest || (a.productId < b.productId ? -1 : 1); });

    base.status = 'ready';
    base.needed = 0;
    base.total = total;
    base.byProduct = byProduct;
    return base;
  }

  /** 曜日×時間帯×商品の販売ナレッジ集計（GASのナレッジシート用） */
  function summarize(records, options) {
    var opt = merge(DEFAULTS, options);
    var groups = {};
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.occurredAt) continue;
      var s;
      try { s = slotOf(r.occurredAt, opt.slotMinutes); } catch (e) { continue; }
      var key = s.weekday + '|' + s.slotIndex + '|' + r.productId;
      var g = groups[key];
      if (!g) {
        g = groups[key] = {
          weekdayIndex: s.weekday, weekday: s.weekdayLabel, slotIndex: s.slotIndex, slot: s.slotLabel,
          productId: r.productId, productName: r.productName || r.productId,
          totalQuantity: 0, dates: {}, samples: 0
        };
      }
      g.totalQuantity += Number(r.quantity) || 0;
      if (!g.dates[s.dateKey]) { g.dates[s.dateKey] = true; g.samples++; }
    }
    var out = [];
    for (var k in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, k)) continue;
      var gg = groups[k];
      out.push({
        weekdayIndex: gg.weekdayIndex, weekday: gg.weekday, slotIndex: gg.slotIndex, slot: gg.slot,
        productId: gg.productId, productName: gg.productName,
        samples: gg.samples, totalQuantity: gg.totalQuantity,
        average: Math.round((gg.totalQuantity / gg.samples) * 10) / 10,
        status: gg.samples >= opt.minSamples ? '目安あり' : '学習中'
      });
    }
    out.sort(function (a, b) {
      return a.weekdayIndex - b.weekdayIndex || a.slotIndex - b.slotIndex || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
    });
    return out;
  }

  /** 記録IDで重複排除して結合（後勝ちではなく先勝ち = 既存を保持） */
  function mergeRecords(existing, incoming) {
    var seen = {};
    var out = [];
    var all = (existing || []).concat(incoming || []);
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (!r || !r.id || seen[r.id]) continue;
      seen[r.id] = true;
      out.push(r);
    }
    out.sort(function (a, b) { return a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0; });
    return out;
  }

  /** スプレッドシートの数式インジェクション対策 */
  function safeCell(value) {
    if (typeof value !== 'string') return value;
    return /^[=+\-@]/.test(value) ? "'" + value : value;
  }

  return {
    DEFAULTS: DEFAULTS,
    WEEKDAYS: WEEKDAYS,
    jstParts: jstParts,
    slotOf: slotOf,
    normalizeDelivery: normalizeDelivery,
    forecast: forecast,
    summarize: summarize,
    mergeRecords: mergeRecords,
    safeCell: safeCell
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NomiCore;
}
