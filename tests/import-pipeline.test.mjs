// TITAN-STAR Excel 匯入管線測試
// 用途：確保每月作業「Excel → import-month.js → data.json」這條管線在
//   CI 上可重複驗證，避免解析器改版後靜默產出壞結構。
// 執行：node --test tests/import-pipeline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.join(root, 'monthly-reports', '115年 06 月維修報表.xlsx');
const tmpData = path.join(root, '.test-import-out.json');

function runImport(fixturePath, dataPath, extraArgs = []) {
  return JSON.parse(
    execFileSync(process.execPath, ['scripts/import-month.js', fixturePath, `--data=${dataPath}`, ...extraArgs], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env },
    }),
  );
}

test('import-month.js dry-run on real monthly workbook produces month label', () => {
  const res = runImport(fixture, tmpData, ['--dry-run']);
  assert.equal(res.ok, true, 'dry-run 應回報 ok');
  assert.equal(res.dryRun, true);
  assert.equal(res.import.month, '2026-06');
  assert.ok(res.import.records >= 1000, `06 月應有千筆級維修記錄（實得 ${res.import.records}）`);
});

test('imported month data structure survives analyzer pipeline', () => {
  const res = runImport(fixture, tmpData, ['--dry-run']);
  // afterSummary 由 RepairAnalyzer 對合併後資料跑一遍產出，
  // 若 parser 與 analyzer 介面脫節會在這裡爆掉
  assert.ok(Array.isArray(res.after.months), 'afterSummary.months 是陣列');
  assert.ok(res.after.months.includes('2026-06'), '合併後含 2026-06');
  assert.ok(res.after.kpis, 'KPI 計算產出存在');
  assert.ok(Array.isArray(res.after.trend) && res.after.trend.length > 0, '月度趨勢非空');
  assert.ok(Array.isArray(res.after.topModels) && res.after.topModels.length > 0, 'topModels 非空');
});

test('import writes valid merged data.json with updated publishedAt', () => {
  // 使用副本寫入，驗證實際寫檔路徑不會壞
  const backup = path.join(root, '.test-data-backup.json');
  fs.copyFileSync(path.join(root, 'data.json'), backup);
  try {
    const out = path.join(root, '.test-write-out.json');
    const res = runImport(fixture, out, [`--out=${out}`]);
    assert.equal(res.wrote, out);
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(written.months['2026-06'], '寫入副本含 2026-06 月份');
    assert.equal(written.months['2026-06'].records.length, res.import.records);
    assert.match(written.publishedAt, /^\d{4}-\d{2}-\d{2}T/, 'publishedAt 已更新為 ISO');
  } finally {
    fs.copyFileSync(backup, path.join(root, 'data.json'));
    fs.rmSync(backup);
    fs.rmSync(path.join(root, '.test-write-out.json'), { force: true });
    fs.rmSync(tmpData, { force: true });
  }
});

test('import fails loudly on broken workbook', () => {
  // 防假綠：餵一個損壞的 xlsx，必須非零 exit
  const broken = path.join(root, '.test-broken.xlsx');
  fs.writeFileSync(broken, 'this is not an xlsx');
  let threw = false;
  try {
    runImport(broken, tmpData, ['--dry-run']);
  } catch {
    threw = true;
  } finally {
    fs.rmSync(broken, { force: true });
    fs.rmSync(tmpData, { force: true });
  }
  assert.ok(threw, '損壞 workbook 應讓 import 腳本丟出錯誤');
});
