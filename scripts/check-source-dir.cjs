#!/usr/bin/env node
// Read-only validation used locally and by the source repository after Excel uploads.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const XLSX = require('xlsx');
const M = require('../monthly-source.js');
const privacy = require('../privacy.js');
const dir = path.resolve(process.argv[2] || 'date');
const context = { XLSX, console, localStorage: { getItem: () => null, setItem: () => {} } };
context.window = context;
vm.createContext(context);
for (const file of ['parser.js', 'analyzer.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
(async () => {
  const entries = fs.readdirSync(dir).filter(name => /\.xlsx?$/i.test(name)).map(name => {
    const p = path.join(dir, name), info = fs.lstatSync(p);
    if (!info.isFile()) throw new Error(`只接受一般 Excel 檔案：${name}`);
    const bytes = fs.readFileSync(p);
    return { name, type: 'file', size: bytes.length, sha: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
  });
  const parse = Object.assign((wb, name) => context.RepairParser.parseWorkbook(wb, name), {
    parseRefurbishment: (wb, name, month) => context.RepairParser.parseWirelessOverviewWorkbook(wb, name, month),
  });
  const result = await M.merge({ months: {} }, entries, async f => XLSX.readFile(path.join(dir, f.name), { cellDates: true }), parse);
  const db = privacy.maskData(result.db).masked;
  for (const month of Object.keys(db.months)) context.RepairAnalyzer.detectAnomalies(db, month);
  const summary = ['## Excel 檢查通過', '', '| 月份 | 維修紀錄 |', '|---|---:|',
    ...Object.entries(db.months).map(([m, v]) => `| ${m} | ${v.records.length} |`), '',
    `最新分析月份：${db.sourceImport.latestMonth}`, '',
    `整新故障補充：${Object.values(db.modelSupplements || {}).filter(x => x.sourceType === 'wireless-overview-v1').length} 個機種`, '', ...result.warnings,
    '', '開啟 https://campcool.github.io/TITAN-STAR/ 即會檢查這批 Excel。無須改程式或重新部署。'].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
})().catch(error => {
  const message = privacy.maskText(error.message);
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Excel 檢查未通過\n\n${message}\n\n請修正 Excel 後重新上傳。網站不會套用這批不完整資料。\n`);
  process.exitCode = 1;
});
