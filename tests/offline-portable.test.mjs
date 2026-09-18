// TITAN-STAR 離線可攜性測試
// 用途：保證「把資料夾（或單一 TITAN-STAR.html）複製到另一台沒有網路的電腦，
// 雙擊就能用」這件事不會被日後的改動悄悄弄壞。
// 執行：node --test tests/offline-portable.test.mjs
//
// 背景（2026-09-18）：使用者把檔案複製給同事，對方打不開。三個原因：
//   1. 圖表與 Excel 解析（Chart.js / SheetJS）是從 cdn.jsdelivr.net 載的，沒網路就沒有；
//   2. 資料是 fetch('./data.json')，而瀏覽器禁止 file:// 頁面 fetch 同目錄檔案
//      （"URL scheme file is not supported"），所以離線開啟時是一個空殼；
//   3. 字體與 Service Worker 的請求在離線時只會卡住與噴錯。
// 修法：函式庫自帶在 vendor/、單檔版由 build.js 內嵌資料、index.html 在
// file:// 時轉去單檔版。以下每一條都對應其中一項，壞掉要能紅燈。
//
// ── 撰寫規則：取樣範圍必須印出來 ──（同 data-integrity.test.mjs 檔頭）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const VENDOR_FILES = [
  'chart.umd.js',
  'xlsx.full.min.js',
  'hammer.min.js',
  'chartjs-plugin-zoom.min.js',
  'chartjs-plugin-annotation.min.js',
];

test('index.html 不從任何外部網域載入 script', (t) => {
  const html = read('index.html');
  const external = html.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || [];
  t.diagnostic(`掃描 index.html 全文 ${html.length} 字元，外部 script 標籤 ${external.length} 個`);
  assert.deepEqual(external, [],
    '外部 CDN 會讓離線副本沒有圖表／不能匯入 Excel，也會讓分頁卡在連線逾時');
});

test('index.html 引用的 vendor 檔案都真的存在', (t) => {
  const html = read('index.html');
  for (const name of VENDOR_FILES) {
    assert.match(html, new RegExp(`<script src="vendor/${name.replace(/\./g, '\\.')}\\?v=`),
      `index.html 應該引用 vendor/${name}`);
    const size = fs.statSync(path.join(root, 'vendor', name)).size;
    assert.ok(size > 1000, `vendor/${name} 看起來是空的或截斷（${size} bytes）`);
  }
  t.diagnostic(`驗了 ${VENDOR_FILES.length} 支自帶函式庫，全部存在且有內容`);
});

test('index.html 在 file:// 時轉去單檔版', (t) => {
  const html = read('index.html');
  assert.match(html, /<script data-file-redirect>[\s\S]*location\.protocol === 'file:'[\s\S]*TITAN-STAR\.html/,
    'file:// 直接開 index.html 會因為無法 fetch data.json 而是空殼，必須轉去內嵌資料的單檔版');
  const head = html.slice(0, html.indexOf('</head>'));
  const redirectAt = head.indexOf('data-file-redirect');
  const firstVendorAt = head.indexOf('<script src="vendor/');
  t.diagnostic(`轉址在 head 第 ${redirectAt} 字元，第一支 vendor 在第 ${firstVendorAt} 字元`);
  assert.ok(redirectAt > -1 && redirectAt < firstVendorAt,
    '轉址要排在 vendor/ 那 1.2MB 之前，不然會先把用不到的函式庫讀完才轉走');
});

test('Google Fonts 與 Service Worker 都跳過 file://', (t) => {
  const html = read('index.html');
  assert.ok(!/<link[^>]+fonts\.googleapis\.com/.test(html),
    'Google Fonts 不可以寫死成 <link>：離線時會卡連線逾時。應由 JS 判斷協定後動態插入');
  assert.match(html, /if \(location\.protocol === 'file:'\) return;[\s\S]*fonts\.googleapis\.com/,
    'Google Fonts 應該只在 http(s) 載入');
  assert.match(html, /location\.protocol !== 'file:' && 'serviceWorker' in navigator/,
    'file:// 註冊 SW 必定失敗，只會在 console 留看不懂的錯誤');
  t.diagnostic('檢查了字體載入與 SW 註冊兩處協定判斷');
});

test('styles.css 的字體堆疊有系統中文 fallback', (t) => {
  const css = read('styles.css');
  assert.match(css, /--cjk-fallback:[^;]*Microsoft JhengHei/, 'Windows 要落到微軟正黑體');
  assert.match(css, /--cjk-fallback:[^;]*PingFang TC/, 'macOS/iOS 要落到蘋方');
  for (const v of ['--sans', '--friendly']) {
    assert.match(css, new RegExp(`\\${v}:[^;]*var\\(--cjk-fallback\\)`),
      `${v} 要接上 --cjk-fallback，離線沒有 Google Fonts 時才不會掉成細明體`);
  }
  t.diagnostic('驗了 --sans 與 --friendly 兩組字體堆疊');
});

test('app.js 在 file:// 時改讀內嵌資料、且不去掃 GitHub 的 date 資料夾', (t) => {
  const js = read('app.js');
  assert.match(js, /async function loadCloudPayload\(\)[\s\S]*location\.protocol === 'file:'[\s\S]*__TITAN_EMBEDDED_DB__/,
    'file:// 無法 fetch data.json，必須改讀 window.__TITAN_EMBEDDED_DB__');
  assert.match(js, /async function syncMonthlyWorkbook\(\)\s*\{[\s\S]{0,600}?location\.protocol === 'file:'/,
    '離線副本不該去打 api.github.com，否則會出現看起來像壞掉的紅色錯誤列');
  t.diagnostic('驗了 loadCloudPayload 與 syncMonthlyWorkbook 兩處離線分支');
});

test('TITAN-STAR.html 單檔版自給自足：內嵌資料、內嵌函式庫、零外部請求', (t) => {
  const bundle = read('TITAN-STAR.html');
  const externalScripts = bundle.match(/<script[^>]+src="[^"]+"/g) || [];
  assert.deepEqual(externalScripts, [],
    '單檔版不能有任何 <script src>，複製出去就只有這一個檔案');
  assert.ok(bundle.includes('window.__TITAN_EMBEDDED_DB__'), '單檔版必須內嵌 data.json');
  assert.ok(!bundle.includes('data-file-redirect'),
    '單檔版不該保留轉址，否則會轉到自己');

  // 內嵌的資料要和 data.json 是同一份（build.js 沒跑就會不一致）
  const data = JSON.parse(read('data.json'));
  const months = Object.keys(data.months || {}).sort();
  for (const m of months) {
    assert.ok(bundle.includes(`"${m}"`), `單檔版少了 ${m} 的資料，請重跑 node build.js`);
  }
  const sizeMB = (Buffer.byteLength(bundle, 'utf8') / 1024 / 1024).toFixed(1);
  t.diagnostic(`單檔版 ${sizeMB} MB，內嵌 ${months.length} 個月份（${months[0]} ~ ${months[months.length - 1]}）` +
               `與 ${VENDOR_FILES.length} 支函式庫`);
});

test('Pages 發布清單含 vendor/ 但不含 vendor/README.md', (t) => {
  const sh = read('scripts/prepare-pages-artifact.sh');
  assert.match(sh, /'\/vendor\/\*\.js'/, 'vendor/*.js 要進 Pages artifact，否則線上版載不到函式庫');
  assert.match(sh, /'vendor\/README\.md'/, 'vendor/README.md 是內部文件，不該發布');
  t.diagnostic('檢查了 public_rules 與 denied_paths 各一條');
});
