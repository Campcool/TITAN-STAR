// Shared browser/Node contract: folder discovery, revision selection and atomic import.
(function (root) {
  'use strict';
  const SOURCE = 'https://api.github.com/repos/Campcool/campcool-website/contents/date?ref=main';
  const RAW = 'https://raw.githubusercontent.com/Campcool/campcool-website/main/';
  const VERSION = 1;
  const clone = value => JSON.parse(JSON.stringify(value));
  function monthInfo(name) {
    const m = name.normalize('NFKC').match(/^(\d{2,4})\s*年\s*(\d{1,2})\s*月維修報表(?:[-_\s]*(更正版|修正版|v)(\d*)?)?\.xlsx$/i);
    if (!m) throw new Error(`檔名無法辨識：${name}。請使用「115年 08 月維修報表.xlsx」或「115年 08 月維修報表-更正版.xlsx」。`);
    let year = Number(m[1]);
    if (year < 1911) year += 1911;
    const month = Number(m[2]);
    if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new Error(`檔名年月不正確：${name}`);
    return { month: `${year}-${String(month).padStart(2, '0')}`, revision: m[3] ? Number(m[4] || 1) : 0,
      parserName: `${year - 1911}年 ${String(month).padStart(2, '0')} 月維修報表.xlsx` };
  }
  function selectFiles(entries) {
    if (!Array.isArray(entries) || entries.length >= 1000) throw new Error('無法完整讀取 date 資料夾，請稍後重試或聯絡維護人員。');
    const selected = new Map();
    for (const entry of entries) {
      if (entry.name.startsWith('~$') || !/\.xlsx?$/i.test(entry.name)) continue;
      if (entry.type !== 'file' || !/^[a-f0-9]{40}$/.test(entry.sha || '')) throw new Error(`檔案版本不完整：${entry.name}`);
      if (entry.size > 25 * 1024 * 1024) throw new Error(`檔案超過 25 MB：${entry.name}。請移除圖片與多餘格式後再上傳。`);
      const file = { ...entry, ...monthInfo(entry.name) };
      const old = selected.get(file.month);
      if (old && old.revision === file.revision) throw new Error(`${file.month} 有兩份相同優先序的報表，請只保留一份或使用「更正版2」標示版本。`);
      if (!old || file.revision > old.revision) selected.set(file.month, file);
    }
    if (!selected.size) throw new Error('date 資料夾沒有可用的月份 Excel，保留上一版資料。');
    return [...selected.values()].sort((a, b) => a.month.localeCompare(b.month));
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const d = new Date(value + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function validate(month, file) {
    if (month.monthLabel !== file.month || !month.records?.length) throw new Error(`${file.name} 沒有解析到正確月份的維修資料。`);
    const errors = [];
    for (const issue of month.importIssues || []) errors.push(issue);
    month.records.forEach((r, i) => {
      const where = `${r.sheet || '工作表'} 第 ${r.sourceRow || i + 1} 列`;
      if (!validDate(r.date)) errors.push(`${where}：日期不正確`);
      if (!r.model) errors.push(`${where}：缺少型號`);
      for (const key of ['qty1', 'qty2', 'qty3']) if (r[key] != null && (!Number.isFinite(r[key]) || r[key] < 0)) errors.push(`${where}：零件數量不可為負數或非數字`);
    });
    if (errors.length) throw new Error(`${file.name}：${errors.slice(0, 5).join('；')}${errors.length > 5 ? `；另有 ${errors.length - 5} 項` : ''}`);
    const inMonth = month.records.filter(r => r.date.startsWith(file.month)).length;
    if (inMonth < month.records.length / 2) throw new Error(`${file.name}：多數維修日期不在 ${file.month}，請確認不是把舊報表改名。`);
    return inMonth === month.records.length ? [] : [`${file.month} 有 ${month.records.length - inMonth} 筆跨月維修日期，仍依報表月份歸屬。`];
  }
  // Deliberately no persistence here. A failed file leaves the original object untouched.
  async function merge(db, entries, readWorkbook, parseWorkbook, onProgress = () => {}) {
    const files = selectFiles(entries);
    const previous = db.sourceImport?.version === VERSION ? db.sourceImport.files || {} : {};
    for (const [month, old] of Object.entries(previous)) {
      const file = files.find(f => f.month === month);
      if (!file) throw new Error(`${month} 的來源 Excel 被移除。請放回 date 資料夾，避免遺失歷史月份。`);
      if (file.revision < old.revision) throw new Error(`${month} 的更正版被移除，請放回相同或較新的版本。`);
    }
    const next = clone(db);
    next.months ||= {};
    const manifest = {};
    const warnings = [];
    let updated = 0;
    for (const file of files) {
      if (!next.months[file.month] || previous[file.month]?.sha !== file.sha) {
        onProgress(`正在讀取 ${file.name}`);
        const wb = await readWorkbook(file);
        const month = parseWorkbook(wb, file.parserName);
        warnings.push(...validate(month, file));
        month.fileName = file.name;
        next.months[file.month] = month;
        updated++;
      } else warnings.push(...(previous[file.month].warnings || []));
      manifest[file.month] = { name: file.name, sha: file.sha, revision: file.revision,
        warnings: warnings.filter(w => w.startsWith(file.month)) };
    }
    next.sourceImport = { version: VERSION, files: manifest, checkedAt: new Date().toISOString(),
      latestMonth: Object.keys(next.months).sort().pop(), warnings };
    return { db: next, updated, warnings, files: files.length };
  }
  async function request(url, fetcher) {
    const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429
      ? 'GitHub 暫時限制查詢次數，請稍後按「檢查更新」。上一版資料仍可使用。'
      : `讀取來源失敗（HTTP ${response.status}），請確認 date 資料夾及網路連線。`);
    return response;
  }
  async function gitHash(buffer) {
    const bytes = new Uint8Array(buffer);
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const content = new Uint8Array(header.length + bytes.length);
    content.set(header); content.set(bytes, header.length);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-1', content))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function sync(db, { fetcher = fetch, xlsx = root.XLSX, parser = root.RepairParser, onProgress } = {}) {
    const entries = await (await request(SOURCE, fetcher)).json();
    return merge(db, entries, async file => {
      if (!xlsx || !parser) throw new Error('Excel 解析器尚未載入，請確認網路後重試。');
      const url = RAW + 'date/' + encodeURIComponent(file.name);
      const buffer = await (await request(url, fetcher)).arrayBuffer();
      if (await gitHash(buffer) !== file.sha) throw new Error(`${file.name} 正在更新或快取尚未同步，請稍後重新檢查。`);
      return xlsx.read(buffer, { type: 'array', cellDates: true });
    }, (wb, name) => parser.parseWorkbook(wb, name), onProgress);
  }
  function calendarPrevious(month) {
    if (!month) return null;
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  function range(months, count) {
    const sorted = [...months].sort();
    if (!sorted.length || count === 'all') return sorted;
    let start = sorted[sorted.length - 1];
    for (let i = 1; i < Number(count); i++) start = calendarPrevious(start);
    return sorted.filter(m => m >= start);
  }
  root.RepairMonthlySource = { sync, merge, selectFiles, monthInfo, validate, calendarPrevious, range, gitHash };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RepairMonthlySource;
})(typeof window !== 'undefined' ? window : globalThis);
