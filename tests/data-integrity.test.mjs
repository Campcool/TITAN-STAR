// TITAN-STAR 資料完整性與解析器 smoke 測試
// 用途：在 CI 與每月 Excel 匯入後，快速驗證 data.json 結構不被壞、
// parser/analyzer 的純函式對真實資料跑一遍不爆。
// 執行：node --test tests/data-integrity.test.mjs
//
// ── 撰寫規則：取樣範圍必須印出來 ──────────────────────────────
// 每個測試都要用 t.diagnostic() 回報它「實際」驗了幾筆／幾個，特別是
// 有 slice() 取樣上限時。測試名稱寫 "partsMaster entries are well-formed"
// 但只驗前 200 筆（共 8,996 筆），這種落差不寫出來就沒有人看得見，
// 而綠燈會被當成「全部都驗過了」。
//
// 這條規則來自 2026-08-16 的三次漏判（詳見 leakdoctor/scripts/validate-site.mjs
// 檔頭）：斷言宣稱「全域」但實際只讀單一檔案，因為分母沒印出來，
// 寫的人與看的人都沒發現。有上限就寫出上限，沒有就寫總數。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

// ── 內部工具不得被搜尋引擎收錄 ──────────────────────────────────
// 本站是工廠維修分析工具，部署在公開的 GitHub Pages 上。登入是純前端的，
// 擋不住任何人——data.json 是獨立的公開網址，直接開就拿得到全部紀錄。
// 因此唯一能降低曝光的手段就是不要被搜尋引擎收錄。
//
// 刻意不用 robots.txt：(1) 專案頁的 robots.txt 必須放在網域根目錄
// campcool.github.io/robots.txt，那需要另一個 repo；(2) 對「已收錄、想移除」
// 的情境，擋掉爬取會讓 Google 看不到 noindex，網址反而可能以「僅網址」
// 形式留在索引裡。正解是只加 noindex、不擋爬取。
//
// ⚠️ 這一條不是完整的保護。data.json 無法加 meta 標籤，GitHub Pages 也不能
// 設 X-Robots-Tag 標頭，所以它技術上仍可被抓取。要真正擋住需要換架構
// （例如 Cloudflare Pages + Access）。詳見 AI-HANDOFF「公開曝光」章節。
test('internal tool pages carry noindex', (t) => {
  const pages = ['index.html', 'TITAN-STAR.html', 'TITAN-STAR-morandi.html'];
  const checked = [];
  for (const page of pages) {
    const p = path.join(root, page);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    assert.match(
      html,
      /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i,
      page + ' 缺少 noindex——這是唯一擋住搜尋引擎收錄工廠維修資料的機制',
    );
    checked.push(page);
  }
  assert.equal(checked.length, pages.length, '應檢查 ' + pages.length + ' 個頁面，實際 ' + checked.length);
  t.diagnostic('掃描範圍：' + checked.length + '/' + pages.length + ' 個 HTML（' + checked.join('、')
    + '）。⚠️ data.json 無法加 meta，不在本斷言涵蓋範圍內');
});

// ── data.json 結構斷言 ──────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));

test('data.json has months with records', (t) => {
  assert.ok(data.months && Object.keys(data.months).length >= 3, '至少 3 個月份資料');
  const months = Object.entries(data.months);
  for (const [key, month] of months) {
    assert.match(key, /^\d{4}-\d{2}$/, '月份鍵格式 YYYY-MM: ' + key);
    assert.ok(month.records || month.rows || Object.keys(month).length > 0, key + ' 有內容');
  }
  t.diagnostic('掃描範圍：' + months.length + '/' + months.length + ' 個月份全驗（' + months.map(([k]) => k).join('、') + '）');
});

test('data.json partsMaster entries are well-formed', (t) => {
  // partsMaster 是 [品號, 品名, 規格, 大類代碼] 的陣列陣列（料件主檔快照）
  assert.ok(Array.isArray(data.partsMaster), 'partsMaster 是陣列');
  assert.ok(data.partsMaster.length >= 8000, 'partsMaster 至少 8,000 筆（現 8,996）');
  // ⚠️ 取樣上限：只驗前 SAMPLE 筆。8,996 筆全驗會拖慢 CI，但這代表
  // 第 201 筆之後的格式問題本測試看不到——所以上限必須印出來。
  const SAMPLE = 200;
  const sample = data.partsMaster.slice(0, SAMPLE);
  for (const part of sample) {
    assert.ok(
      Array.isArray(part) && part.length >= 3 && String(part[0]).trim() !== '',
      '料件格式異常（應為 [品號,品名,規格,大類]）: ' + JSON.stringify(part).slice(0, 80),
    );
  }
  t.diagnostic('掃描範圍：' + sample.length + '/' + data.partsMaster.length + ' 筆（取樣上限 ' + SAMPLE + '，其餘未驗）');
});

