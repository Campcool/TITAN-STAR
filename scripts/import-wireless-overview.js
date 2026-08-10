#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// import-wireless-overview.js
// 匯入「無線多機種整新測試一覽表」Excel 到 data.json 的 modelSupplements。
//
// 來源格式（與單機種 ZBRT050 補充檔不同）：機種為「欄」、指標為「列」的矩陣：
//   機器型號 | ZBDIO90 | ZSPMG51(1.0.9) | ... | 總和
//   整新測試數 / 測試正常數 / 可用率 / 整新故障數 / 故障比例
//   然後是分類故障明細（電器故障類 / 通訊故障類 / 功能故障類 / 其它類）
//
// 產出的每筆 modelSupplements 與單機種版同 schema（sourceType 標為
// wireless-overview-v1 以區分），因此網站現有抽屜/分析函式免改即可讀。
//
// 用法：
//   node scripts/import-wireless-overview.js <file.xlsx> [--dry-run]
//     [--data data.json] [--out data.json] [--month 2026-07]
//     [--keep-existing-supplement]   # 不覆蓋既有單機種補充（預設就會保護）
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { file: null, data: path.join(ROOT, 'data.json'), out: null, dryRun: false, month: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--data') args.data = argv[++i];
    else if (a.startsWith('--data=')) args.data = a.slice(7);
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--month') args.month = argv[++i];
    else if (a.startsWith('--month=')) args.month = a.slice(8);
    else if (!args.file) args.file = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.file) throw new Error('Usage: node scripts/import-wireless-overview.js <file.xlsx> [--dry-run] [--month YYYY-MM]');
  args.file = path.resolve(args.file);
  args.data = path.resolve(args.data);
  args.out = path.resolve(args.out || args.data);
  return args;
}

const s = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
// 去掉變體括號取基礎型號：ZSPMG51(1.0.9) → ZSPMG51
const baseModel = (name) => s(name).replace(/\s*[（(].*$/, '').trim();

// 四個分類標題（非故障項目，須跳過）
const SECTION_HEADERS = ['電器故障類', '通訊故障類', '功能故障類', '其它類', '其他故障類'];

function detectMonth(rows, override) {
  if (override) {
    const m = override.match(/(\d{4})-(\d{2})/);
    if (m) return { month: override, rocMonth: `${Number(m[1]) - 1911}/${Number(m[2])}` };
  }
  // 從標題列找「115年 7 月」
  for (const r of rows.slice(0, 4)) {
    for (const cell of r) {
      const t = s(cell);
      const m = t.match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月/);
      if (m) {
        const roc = Number(m[1]);
        const mm = Number(m[2]);
        return { month: `${roc + 1911}-${String(mm).padStart(2, '0')}`, rocMonth: `${roc}/${mm}` };
      }
    }
  }
  throw new Error('無法從標題列偵測月份（請用 --month YYYY-MM 指定）');
}

function findRow(rows, label) {
  return rows.findIndex(r => r.some(c => s(c) === label));
}

