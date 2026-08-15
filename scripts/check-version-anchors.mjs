// check-version-anchors.mjs — 驗證版本錨點一致性
// 線上版靠 index.html 的 ?v= 參數＋sw.js 的 CACHE_NAME 雙重快取管理，
// 兩者版本字串必須一致，否則部分瀏覽器會拿到新 HTML＋舊 data.json。
// 執行：node scripts/check-version-anchors.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

const vParams = [...indexHtml.matchAll(/\?v=([\w.-]+)/g)].map((m) => m[1]);
const cacheNames = [...swJs.matchAll(/titan-star-v([\w.-]+)/g)].map((m) => m[1]);

const errors = [];
if (vParams.length === 0) errors.push('index.html 找不到 ?v= 版本參數');
if (cacheNames.length === 0) errors.push('sw.js 找不到 CACHE_NAME 版本字串');
const vSet = new Set(vParams);
if (vSet.size > 1) errors.push('index.html 內有多個不同 ?v= 參數: ' + [...vSet].join(', '));
const cSet = new Set(cacheNames);
if (cSet.size > 1) errors.push('sw.js 內有多個不同 CACHE_NAME: ' + [...cSet].join(', '));
const v = vSet.size === 1 ? [...vSet][0] : null;
const c = cSet.size === 1 ? [...cSet][0] : null;
if (v && c && v !== c) errors.push('?v= (' + v + ') 與 sw.js CACHE_NAME (titan-star-v' + c + ') 不一致 — 請執行 node scripts/build-version.mjs <YYYYMMDD-N>');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Version anchors consistent: v=' + v + ', CACHE_NAME=titan-star-v' + c);
}
