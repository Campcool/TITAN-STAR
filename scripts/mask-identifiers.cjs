#!/usr/bin/env node
// mask-identifiers.mjs — 去識別化：公司名稱遮罩 + 使用者姓名只留姓氏
//
// 為什麼需要這支：本站部署在公開的 GitHub Pages 上，data.json 不需登入即可
// 下載（見 AI-HANDOFF「公開曝光現況」）。因此凡是會寫進 data.json 的
// 可識別資訊，都必須在寫入前先去識別化。
//
// ⚠️ 這支必須在「匯入流程之後、寫檔之前」被呼叫，不能只當一次性清理工具。
// 月報表 Excel 的分頁名稱本身就是「立保保全」，只清理現有 data.json 的話，
// 下個月匯入就會把原名寫回來。
//
// 用法：
//   import { maskText, maskData } from './mask-identifiers.mjs'  （匯入流程用）
//   node scripts/mask-identifiers.mjs --apply                    （清理現有 data.json）
//   node scripts/mask-identifiers.mjs --check                    （CI 用，發現殘留即 exit 1）

const fs = require('node:fs');
const path = require('node:path');

// 公司／客戶名稱：遮第二個字。
// 用兩字前綴而非完整名稱，因為資料裡有大量「裸露前綴」——2026-08-17 實測
// data.json 內「中保」出現 27 次但完整名稱只有 6 次，其餘 21 次是
// 「中保LOGO貼紙」這類寫法。只遮完整名稱會漏掉三分之二。
const COMPANY_MASKS = [
  ['中保', '中O'],
  ['立偉', '立O'],
  ['多瑪', '多O'],
  ['立保', '立O'],
];

/** 遮罩單一字串內的公司名稱。 */
function maskText(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [from, to] of COMPANY_MASKS) out = out.split(from).join(to);
  return out;
}

/** 姓名只留姓氏。複姓不在此處理——需要時請加白名單，不要用字數猜。 */
function maskName(name) {
  if (typeof name !== 'string' || !name) return name;
  return [...name][0];
}

/**
 * 深層遮罩整份資料，回傳新的結構（不修改傳入物件）。
 *
 * ⚠️ 必須同時處理物件的「鍵」與「值」。初版只走 records / partsMaster / users
 * 三處的值，漏掉了 `months.<月>.sheetMeta` —— 那裡公司名稱是物件的**鍵**
 * （`sheetMeta['立保保全']`），4 處全數逃過。改為通用遞迴後，日後新增任何
 * 結構都會自動涵蓋，不需要再回來補這支函式。
 */
function maskData(data) {
  const stats = { values: 0, keys: 0, names: 0, sheets: new Set() };

  const walk = (node) => {
    if (typeof node === 'string') {
      const masked = maskText(node);
      if (masked !== node) stats.values++;
      return masked;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [key, value] of Object.entries(node)) {
        const maskedKey = maskText(key);
        if (maskedKey !== key) { stats.keys++; stats.sheets.add(maskedKey); }
        out[maskedKey] = walk(value);
      }
      return out;
    }
    return node;
  };

  const masked = walk(data);

  // 姓名另外處理：只留姓氏，不是字串取代
  for (const user of Object.values(masked.users || {})) {
    if (!user || typeof user.name !== 'string') continue;
    const surname = maskName(user.name);
    if (surname !== user.name) { user.name = surname; stats.names++; }
  }

  return { masked, stats };
}

/** 找出仍未遮罩的原始字串。回傳 [{ where, term, count }]。 */
function findLeaks(text) {
  const leaks = [];
  for (const [from] of COMPANY_MASKS) {
    const count = text.split(from).length - 1;
    if (count) leaks.push({ term: from, count });
  }
  return leaks;
}

// ── CLI ──────────────────────────────────────────────────────────
const isMain = require.main === module;
if (isMain && process.argv.length > 2) {
  const root = path.resolve(__dirname, '..');
  const target = path.join(root, 'data.json');
  const mode = process.argv[2];

  if (mode === '--check') {
    // 掃全部會被公開部署的檔案，不只 data.json
    const files = ['data.json', 'analyzer.js', 'app.js', 'parser.js', 'index.html', 'AI-HANDOFF.md', 'README.md'];
    let fail = 0;
    const scanned = [];
    for (const f of files) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) continue;
      scanned.push(f);
      const leaks = findLeaks(fs.readFileSync(p, 'utf8'));
      for (const { term, count } of leaks) {
        console.error('✗ ' + f + ' 殘留未遮罩名稱「' + term + '」 ' + count + ' 處');
        fail++;
      }
    }
    // 姓名：data.json 的 users.name 一律只能 1 字
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    for (const [id, u] of Object.entries(data.users || {})) {
      if (u && typeof u.name === 'string' && [...u.name].length > 1) {
        console.error('✗ data.json users.' + id + '.name 是全名「' + u.name + '」，應只留姓氏');
        fail++;
      }
    }
    if (fail) {
      console.error('\n❌ ' + fail + ' 項未去識別化。掃描範圍：' + scanned.join('、')
        + ' 共 ' + scanned.length + ' 個檔案 + data.json 的 ' + Object.keys(data.users || {}).length + ' 個帳號');
      process.exit(1);
    }
    console.log('✓ 去識別化檢查通過。掃描範圍：' + scanned.join('、') + ' 共 ' + scanned.length
      + ' 個檔案（' + COMPANY_MASKS.length + ' 組公司名稱）＋ data.json 的 '
      + Object.keys(data.users || {}).length + ' 個帳號姓名');
  } else if (mode === '--apply') {
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    const { masked, stats } = maskData(data);
    fs.writeFileSync(target, JSON.stringify(masked));
    console.log('✓ data.json 已遮罩：'
      + stats.values + ' 個字串值、'
      + stats.keys + ' 個物件鍵、'
      + stats.names + ' 個姓名');
    if (stats.sheets.size) console.log('  受影響的鍵名：' + [...stats.sheets].join('、'));
  } else {
    console.error('用法：node scripts/mask-identifiers.mjs [--apply|--check]');
    process.exit(2);
  }
}

module.exports = { COMPANY_MASKS, maskText, maskName, maskData, findLeaks };