function parseWorkbook(wb, fileName, monthOverride) {
  // 取第一個含「機器型號」列的分頁
  let sheetName = wb.SheetNames.find(sn => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    return rows.some(r => r.some(c => s(c) === '機器型號'));
  });
  if (!sheetName) throw new Error('找不到含「機器型號」表頭的分頁');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

  const { month, rocMonth } = detectMonth(rows, monthOverride);

  const headerIdx = findRow(rows, '機器型號');
  const headerRow = rows[headerIdx];
  // 機種欄：從「機器型號」右邊一欄起，排除空白與「總和/合計」
  const models = [];
  for (let c = 0; c < headerRow.length; c++) {
    const name = s(headerRow[c]);
    if (!name || name === '機器型號') continue;
    if (/^(總和|合計|小計|total)$/i.test(name)) continue;
    models.push({ col: c, name, base: baseModel(name) });
  }
  if (!models.length) throw new Error('機器型號列未找到任何機種欄');

  const rowByLabel = (label) => {
    const idx = findRow(rows, label);
    return idx >= 0 ? rows[idx] : null;
  };
  const rTest = rowByLabel('整新測試數');
  const rPass = rowByLabel('測試正常數');
  const rUsable = rowByLabel('可用率');
  const rFail = rowByLabel('整新故障數');
  const rFaultPct = rowByLabel('故障比例');
  if (!rTest) throw new Error('找不到「整新測試數」列');

  // 故障明細列：介於「故障比例」列與結尾，過濾標題/百分比/空白
  const faultStart = Math.max(
    findRow(rows, '故障比例'),
    findRow(rows, '電器故障類')
  );
  const reasonRows = [];
  for (let i = (faultStart >= 0 ? faultStart : headerIdx) + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = s(r[1]);            // 項次（col B）
    const name = s(r[2]);            // 故障類別名稱（col C）
    if (!name) continue;
    if (SECTION_HEADERS.includes(name)) continue;
    if (name.endsWith('百分比')) continue;    // 百分比子列不計
    // 至少要有一個機種有數字，否則視為空列
    const hasNum = models.some(m => num(r[m.col]) != null);
    if (!hasNum) continue;
    reasonRows.push({ code, reason: name, row: r });
  }

  // 依基礎型號聚合（同基礎多變體 → 同一 entry，變體各一列）
  const byBase = new Map();
  const ensure = (base) => {
    if (!byBase.has(base)) {
      byBase.set(base, {
        sourceType: 'wireless-overview-v1',
        model: base,
        modelDisplay: base,
        sourceFiles: [fileName],
        monthly: [],
        reasons: [],
        annual: [],
        updatedAt: null,
      });
    }
    return byBase.get(base);
  };

  for (const m of models) {
    const refurbished = num(rTest[m.col]);
    if (refurbished == null) continue;       // 無整新測試數 → 跳過該機種
    const entry = ensure(m.base);
    const failedRaw = rFail ? num(rFail[m.col]) : null;
    const faultPct = rFaultPct ? num(rFaultPct[m.col]) : null;
    const usable = rUsable ? num(rUsable[m.col]) : null;
    const passRaw = rPass ? num(rPass[m.col]) : null;
    const failed = failedRaw != null ? Math.round(failedRaw)
      : (faultPct != null ? Math.round(refurbished * faultPct) : 0);
    const passed = passRaw != null ? Math.round(passRaw) : (refurbished - failed);
    entry.monthly.push({
      month, rocMonth,
      model: m.base, modelDisplay: m.name, variant: m.name,
      refurbished,
      passed,
      failed,
      faultRate: faultPct != null ? faultPct : (refurbished ? failed / refurbished : null),
      usableRate: usable != null ? usable : (refurbished ? passed / refurbished : null),
      sourceSheet: sheetName,
    });
    // 該機種所有變體共用 display 若基礎名不同才標
    if (m.name !== m.base && entry.modelDisplay === m.base) entry.modelDisplay = m.base;
  }

  for (const rr of reasonRows) {
    for (const m of models) {
      const cnt = num(rr.row[m.col]);
      if (cnt == null || cnt === 0) continue;
      const entry = byBase.get(m.base);
      if (!entry) continue;               // 該機種無整新測試數 → 略過
      // 用該變體本月故障數當分母算 rateOfFailures
      const mm = entry.monthly.find(x => x.variant === m.name);
      const denom = mm ? mm.failed : 0;
      entry.reasons.push({
        month, rocMonth,
        model: m.base, modelDisplay: m.name, variant: m.name,
        code: rr.code, reason: rr.reason,
        count: Math.round(cnt),
        rateOfFailures: denom ? cnt / denom : null,
        sourceSheet: sheetName,
      });
    }
  }

  const stamp = new Date().toISOString();
  const supplements = [];
  for (const entry of byBase.values()) {
    if (!entry.monthly.length) continue;
    entry.updatedAt = stamp;
    supplements.push(entry);
  }
  return { month, rocMonth, sheetName, models: models.map(m => m.name), supplements };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.file)) throw new Error(`Workbook not found: ${args.file}`);
  const wb = XLSX.readFile(args.file, { cellDates: true });
  const parsed = parseWorkbook(wb, path.basename(args.file), args.month);

  const db = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  db.modelSupplements = db.modelSupplements || {};

  const skipped = [];
  const written = [];
  for (const sup of parsed.supplements) {
    const key = sup.model;
    const existing = db.modelSupplements[key];
    // 保護：若既有的是單機種完整補充（model-supplement-v1），不覆蓋
    if (existing && existing.sourceType === 'model-supplement-v1') {
      skipped.push({ model: key, reason: 'existing model-supplement-v1 (richer), kept' });
      continue;
    }
    db.modelSupplements[key] = sup;
    written.push({
      model: key,
      variants: sup.monthly.length,
      refurbished: sup.monthly.reduce((a, x) => a + (x.refurbished || 0), 0),
      failed: sup.monthly.reduce((a, x) => a + (x.failed || 0), 0),
      reasonRows: sup.reasons.length,
    });
  }

  const result = {
    ok: true,
    dryRun: args.dryRun,
    month: parsed.month,
    sheet: parsed.sheetName,
    modelsInSheet: parsed.models.length,
    written,
    skipped,
    wrote: null,
  };

  if (!args.dryRun) {
    db.publishedAt = new Date().toISOString();
    db.modelSupplementsUpdatedAt = new Date().toISOString();
    fs.writeFileSync(args.out, JSON.stringify(db));
    result.wrote = args.out;
  }
  console.log(JSON.stringify(result, null, 2));
}

try { main(); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