test('data.json modelSupplements structure', (t) => {
  // modelSupplements 是 { 型號: { model, modelDisplay, sourceFiles, monthly, ... } } 的物件
  assert.ok(data.modelSupplements && typeof data.modelSupplements === 'object' && !Array.isArray(data.modelSupplements), 'modelSupplements 是物件');
  const entries = Object.entries(data.modelSupplements);
  assert.ok(entries.length >= 12, '至少 12 個機種補充（現 ' + entries.length + '）');
  // 全驗，不設上限：機種數量是十位數等級，不需要取樣。
  for (const [key, m] of entries) {
    assert.ok(m.model === key || m.modelDisplay, '機種補充缺 model/modelDisplay: ' + key);
    assert.ok(Array.isArray(m.monthly) || m.refurbished !== undefined, key + ' 缺 monthly/refurbished');
  }
  t.diagnostic('掃描範圍：' + entries.length + '/' + entries.length + ' 個機種全驗');
});

test('data.json publishedAt is recent ISO timestamp', (t) => {
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(data.publishedAt), 'publishedAt 為 ISO 格式');
  t.diagnostic('掃描範圍：publishedAt 1 個欄位，只驗格式不驗新舊（測試名稱的 "recent" 目前沒有對應斷言）');
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

test('parser.js loads without throwing and exposes RepairDB', (t) => {
  // window.RepairDB 只有 load/save/addMonth/removeMonth/clear（解析輔助函式在內部 IIFE 不公開），
  // 不硬綁定解析輔助函式名稱，避免匯出介面改版時測試全死
  const ctx = loadModule('parser.js');
  assert.ok(ctx.window.RepairDB, 'parser 應掛 window.RepairDB');
  const fns = ['load', 'save', 'addMonth', 'removeMonth', 'clear'];
  for (const fn of fns) {
    assert.equal(typeof ctx.window.RepairDB[fn], 'function', 'RepairDB.' + fn + ' 應為 function');
  }
  t.diagnostic('掃描範圍：parser.js 1 個檔，' + fns.length + ' 個公開函式（IIFE 內部函式不在範圍）');
});

test('analyzer.js loads without throwing and exposes analyzer API', (t) => {
  const ctx = loadModule('analyzer.js');
  const api = Object.values(ctx.window).find((v) => v && typeof v.detectAnomalies === 'function');
  assert.ok(api, 'analyzer 應暴露 detectAnomalies 等函式');
  assert.equal(typeof api.classifyFault, 'function');
  assert.ok(Array.isArray(api.FAULT_TAXONOMY) || typeof api.FAULT_TAXONOMY === 'object', 'FAULT_TAXONOMY 存在');
  t.diagnostic('掃描範圍：analyzer.js 1 個檔，3 項介面存在性（不驗行為正確性）');
});

test('parser.normalizePart merges synonym variants', (t) => {
  const ctx = loadModule('parser.js');
  const n = ctx.window.RepairDB.normalizePart;
  // 原本這裡是 `return`——介面一改，測試就綠燈通過但其實什麼都沒驗。
  // 改成 t.skip()，node --test 會標記為 skipped 而不是 pass。
  if (typeof n !== 'function') {
    t.skip('RepairDB.normalizePart 不存在（匯出介面已變動）——本測試未驗證任何東西');
    return;
  }
  const variants = ['8瓦喇叭', '喇叭8瓦', '8W 喇叭'];
  const normalized = variants.map((v) => n(v));
  assert.ok(new Set(normalized).size === 1, '同義詞應合併為同一名稱，實際：' + JSON.stringify(normalized));
  t.diagnostic('掃描範圍：' + variants.length + ' 個同義詞變體（單一料件名，非全部同義詞表）');
});

test('parser date parsing tolerates common formats', (t) => {
  const ctx = loadModule('parser.js');
  const db = ctx.window.RepairDB;
  // parseDate/parseMfgMonth/parseOrderMonth 都可能存在，任一支能解析斜線格式即通過
  const candidates = ['parseDate', 'parseMfgMonth', 'parseOrderMonth'];
  const parsers = candidates.filter((k) => typeof db[k] === 'function');
  // 同上：原本是靜默 return，會讓「一個 parser 都找不到」表現為測試通過。
  if (parsers.length === 0) {
    t.skip('parseDate/parseMfgMonth/parseOrderMonth 皆不存在——本測試未驗證任何東西');
    return;
  }
  const parsed = parsers.map((k) => db[k]('2026/7/15'));
  const ok = parsed.some((v) => v instanceof Date || /^\d{4}-\d{2}/.test(String(v)));
  assert.ok(ok, '斜線日期可解析，實際: ' + JSON.stringify(parsed));
  t.diagnostic('掃描範圍：' + parsers.length + '/' + candidates.length + ' 支 parser（' + parsers.join('、') + '），1 種日期格式 2026/7/15，任一支通過即算過');
});

test('monthly record totals are plausible', (t) => {
  // 每月筆數應 > 0 且無異常巨量（單月上限 5,000 筆為合理天花板）
  const months = Object.keys(data.months);
  assert.ok(months.length >= 3);
  let total = 0;
  for (const key of months) {
    const month = data.months[key];
    const records = month.records || month.rows || [];
    total += records.length;
    assert.ok(records.length > 0, key + ' 有維修紀錄');
    assert.ok(records.length < 5000, key + ' 筆數未超合理上限');
  }
  t.diagnostic('掃描範圍：' + months.length + '/' + months.length + ' 個月份全驗，合計 ' + total + ' 筆；只驗每月筆數落在 (0, 5000)，不驗單筆內容');
});
