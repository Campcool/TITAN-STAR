#!/usr/bin/env node
// Import a per-model supplemental workbook into data.json.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { file: null, data: path.join(ROOT, 'data.json'), out: null, dryRun: false, python: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--data') args.data = argv[++i];
    else if (a.startsWith('--data=')) args.data = a.slice(7);
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--python') args.python = argv[++i];
    else if (a.startsWith('--python=')) args.python = a.slice(9);
    else if (!args.file) args.file = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.file) throw new Error('Usage: node scripts/import-model-supplement.js <model-summary.xlsx> [--dry-run] [--python <python.exe>]');
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

function loadParser() {
  installBrowserGlobals();
  const code = fs.readFileSync(path.join(ROOT, 'parser.js'), 'utf8');
  vm.runInThisContext(code, { filename: 'parser.js' });
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
      global.XLSX = {
        utils: {
          sheet_to_json(sheet) {
            return sheet && Array.isArray(sheet.__rows) ? sheet.__rows : [];
          },
        },
      };
      return JSON.parse(stdout);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Unable to read workbook. Install npm dependency "xlsx" or provide Python with openpyxl. Last error: ${lastErr && lastErr.message}`);
}

function loadWorkbook(filePath, explicitPython) {
  return loadWorkbookWithSheetJs(filePath) || loadWorkbookWithPython(filePath, explicitPython);
}

function mergeSupplement(db, imported) {
  if (!db.months) db.months = {};
  if (!db.modelSupplements) db.modelSupplements = {};
  const mergedModels = [];
  for (const [model, supplement] of Object.entries(imported.modelSupplements || {})) {
    db.modelSupplements[model] = supplement;
    mergedModels.push(model);
  }
  db.publishedAt = new Date().toISOString();
  return mergedModels;
}

function summarizeSupplement(supplement) {
  const monthly = supplement.monthly || [];
  const reasons = supplement.reasons || [];
  const refurbished = monthly.reduce((s, x) => s + (Number(x.refurbished) || 0), 0);
  const failed = monthly.reduce((s, x) => s + (Number(x.failed) || 0), 0);
  const latest = monthly.slice().sort((a, b) => a.month.localeCompare(b.month)).pop() || null;
  const topReasons = reasons.reduce((map, x) => {
    const key = `${x.code || ''} ${x.reason || ''}`.trim() || '未分類';
    map[key] = (map[key] || 0) + (Number(x.count) || 0);
    return map;
  }, {});
  return {
    monthlyPoints: monthly.length,
    reasonPoints: reasons.length,
    refurbished,
    failed,
    faultRate: refurbished ? failed / refurbished : null,
    latest,
    topReasons: Object.entries(topReasons).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.file)) throw new Error(`Workbook not found: ${args.file}`);
  loadParser();
  const wb = loadWorkbook(args.file, args.python);
  const imported = global.RepairParser.parseModelSupplementWorkbook(wb, path.basename(args.file));
  const models = Object.keys(imported.modelSupplements || {});
  if (!models.length) throw new Error('No model supplemental data detected.');

  const db = fs.existsSync(args.data) ? JSON.parse(fs.readFileSync(args.data, 'utf8')) : { months: {} };
  const mergedModels = mergeSupplement(db, imported);
  if (!args.dryRun) fs.writeFileSync(args.out, JSON.stringify(db), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    wrote: args.dryRun ? null : args.out,
    models: mergedModels.map(model => ({
      model,
      ...summarizeSupplement(imported.modelSupplements[model]),
    })),
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
