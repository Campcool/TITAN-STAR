// ════════════════════════════════════════════════════════════════════
// build-version.mjs — TITAN-STAR 版本字串統一管理
// 每次改版只需執行：node scripts/build-version.mjs <新版本字串>
// 例如：node scripts/build-version.mjs 20260816-1
//
// 一次更新所有版本錨點，避免手動改漏造成快取不一致：
//   1. index.html 內各 <script src="...?v=" 參數
//   2. sw.js 的 CACHE_NAME 與版本註解
//   3. data.json 只讀不寫（publishedAt 由每月 Excel 匯入腳本維護，
//      此腳本故意不動維修資料，避免誤觸 6,587 筆紀錄）
//
// 可逆：git checkout -- index.html sw.js data.json 即可回滾。
// ════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const version = process.argv[2];
if (!/^\d{8}-\d+$/.test(version)) {
  console.error('版本格式必須是 YYYYMMDD-N，例如 20260816-1');
  process.exitCode = 1;
  process.exit();
}

// 1. index.html — 更新 script/css 的 ?v= 參數
const indexPath = path.join(root, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
const countBefore = (indexHtml.match(/\?v=[\w-]+/g) || []).length;
indexHtml = indexHtml.replace(/\?v=[\w.-]+/g, '?v=' + version);
const countAfter = (indexHtml.match(/\?v=[\w-]+/g) || []).length;
if (countBefore !== countAfter) {
  console.error('index.html 版本參數替換前後數量不一致（' + countBefore + ' → ' + countAfter + '），中止');
  process.exitCode = 1;
  process.exit();
}
fs.writeFileSync(indexPath, indexHtml);
console.log('index.html: updated ' + countAfter + ' version parameters to v=' + version);

// 2. sw.js — 更新 CACHE_NAME 與版本註解
const swPath = path.join(root, 'sw.js');
let swJs = fs.readFileSync(swPath, 'utf8');
const cacheBefore = (swJs.match(/titan-star-v[\w.-]+/g) || []).length;
swJs = swJs.replace(/titan-star-v[\w.-]+/g, 'titan-star-v' + version);
const cacheAfter = (swJs.match(/titan-star-v[\w.-]+/g) || []).length;
if (cacheBefore !== cacheAfter) {
  console.error('sw.js CACHE_NAME 替換前後數量不一致，中止');
  process.exitCode = 1;
  process.exit();
}
swJs = swJs.replace(/\/\/ TITAN-STAR Service Worker - v[\w.-]+/, '// TITAN-STAR Service Worker - v' + version);
fs.writeFileSync(swPath, swJs);
console.log('sw.js: CACHE_NAME updated to titan-star-v' + version);

// 3. data.json — 只讀驗證：確認存在且 JSON 有效（不改動任何維修資料）
const dataPath = path.join(root, 'data.json');
let data = fs.readFileSync(dataPath, 'utf8');
try {
  const parsed = JSON.parse(data);
  const monthsCount = Object.keys(parsed.months || {}).length;
  console.log('data.json: valid JSON, months=' + monthsCount + '（publishedAt 由每月匯入腳本維護，此腳本不動它）');
} catch (error) {
  console.error('data.json JSON 解析失敗，停止版本更新');
  process.exitCode = 1;
  process.exit();
}

console.log('Done. 請同步更新 AI-HANDOFF.md 的版本歷史後再 commit。');
