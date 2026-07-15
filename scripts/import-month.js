#!/usr/bin/env node
// Import a monthly repair workbook into data.json using the same parser as the browser app.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { file: null, data: path.join(ROOT, 'data.json'), out: null, dryRun: false, python: null, publishedBy: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--data') args.data = argv[++i];
    else if (a.startsWith('--data=')) args.data = a.slice(7);
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--python') args.python = argv[++i];
    else if (a.startsWith('--python=')) args.python = a.slice(9);
    else if (a === '--published-by') args.publishedBy = argv[++i] || '';
    else if (a.startsWith('--published-by=')) args.publishedBy = a.slice(15);
    else if (!args.file) args.file = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.file) throw new Error('Usage: node scripts/import-month.js <monthly.xlsx> [--dry-run] [--python <python.exe>]');
  args.file = path.resolve(args.file);
  args.data = path.resolve(args.data);
  args.out = path.resolve(args.out || args.data);
  return args;
}

function installBrowserGlobals() {
  global.window = global;
  global.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
}

function loadAppModules() {
  installBrowserGlobals();
  for (const name of ['parser.js', 'analyzer.js']) {
    const code = fs.readFileSync(path.join(ROOT, name), 'utf8');
    vm.runInThisContext(code, { filename: name });
  }
}

function loadWorkbookWithSheetJs(filePath) {
  try {
    const XLSX = require('xlsx');
    global.XLSX = XLSX;
    return XLSX.readFile(filePath, { cellDates: true });
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

function pythonWorkbookScript() {
  return String.raw`
import datetime, json, sys
import openpyxl

def cell_value(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y/%m/%d")
    if isinstance(v, datetime.date):
        return v.strftime("%Y/%m/%d")
    return v

wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
payload = {"SheetNames": wb.sheetnames, "Sheets": {}}
for ws in wb.worksheets:
    rows = []
    max_col = ws.max_column or 0
    for row in ws.iter_rows(values_only=True):
        rows.append([cell_value(v) for v in list(row[:max_col])])
    payload["Sheets"][ws.title] = {"__rows": rows}
sys.stdout.write(json.dumps(payload, ensure_ascii=False))
`;
}

function pythonCandidates(explicit) {
  const out = [];
  if (explicit) out.push({ cmd: explicit, args: [] });
  if (process.env.PYTHON) out.push({ cmd: process.env.PYTHON, args: [] });
  out.push({ cmd: 'python', args: [] });
  out.push({ cmd: 'python3', args: [] });
  if (process.platform === 'win32') out.push({ cmd: 'py', args: ['-3'] });
  return out;
}

function loadWorkbookWithPython(filePath, explicitPython) {
  const script = pythonWorkbookScript();
  let lastErr = null;
  for (const candidate of pythonCandidates(explicitPython)) {
    try {
      const stdout = execFileSync(candidate.cmd, [...candidate.args, '-c', script, filePath], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        maxBuffer: 200 * 1024 * 1024,
      });
      const wb = JSON.parse(stdout);
      global.XLSX = {
        utils: {
          sheet_to_json(sheet) {
            return sheet && Array.isArray(sheet.__rows) ? sheet.__rows : [];
          },
        },
      };
      return { wb, reader: `${candidate.cmd}${candidate.args.length ? ' ' + candidate.args.join(' ') : ''} + openpyxl` };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Unable to read workbook. Install npm dependency "xlsx" or provide Python with openpyxl. Last error: ${lastErr && lastErr.message}`);
}

function loadWorkbook(filePath, explicitPython) {
  const sheetJsWb = loadWorkbookWithSheetJs(filePath);
  if (sheetJsWb) return { wb: sheetJsWb, reader: 'xlsx' };
  return loadWorkbookWithPython(filePath, explicitPython);
}

function cloneJson(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function summarize(db, latestMonth) {
  const A = global.RepairAnalyzer;
  const months = Object.keys(db.months || {}).sort();
  const records = A.getRecords(db, { months });
  const denom = A.getDenominators(db, { months });
  const kpis = A.computeKPIs(records, denom);
  const trend = A.monthlyTrend(db, {}).map(t => ({
    month: t.month,
    count: t.count,
    scrap: t.scrap,
    scrapPct: +t.scrapPct.toFixed(2),
    denom: t.denom,
    faultPct: t.faultPct == null ? null : +t.faultPct.toFixed(2),
  }));
  const topModels = A.modelRank(records, denom, db, months).slice(0, 8).map(m => ({
    model: m.model,
    count: m.count,
    scrap: m.scrap,
    scrapPct: +(m.scrapPct * 100).toFixed(1),
    denom: m.denom,
    faultPct: m.faultRate == null ? null : +(m.faultRate * 100).toFixed(1),
  }));
  const topParts = A.partPareto(records).slice(0, 8).map(p => ({
    part: p.name,
    count: p.count,
    models: p.models.length,
    pct: +(p.pct * 100).toFixed(1),
  }));
  const anomalies = latestMonth ? A.detectAnomalies(db, latestMonth).slice(0, 12).map(a => ({
    severity: a.severity,
    type: a.type,
    subject: a.subject,
    message: a.message,
  })) : [];
  return { months, kpis, trend, topModels, topParts, anomalies };
}

function validateMonth(monthData) {
  if (!monthData || !monthData.monthLabel) throw new Error('Parser did not produce a month label.');
  if (!monthData.records || monthData.records.length === 0) throw new Error('Parser produced zero repair records.');
  const badDates = monthData.records.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))).length;
  const missingModel = monthData.records.filter(r => !r.model).length;
  return {
    month: monthData.monthLabel,
    records: monthData.records.length,
    denominators: Object.keys(monthData.denominators || {}).length,
    partCatalogModels: Object.keys(monthData.partCatalog || {}).length,
    sheets: monthData.sheetMeta || {},
    badDates,
    missingModel,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.file)) throw new Error(`Workbook not found: ${args.file}`);
  loadAppModules();

  const { wb, reader } = loadWorkbook(args.file, args.python);
  const monthData = global.RepairParser.parseWorkbook(wb, path.basename(args.file));
  const importCheck = validateMonth(monthData);

  const existing = fs.existsSync(args.data) ? JSON.parse(fs.readFileSync(args.data, 'utf8')) : { months: {} };
  if (!existing.months) existing.months = {};
  const before = cloneJson(existing);
  delete before.months[monthData.monthLabel];

  const merged = cloneJson(existing);
  merged.months[monthData.monthLabel] = monthData;
  merged.publishedAt = new Date().toISOString();
  if (args.publishedBy) merged.publishedBy = args.publishedBy;

  const beforeSummary = summarize(before, Object.keys(before.months || {}).sort().pop());
  const afterSummary = summarize(merged, monthData.monthLabel);

  if (!args.dryRun) {
    fs.writeFileSync(args.out, JSON.stringify(merged), 'utf8');
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    reader,
    wrote: args.dryRun ? null : args.out,
    import: importCheck,
    before: beforeSummary,
    after: afterSummary,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
