// ════════════════════════════════════════════════════════════════════
// Repair Report Parser
// Reads monthly Excel files. Normalizes parts. Stores per-month.
// ════════════════════════════════════════════════════════════════════

(function () {
  const STORAGE_KEY = 'repair_db_v2';

  // ── Column aliases (auto-detect)
  const COL_ALIASES = {
    date:    ['檢修日期', '測試日期', '日期'],
    model:   ['器材品號', '故障品號', '品號', '器材名稱'],
    mfg:     ['製造日期', '生產日期'],
    batch:   ['製令品號', '製令批號', '製令', '批號'],
    serial:  ['機器序號', '產品序號', '序號'],
    reason:  ['故障原因', '報廢內容'],
    content: ['故障內容', '報廢原因'],
    part1:   ['故障零件一', '零件代號'],
    qty1:    ['數量'],
    part2:   ['故障零件二', '故障零件一.1'],
    qty2:    ['數量.1', '數量_1'],
    part3:   ['故障零件三'],
    qty3:    ['數量.2', '數量_2'],
    scrap:   ['是否報廢'],
  };

  // Sheets to skip (not per-model repair data)
  const SKIP_SHEETS = [/^工作表/, /^sheet$/i, /^系品部/];

  // ── Category map (machine model → 大類)
  const CATEGORY_MAP = {
    '監視器':   ['ADR3A08','ADR3A16','AH13A36','AH13B3Z','AH13C36','AH43B3Z','AH83A28','AH83B3Z','AH83D28','AH83D3Z','APCB','AW53B3Z','HU316PE','HU382PE','IP43A3Z','IP43B3Z','IP43C28','IP43D28','IP43L08','IP53C21','IP83B3Z','IPC3A36','IPC3A3Z','IPC3S2W','IPD3F16','LPR3B32','LPR3B3Z','NVR3F08','NVR3G16','NVR3G32','NVR3H16','NVR3I08','POEEXP1','TDB633A','VD43A16'],
    '傳統保全': ['CDRT010','CDRT080','CRS0020','CTMS020','OPI3010','OPT0030','RFSD020','SHT0071','SHT0072','SHT0081','SPC0010','SPM0051','SPM0171','TCNT03D','TPW0010','TPW0050','TSM0030','VTS0010','XRCS-S1','CDRT030','CTM0051','NTS001A','NTS0060','SCX0050','SCX0051','SCX051A','SCA0020','SCL0020','THS0010','THS001A','THSM010','THS0020','THS0030','TLED010','TPAD050','TFM0020','SVAT500','EPES010','PCAS600','CTO0010','CTO0020','CTO0030','SPK011A','TCNT010','TCNT030','SPK009B'],
    '無線保全': ['KDSL7ZB','RFAS010','RFTG030','RL320ZB','ZBDIO90','ZBHD060','ZBIRC5S','ZBPIR50','ZBPIR5P','ZBRT050','ZBSD060','ZBSPC40','ZBTG030','ZBVOS10','ZBVX41T','ZBWD199','ZBWSS20','ZSPMB51','ZSPMG22','ZSPMG51','ZWDIO20','IOT0700','IOT0800','IOT0600','RFDIO10','RFPIR30','RFRT030','RFSPC10','RFSPM21','RFSSL20','RFTM010','RFVX41T','RF11940','RSPM031','RSPMB21','IRL32ZB','ZBACI20','ZBDIO80','ZBIRC50','ZBSSL30','ZCT80VA','ZCTE10A','ZCTE20A','ZSPMB31','ZSPMG31','TPSZB41','TPS041A','TRANS12','XRCSS1','TPS0050'],
    '車機系統': ['MS0M043','MSM0801','MSV0402','MSM0810','MSM1201','MSM1301','MSV0201','MSV0502','TPS0041','TPS0061','TPS0071','TPAD054','TPAD055'],
    'AED':      ['AED0501','AED4G40','AED4G10','AED4G20','AED4G30'],
    '門禁':     ['OPC003C','OPC002C','OPC0050','OPC1050'],
  };

  // ── 品號大類 (component category) — from master 元件料號 catalogue.
  // The first 3 digits of a 品號 (e.g. 2170064 → 217) identify the 大類.
  // Lets us roll fault parts up into component categories for root-cause Pareto.
  const PART_CATEGORY = {
    '3':'半成品', '5':'成品', '6':'回收', '7':'測試',
    '8':'代工', '9':'外包', '101':'電阻', '102':'電晶體',
    '103':'二極體', '104':'基版', '105':'電容', '106':'線圈',
    '107':'積體電路', '108':'繼電器', '109':'保險絲', '110':'開關',
    '111':'顯示器', '112':'端子台', '113':'磁鐵,磁頭', '114':'喇叭蜂鳴器',
    '115':'電池', '116':'排線', '117':'連接器', '118':'POWER',
    '119':'突波,避雷器', '120':'石英振盪器', '121':'貼紙類', '122':'壓克力',
    '123':'面板(PVC)', '124':'隔離柱,墊片,套管', '125':'包裝類', '126':'橡膠類',
    '127':'塑膠類', '128':'五金類', '129':'鐵類', '130':'螺絲類',
    '131':'化學類', '132':'外購基板成品', '133':'外購品維修零件', '134':'外購機構料',
    '139':'虛擬品號', '201':'SMD電阻', '202':'SMD電晶體', '203':'SMD二極體',
    '205':'SMD電容', '206':'SMD線圈', '207':'SMD積體電路', '209':'SMD 保險絲',
    '210':'SMD 開關', '211':'SMD顯示器', '217':'SMD連接器', '219':'突波,避雷器',
    '220':'SMD石英振盪器', '221':'喇叭蜂鳴器麥克風',
  };

  // Resolve a part 品號 (e.g. "2170064" / "217 0064") to its 大類 name.
  function partCategoryByPno(pno) {
    if (!pno) return null;
    const code = String(pno).trim().split(/\s+/)[0];
    if (PART_CATEGORY[code]) return PART_CATEGORY[code];          // exact (whole code is a 大類, rare)
    const m = code.match(/^(\d{3})/);                              // 3-digit prefix
    if (m && PART_CATEGORY[m[1]]) return PART_CATEGORY[m[1]];
    const m2 = code.match(/^(\d)/);                                // 1-digit (半成品/成品/回收…)
    if (m2 && PART_CATEGORY[m2[1]]) return PART_CATEGORY[m2[1]];
    return null;
  }

  function normModel(s) {
    return String(s || '').toUpperCase().replace(/[\s\-_\.()（）]/g, '');
  }

  function getCategory(model) {
    const key = normModel(model);
    for (const [cat, list] of Object.entries(CATEGORY_MAP)) {
      if (list.some(m => normModel(m) === key)) return cat;
    }
    return '其他';
  }

  // Strip leading "001 " / "058 " sheet-local index from codes
  function cleanCode(s) {
    if (!s) return '';
    return String(s).replace(/^\s*\d{3}\s+/, '').trim();
  }

  // Normalize a part name for cross-month/cross-model comparison
  // - Strip leading 3-digit index (sheet-local)
  // - Trim whitespace
  // - Collapse multi-spaces
  // - Uppercase
  function normalizePart(s) {
    if (!s) return '';
    let t = String(s)
      .replace(/^\s*\d{3}\s+/, '')        // "032 LMC-..." → "LMC-..."
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    return t;
  }

  // Parse various date formats to YYYY-MM-DD
  // - 115.04.01 → 2026-04-01 (Taiwan year)
  // - 2026/04/24 → 2026-04-24
  // - 115/4/1 → 2026-04-01
  function parseDate(s) {
    if (!s) return null;
    const str = String(s).trim();
    if (!str) return null;

    // Taiwan year: 1NN.MM.DD or 1NN/M/D (years 100~150 represent 2011~2061)
    let m = str.match(/^(\d{2,3})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    if (m) {
      let y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      if (y < 200) y += 1911;     // Taiwan ROC → AD
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    // Western YYYY/MM/DD or YYYY-MM-DD
    m = str.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
    return null;
  }

  // Normalize manufacture/production date to YYYY-MM (batch month)
  // - 115.03 (ROC year 100~150) → 2026-03
  // - 200111 (AD YYYYMM)          → 2001-11
  // - 20240715 (AD YYYYMMDD)      → 2024-07
  // - 2024/7 / 2024-07            → 2024-07
  // - anything else               → raw (kept so the UI can flag bad data)
  function parseMfgMonth(s) {
    if (s == null) return '';
    const t = String(s).trim();
    if (!t || t === '0') return '';
    let m = t.match(/^(\d{3})[.\/-](\d{1,2})$/);          // ROC 115.03
    if (m) {
      const y = parseInt(m[1], 10);
      if (y >= 100 && y <= 150) return `${y + 1911}-${String(parseInt(m[2],10)).padStart(2,'0')}`;
    }
    m = t.match(/^(\d{4})(\d{2})$/);                       // AD YYYYMM
    if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
    m = t.match(/^(\d{4})(\d{2})\d{2}$/);                  // AD YYYYMMDD
    if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
    m = t.match(/^(\d{4})[.\/-](\d{1,2})/);                // YYYY-MM…
    if (m) return `${m[1]}-${String(parseInt(m[2],10)).padStart(2,'0')}`;
    return t;
  }

  // Extract the ORIGIN (出廠) year-month from a 製令 number.
  // 製令 = the unit's "ID card": YYMMDD + 3-digit batch seq, 2-digit AD year.
  //   191125030 → 2019-11 (batch #030)   250410057 → 2025-04 (batch #057)
  // The 製令 NEVER changes — it marks the original factory batch.
  function parseOrderMonth(s) {
    if (s == null) return '';
    const t = String(s).trim();
    const m = t.match(/^(\d{2})(\d{2})(\d{2})\d{0,3}$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) {
      // pivot：YY < 50 → 20xx（2000–2049），YY >= 50 → 19xx（1950–1999）
      const yy = parseInt(m[1], 10);
      const yyyy = yy < 50 ? 2000 + yy : 1900 + yy;
      return `${yyyy}-${m[2]}`;
    }
    return '';
  }

  // Classify a unit as 全新 (brand new) vs 整新 (refurbished).
  //   製造日期 is re-stamped on refurbishment; 製令 is the original birth batch.
  //   mfg month == origin month → 全新 (never refurbished)
  //   mfg month != origin month → 整新 (re-worked after the original batch)
  // Needs BOTH fields; otherwise condition is unknown ('').
  function classifyCondition(mfgMonth, orderMonth) {
    if (!mfgMonth || !orderMonth) return '';
    return mfgMonth === orderMonth ? '全新' : '整新';
  }

  function findCol(headers, aliases) {
    for (const alias of aliases) {
      const idx = headers.findIndex(h => h && String(h).includes(alias));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  // Parse 故障零件總數 summary sheet to extract:
  // - 整新數 (denominator) per model
  // - month identifier
  // - clean part catalogue (品名 + 規格) per model
  function parseSummarySheet(rows) {
    const denominators = {};   // { MODEL: number }
    const partCatalog = {};    // { MODEL: [{code, name, spec, count, pct}] }
    let monthLabel = null;

    let currentModel = null;
    let inDataBlock = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.map(c => String(c == null ? '' : c).trim());
      const joined = cells.join(' ');

      // Detect model header row: "2026 年 X 月 MODEL 故障零件累計" + "整新數" + number
      const headerMatch = joined.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*([A-Z0-9]{5,10})/i);
      if (headerMatch) {
        const [, year, month, model] = headerMatch;
        if (!monthLabel) monthLabel = `${year}-${String(month).padStart(2,'0')}`;
        // 與 record.model 對齊：去除連字號/底線/空格
        currentModel = model.toUpperCase().replace(/[-_\s]/g, '');
        // Find 整新數
        const denomIdx = cells.findIndex(c => c.includes('整新數'));
        if (denomIdx >= 0 && cells[denomIdx + 1]) {
          const num = parseFloat(cells[denomIdx + 1].replace(/,/g, ''));
          if (!isNaN(num) && num > 0) denominators[currentModel] = num;
        }
        inDataBlock = false;
        partCatalog[currentModel] = [];
        continue;
      }

      // Header row of data block
      if (cells.some(c => c.includes('故障品號') || c.includes('品名'))) {
        inDataBlock = true;
        continue;
      }

      if (inDataBlock && currentModel) {
        // [code, name, spec, qty, pct]
        const [code, name, spec, qty, pct] = cells;
        if (!name && !spec) { inDataBlock = false; continue; }
        const n = parseFloat(qty);
        if (isNaN(n)) continue;
        partCatalog[currentModel].push({
          code: String(code || '').trim(),
          name: String(name || '').trim(),
          spec: String(spec || '').trim(),
          count: n,
          pct: parseFloat(pct) || (denominators[currentModel] ? n / denominators[currentModel] : 0),
        });
      }
    }

    return { denominators, partCatalog, monthLabel };
  }

  // Main: parse workbook into a month-record
  function parseWorkbook(wb, fileName) {
    const records = [];
    const sheetMeta = {};

    // 1) Summary sheet
    let summary = { denominators: {}, partCatalog: {}, monthLabel: null };
    if (wb.Sheets['故障零件總數']) {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets['故障零件總數'], { header: 1, defval: '' });
      summary = parseSummarySheet(raw);
    }

    // 2) Per-model sheets
    wb.SheetNames.forEach(sheetName => {
      if (sheetName === '故障零件總數') return;
      if (SKIP_SHEETS.some(rx => rx.test(sheetName))) return;

      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw.length < 2) return;

      // Find header row
      let headerIdx = -1;
      for (let i = 0; i < Math.min(6, raw.length); i++) {
        const row = raw[i].map(c => String(c));
        if (COL_ALIASES.date.some(a => row.some(c => c.includes(a)))) {
          headerIdx = i; break;
        }
      }
      if (headerIdx < 0) return;

      const headers = raw[headerIdx].map(c => String(c));
      const cols = {};
      for (const [k, aliases] of Object.entries(COL_ALIASES)) cols[k] = findCol(headers, aliases);
      if (cols.date < 0) return;

      const get = (r, c) => (c >= 0 && r[c] !== undefined) ? String(r[c]).trim() : '';

      let sheetRowCount = 0;
      for (let i = headerIdx + 1; i < raw.length; i++) {
        const r = raw[i];
        const dateRaw = get(r, cols.date);
        if (!dateRaw || dateRaw === '0') continue;

        const date = parseDate(dateRaw) || dateRaw;
        const modelRaw = get(r, cols.model) || sheetName;
        const modelDisplay = cleanCode(modelRaw).toUpperCase() || sheetName.toUpperCase();
        // modelKey：去除所有連字號、底線、空格，用於跨資料集 join（分母、排行、批次）
        const model = modelDisplay.replace(/[-_\s]/g, '');
        const reasonRaw = get(r, cols.reason);
        const reason = cleanCode(reasonRaw);
        const content = cleanCode(get(r, cols.content));

        // Scrap detection: 600/報廢 in reason, OR "Y 是" in 是否報廢
        const scrapCol = get(r, cols.scrap);
        const isScrap = /報廢|600|scrap/i.test(reasonRaw) || /^y/i.test(scrapCol);

        const part1 = cleanCode(get(r, cols.part1));
        const part2 = cleanCode(get(r, cols.part2));
        const part3 = cleanCode(get(r, cols.part3));
        const qty1 = parseFloat(get(r, cols.qty1)) || (part1 ? 1 : 0);
        const qty2 = parseFloat(get(r, cols.qty2)) || (part2 ? 1 : 0);
        const qty3 = parseFloat(get(r, cols.qty3)) || (part3 ? 1 : 0);

        const mfg = parseMfgMonth(get(r, cols.mfg));   // 製造/整新年月
        const batch = get(r, cols.batch);               // 製令（出廠身分證）
        const orderMonth = parseOrderMonth(batch);      // 製令→出廠年月
        const condition = classifyCondition(mfg, orderMonth); // 全新/整新/''

        records.push({
          sheet: sheetName,
          date,
          model,          // 正規化 key（無連字號/底線），用於所有 join
          modelDisplay,   // 顯示用（保留原始大小寫與格式）
          modelRaw,
          category: getCategory(model),
          mfg,
          batch,
          orderMonth,
          condition,
          serial: get(r, cols.serial),
          reason,
          reasonRaw,
          content,
          isScrap,
          part1, qty1,
          part2, qty2,
          part3, qty3,
          // Normalized parts (for cross-model/month comparison)
          part1Norm: normalizePart(part1),
          part2Norm: normalizePart(part2),
          part3Norm: normalizePart(part3),
        });
        sheetRowCount++;
      }
      sheetMeta[sheetName] = sheetRowCount;
    });

    // Determine month label
    // Priority: (1) filename "115年 04 月", (2) most-common record date month, (3) summary header, (4) fallback
    let monthLabel = null;

    // (1) Filename
    const fnMatch = fileName.match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月/);
    if (fnMatch) {
      let y = parseInt(fnMatch[1], 10);
      if (y < 200) y += 1911;
      monthLabel = `${y}-${String(fnMatch[2]).padStart(2,'0')}`;
    }

    // (2) Most-common month from record dates (most reliable when filename is generic)
    if (!monthLabel && records.length > 0) {
      const monthCounts = {};
      for (const r of records) {
        if (r.date && /^\d{4}-\d{2}/.test(r.date)) {
          const ym = r.date.substring(0, 7);
          monthCounts[ym] = (monthCounts[ym] || 0) + 1;
        }
      }
      const top = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
      if (top) monthLabel = top[0];
    }

    // (3) Summary sheet header (least reliable — often stale text)
    if (!monthLabel) monthLabel = summary.monthLabel;

    // (4) Last resort
    if (!monthLabel) monthLabel = new Date().toISOString().substring(0, 7);

    return {
      monthLabel,
      fileName,
      uploadedAt: new Date().toISOString(),
      denominators: summary.denominators,
      partCatalog: summary.partCatalog,
      records,
      sheetMeta,
    };
  }

  function parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          resolve(parseWorkbook(wb, file.name));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Storage layer (localStorage, keyed by month)
  // ─────────────────────────────────────────────────────────────────
  function loadDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { months: {} };
      const obj = JSON.parse(raw);
      if (!obj.months) obj.months = {};
      return obj;
    } catch {
      return { months: {} };
    }
  }

  function saveDB(db) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.warn('Storage save failed:', e);
      return false;
    }
  }

  function addMonth(monthData) {
    const db = loadDB();
    db.months[monthData.monthLabel] = monthData;
    saveDB(db);
    return db;
  }

  function removeMonth(monthLabel) {
    const db = loadDB();
    delete db.months[monthLabel];
    saveDB(db);
    return db;
  }

  function clearDB() {
    localStorage.removeItem(STORAGE_KEY);
    return { months: {} };
  }

  // Expose
  window.RepairParser = {
    parseFile,
    parseWorkbook,
    normalizePart,
    parseDate,
    parseMfgMonth,
    parseOrderMonth,
    classifyCondition,
    getCategory,
    partCategoryByPno,
    cleanCode,
    CATEGORY_MAP,
    PART_CATEGORY,
  };

  window.RepairDB = {
    load: loadDB,
    save: saveDB,
    addMonth,
    removeMonth,
    clear: clearDB,
    STORAGE_KEY,
  };
})();
