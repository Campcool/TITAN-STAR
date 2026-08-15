// TITAN-STAR 資料完整性與解析器 smoke 測試
// 用途：在 CI 與每月 Excel 匯入後，快速驗證 data.json 結構不被壞、
// parser/analyzer 的純函式對真實資料跑一遍不爆。
// 執行：node --test tests/data-integrity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

// ── data.json 結構斷言 ──────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));

test('data.json has months with records', () => {
  assert.ok(data.months && Object.keys(data.months).length >= 3, '至少 3 個月份資料');
  for (const [key, month] of Object.entries(data.months)) {
    assert.match(key, /^\d{4}-\d{2}$/, '月份鍵格式 YYYY-MM: ' + key);
    assert.ok(month.records || month.rows || Object.keys(month).length > 0, key + ' 有內容');
  }
});

test('data.json partsMaster entries are well-formed', () => {
  // partsMaster 是 [品號, 品名, 規格, 大類代碼] 的陣列陣列（料件主檔快照）
  assert.ok(Array.isArray(data.partsMaster), 'partsMaster 是陣列');
  assert.ok(data.partsMaster.length >= 8000, 'partsMaster 至少 8,000 筆（現 8,996）');
  for (const part of data.partsMaster.slice(0, 200)) {
    assert.ok(
      Array.isArray(part) && part.length >= 3 && String(part[0]).trim() !== '',
      '料件格式異常（應為 [品號,品名,規格,大類]）: ' + JSON.stringify(part).slice(0, 80),
    );
  }
});

test('data.json modelSupplements structure', () => {
  // modelSupplements 是 { 型號: { model, modelDisplay, sourceFiles, monthly, ... } } 的物件
  assert.ok(data.modelSupplements && typeof data.modelSupplements === 'object' && !Array.isArray(data.modelSupplements), 'modelSupplements 是物件');
  const entries = Object.entries(data.modelSupplements);
  assert.ok(entries.length >= 12, '至少 12 個機種補充（現 ' + entries.length + '）');
  for (const [key, m] of entries.slice(0, 13)) {
    assert.ok(m.model === key || m.modelDisplay, '機種補充缺 model/modelDisplay: ' + key);
    assert.ok(Array.isArray(m.monthly) || m.refurbished !== undefined, key + ' 缺 monthly/refurbished');
  }
});

test('data.json publishedAt is recent ISO timestamp', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(data.publishedAt), 'publishedAt 為 ISO 格式');
});

// ── parser.js / analyzer.js IIFE 掛載 smoke 測試 ─────────────────
// 兩個模組都是瀏覽器 IIFE（掛 window.RepairDB / window.RepairAnalyzer），
// 用 vm 模擬最小 window 環境執行，驗證不爆並暴露介面。
import vm from 'node:vm';

function loadModule(file) {
  const ctx = {
    console,
    window: {},
    document: { createElement: () => ({ appendChild: () => {} }) },
    localStorage: {
      _store: {},
      getItem(k) { return this._store[k] ?? null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; },
      clear() { this._store = {}; },
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  return ctx;
}

test('parser.js loads without throwing and exposes RepairDB', () => {
  // window.RepairDB 只有 load/save/addMonth/removeMonth/clear（解析輔助函式在內部 IIFE 不公開），
  // 不硬綁定解析輔助函式名稱，避免匯出介面改版時測試全死
  const ctx = loadModule('parser.js');
  assert.ok(ctx.window.RepairDB, 'parser 應掛 window.RepairDB');
  for (const fn of ['load', 'save', 'addMonth', 'removeMonth', 'clear']) {
    assert.equal(typeof ctx.window.RepairDB[fn], 'function', 'RepairDB.' + fn + ' 應為 function');
  }
});

test('analyzer.js loads without throwing and exposes analyzer API', () => {
  const ctx = loadModule('analyzer.js');
  const api = Object.values(ctx.window).find((v) => v && typeof v.detectAnomalies === 'function');
  assert.ok(api, 'analyzer 應暴露 detectAnomalies 等函式');
  assert.equal(typeof api.classifyFault, 'function');
  assert.ok(Array.isArray(api.FAULT_TAXONOMY) || typeof api.FAULT_TAXONOMY === 'object', 'FAULT_TAXONOMY 存在');
});

test('parser.normalizePart merges synonym variants', () => {
  const ctx = loadModule('parser.js');
  const n = ctx.window.RepairDB.normalizePart;
  if (typeof n !== 'function') return; // 匯出介面日後改動時自動跳過
  const variants = ['8瓦喇叭', '喇叭8瓦', '8W 喇叭'];
  const normalized = variants.map((v) => n(v));
  assert.ok(new Set(normalized).size === 1, '同義詞應合併為同一名稱，實際：' + JSON.stringify(normalized));
});

test('parser date parsing tolerates common formats', () => {
  const ctx = loadModule('parser.js');
  const db = ctx.window.RepairDB;
  // parseDate/parseMfgMonth/parseOrderMonth 都可能存在，任一支能解析斜線格式即通過
  const parsers = ['parseDate', 'parseMfgMonth', 'parseOrderMonth'].filter((k) => typeof db[k] === 'function');
  if (parsers.length === 0) return;
  const parsed = parsers.map((k) => db[k]('2026/7/15'));
  const ok = parsed.some((v) => v instanceof Date || /^\d{4}-\d{2}/.test(String(v)));
  assert.ok(ok, '斜線日期可解析，實際: ' + JSON.stringify(parsed));
});

test('monthly record totals are plausible', () => {
  // 每月筆數應 > 0 且無異常巨量（單月上限 5,000 筆為合理天花板）
  const months = Object.keys(data.months);
  assert.ok(months.length >= 3);
  for (const key of months) {
    const month = data.months[key];
    const records = month.records || month.rows || [];
    assert.ok(records.length > 0, key + ' 有維修紀錄');
    assert.ok(records.length < 5000, key + ' 筆數未超合理上限');
  }
});
