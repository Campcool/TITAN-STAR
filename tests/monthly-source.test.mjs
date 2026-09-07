import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../monthly-source.js');
const XLSX = require('xlsx');
const privacy = require('../privacy.js');
const context = { XLSX, console, localStorage: { getItem: () => null, setItem: () => {} } };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../parser.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../analyzer.js', import.meta.url), 'utf8'), context);
const parser = Object.assign((wb, name) => context.RepairParser.parseWorkbook(wb, name), {
  parseRefurbishment: (wb, name, month) => context.RepairParser.parseWirelessOverviewWorkbook(wb, name, month),
});
const entry = (month, revision = '', sha = 'a'.repeat(40)) => ({ name: `115年 ${month} 月維修報表${revision}.xlsx`, type: 'file', sha, size: 1024 });
const refurbEntry = (month, revision = '', sha = 'c'.repeat(40)) => ({ name: `115年${Number(month)}月整新故障${revision}.xlsx`, type: 'file', sha, size: 1024 });
function workbook(date = '2026/08/03', rows = 1, header = '檢修日期') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[header, '器材品號', '故障原因', '故障零件一', '數量'],
    ...Array.from({ length: rows }, () => [date, 'TEST01', '測試故障', '測試零件', 1])]), 'TEST01');
  return wb;
}
function refurbishmentWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['', '', '', '115年 8 月整新機器與數量'],
    [], ['', '', '機器型號', 'TEST01(1.0)', 'TEST01(2.0)'],
    ['', '', '整新測試數', 100, 50], ['', '', '測試正常數', 90, 45],
    ['', '', '可用率', .9, .9], ['', '', '整新故障數', 10, 5], ['', '', '故障比例', .1, .1],
    ['', '', '電器故障類'], ['', '1', '電源不良', 6, 2], ['', '2', '通訊不良', 4, 3],
  ]), '整新故障一覽表');
  return wb;
}
test('new month, revision, unchanged cache, and historical metadata survive atomically', async t => {
  const original = { months: { '2026-07': { records: [{ model: 'OLD' }] } }, modelSupplements: { TEST: { value: 7 } } };
  let reads = 0;
  const first = await M.merge(original, [entry('08')], async () => { reads++; return workbook(); }, parser);
  assert.equal(first.updated, 1); assert.equal(first.db.months['2026-08'].records.length, 1);
  assert.deepEqual(first.db.modelSupplements, original.modelSupplements);
  assert.equal(original.months['2026-08'], undefined);
  const again = await M.merge(first.db, [entry('08')], async () => { throw Error('must not download'); }, parser);
  assert.equal(again.updated, 0); assert.equal(reads, 1);
  const corrected = await M.merge(first.db, [entry('08'), entry('08', '-更正版', 'b'.repeat(40))], async () => workbook('2026/08/03', 2), parser);
  assert.equal(corrected.db.months['2026-08'].records.length, 2);
  assert.equal(corrected.db.months['2026-07'].records.length, 1);
  t.diagnostic('Verified initial import, unchanged file, corrected replacement and preserved history/supplements.');
});
test('duplicate revisions, invalid filename/month, deletion and revision downgrade fail', async () => {
  assert.throws(() => M.selectFiles([entry('13')]), /年月/);
  assert.throws(() => M.selectFiles([entry('08'), { ...entry('08'), name: '115年 8 月維修報表.xlsx' }]), /兩份/);
  assert.throws(() => M.selectFiles([{ ...entry('08'), name: '最新.xlsx' }]), /檔名/);
  const first = await M.merge({ months: {} }, [entry('08', '-更正版')], async () => workbook(), parser);
  await assert.rejects(M.merge(first.db, [entry('09')], async () => workbook(), parser), /移除/);
  await assert.rejects(M.merge(first.db, [entry('08')], async () => workbook(), parser), /更正版被移除/);
  assert.equal(M.monthInfo('116年 01 月維修報表-更正版2.xlsx').month, '2027-01');
  assert.equal(M.monthInfo('115年8月整新故障.xlsx').kind, 'refurbishment');
});
test('repair and refurbishment workbooks import together from one folder', async () => {
  const dateCell = new Date(2026, 7, 3);
  const result = await M.merge({ months: {} }, [entry('08'), refurbEntry('08')],
    async file => file.kind === 'repair' ? workbook(dateCell, 2) : refurbishmentWorkbook(), parser);
  assert.equal(result.files, 2);
  assert.equal(result.db.months['2026-08'].records.length, 2);
  assert.equal(result.db.months['2026-08'].records[0].date, '2026-08-03');
  assert.equal(result.db.modelSupplements.TEST01.monthly.length, 2);
  assert.equal(result.db.modelSupplements.TEST01.monthly.reduce((s, x) => s + x.refurbished, 0), 150);
  assert.equal(result.db.sourceImport.files['refurbishment:2026-08'].kind, 'refurbishment');
});
test('one corrupt month aborts batch without mutating last valid database', async () => {
  const db = { months: {}, marker: 'keep' };
  await assert.rejects(M.merge(db, [entry('08'), entry('09')], async f => workbook(f.month === '2026-08' ? '2026/08/03' : 'bad-date'), parser), /日期/);
  assert.deepEqual(db, { months: {}, marker: 'keep' });
  await assert.rejects(M.merge(db, [entry('08')], async () => workbook('2026/08/03', 3, '不認識的欄位'), parser), /資料/);
  await assert.rejects(M.merge(db, [entry('08')], async () => workbook('2026/07/03'), parser), /舊報表改名/);
});
test('calendar ranges handle gaps and year transitions without inventing zero months', () => {
  assert.equal(M.calendarPrevious('2027-01'), '2026-12');
  assert.deepEqual(M.range(['2026-02', '2026-06', '2026-08'], 3), ['2026-06', '2026-08']);
  assert.deepEqual(M.range(['2026-12', '2027-01'], 1), ['2027-01']);
});
test('trend and common-model calculations respect the same selected months', () => {
  const db = { months: {
    '2026-06': parser(workbook('2026/06/03', 2), '115年 06 月維修報表.xlsx'),
    '2026-07': parser(workbook('2026/07/03', 4), '115年 07 月維修報表.xlsx'),
    '2026-09': parser(workbook('2026/09/03', 6), '115年 09 月維修報表.xlsx'),
  } };
  const trend = context.RepairAnalyzer.monthlyTrend(db, { months: ['2026-07', '2026-09'] }, { commonOnly: true });
  assert.equal(JSON.stringify(trend.map(t => [t.month, t.count])), JSON.stringify([['2026-07', 4], ['2026-09', 6]]));
  const anomalies = context.RepairAnalyzer.detectAnomalies(db, '2026-09');
  assert.ok(Array.isArray(anomalies));
});
test('real workbook validates all records and feeds the existing analyzer', async t => {
  const wb = XLSX.readFile(new URL('../monthly-reports/115年 06 月維修報表.xlsx', import.meta.url), { cellDates: true });
  const result = await M.merge({ months: {} }, [entry('06')], async () => wb, parser);
  assert.equal(result.db.months['2026-06'].records.length, 1222);
  const records = context.RepairAnalyzer.getRecords(result.db, {});
  assert.equal(records.length, 1222);
  assert.ok(context.RepairAnalyzer.computeKPIs(records, context.RepairAnalyzer.getDenominators(result.db, {})));
  t.diagnostic('Validated all 1,222 real June records, including dates and quantities.');
});
test('browser sync verifies Git blob SHA and reports API failure without partial update', async () => {
  const bytes = XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' });
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(await M.gitHash(bytes), sha);
  const fetcher = async url => url.includes('api.github.com')
    ? new Response(JSON.stringify([entry('08', '', sha)])) : new Response(bytes);
  const db = { months: {} };
  const result = await M.sync(db, { fetcher, xlsx: XLSX, parser: context.RepairParser });
  assert.equal(result.db.sourceImport.latestMonth, '2026-08');
  await assert.rejects(M.sync(db, { fetcher: async () => new Response('', { status: 403 }) }), /限制/);
  await assert.rejects(M.sync(db, { fetcher: async url => url.includes('api.github.com') ? new Response(JSON.stringify([entry('08')])) : new Response(bytes), xlsx: XLSX, parser: context.RepairParser }), /正在更新/);
  assert.deepEqual(db, { months: {} });
});
test('browser and CLI use one masking policy for both keys and values', () => {
  const masked = privacy.maskData({ months: { test: { sheetMeta: { '立保保全': 2 }, records: [{ reason: '中保', technician: '' }] } }, users: { x: { name: '陳測試' } } }).masked;
  assert.equal(privacy.findLeaks(JSON.stringify(masked)).length, 0);
  assert.equal(masked.users.x.name, '陳');
});
