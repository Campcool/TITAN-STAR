/**
 * 建立 TITAN-STAR 維修記錄標準 Excel 模板 v3
 * 執行：node build-template.js
 * 輸出：TITAN-STAR-維修記錄模板.xlsx
 *
 * v3 改版重點：
 * - 機種清冊工作表：所有已知品號 + 留白供新品號填入，下拉選單從此工作表讀取
 * - 故障原因改為10大類下拉選單，杜絕自由文字亂填
 * - 第2列縮短為極簡提示（≤8字），詳細說明移至說明工作表
 * - 必填欄位加入中文錯誤提示框，格式錯誤即彈出
 * - 製令品號加入9位數格式驗證
 * - 料號大類自動帶出（VLOOKUP）
 * - 下拉選單全部改中文選項，消除填寫錯誤
 */

const XLSX = require('xlsx');
const path = require('path');

// ─── 全品項機種清冊（對應 parser.js CATEGORY_MAP）─────────────────
const MODEL_LIST = {
  '監視器': [
    'ADR3A08','ADR3A16','AH13A36','AH13B3Z','AH13C36','AH43B3Z',
    'AH83A28','AH83B3Z','AH83D28','AH83D3Z','APCB','AW53B3Z',
    'HU316PE','HU382PE','IP43A3Z','IP43B3Z','IP43C28','IP43D28',
    'IP43L08','IP53C21','IP83B3Z','IPC3A36','IPC3A3Z','IPC3S2W',
    'IPD3F16','LPR3B32','LPR3B3Z','NVR3F08','NVR3G16','NVR3G32',
    'NVR3H16','NVR3I08','POEEXP1','TDB633A','VD43A16',
  ],
  '傳統保全': [
    'CDRT010','CDRT030','CDRT080','CRS0020','CTM0051','CTMS020',
    'CTO0010','CTO0020','CTO0030','EPES010','NTS001A','NTS0060',
    'OPI3010','OPT0030','PCAS600','RFSD020','SCA0020','SCL0020',
    'SCX0050','SCX0051','SCX051A','SHT0071','SHT0072','SHT0081',
    'SPC0010','SPK009B','SPK011A','SPM0051','SPM0171','SVAT500',
    'TCNT010','TCNT030','TCNT03D','TFM0020','THS0010','THS001A',
    'THS0020','THS0030','THSM010','TLED010','TPAD050','TPW0010',
    'TPW0050','TSM0030','VTS0010','XRCS-S1',
  ],
  '無線保全': [
    'IOT0600','IOT0700','IOT0800','IRL32ZB','KDSL7ZB','RFAS010',
    'RFDIO10','RFPIR30','RFRT030','RFSPC10','RFSPM21','RFSSL20',
    'RFTG030','RFTM010','RFVX41T','RF11940','RL320ZB','RSPM031',
    'RSPMB21','TPS0050','TPS041A','TPSZB41','TRANS12','XRCSS1',
    'ZBACI20','ZBDIO80','ZBDIO90','ZBHD060','ZBIRC50','ZBIRC5S',
    'ZBPIR50','ZBPIR5P','ZBRT050','ZBSD060','ZBSPC40','ZBSSL30',
    'ZBTG030','ZBVOS10','ZBVX41T','ZBWD199','ZBWSS20','ZCT80VA',
    'ZCTE10A','ZCTE20A','ZSPMB31','ZSPMB51','ZSPMG22','ZSPMG31',
    'ZSPMG51','ZWDIO20',
  ],
  '車機系統': [
    'MS0M043','MSM0801','MSM0810','MSM1201','MSM1301',
    'MSV0201','MSV0402','MSV0502','TPS0041','TPS0061','TPS0071',
    'TPAD054','TPAD055',
  ],
  'AED': ['AED0501','AED4G10','AED4G20','AED4G30','AED4G40'],
  '門禁': ['OPC002C','OPC003C','OPC0050','OPC1050'],
};

// ─── 料號大類對照（與 parser.js 同步）────────────────────────────
const PART_CATEGORY = {
  '3':'半成品', '5':'成品', '6':'回收', '7':'測試', '8':'代工', '9':'外包',
  '101':'電阻', '102':'電晶體', '103':'二極體', '104':'基版', '105':'電容',
  '106':'線圈', '107':'積體電路', '108':'繼電器', '109':'保險絲', '110':'開關',
  '111':'顯示器', '112':'端子台', '113':'磁鐵/磁頭', '114':'喇叭蜂鳴器',
  '115':'電池', '116':'排線', '117':'連接器', '118':'POWER電源',
  '119':'突波/避雷器', '120':'石英振盪器', '121':'貼紙類', '122':'壓克力',
  '123':'面板(PVC)', '124':'隔離柱/墊片/套管', '125':'包裝類', '126':'橡膠類',
  '127':'塑膠類', '128':'五金類', '129':'鐵類', '130':'螺絲類',
  '131':'化學類', '132':'外購基板成品', '133':'外購品維修零件', '134':'外購機構料',
  '139':'虛擬品號',
  '201':'SMD電阻', '202':'SMD電晶體', '203':'SMD二極體', '205':'SMD電容',
  '206':'SMD線圈', '207':'SMD積體電路', '209':'SMD保險絲', '210':'SMD開關',
  '211':'SMD顯示器', '217':'SMD連接器', '219':'SMD突波/避雷器',
  '220':'SMD石英振盪器', '221':'喇叭蜂鳴器/麥克風',
};

// 故障原因固定10大類
const FAULT_TYPES = [
  '電源系統','主板PCB','顯示螢幕','儲存記憶',
  '感測鏡頭','機構外觀','通訊網路','韌體軟體',
  '運輸損傷','電磁靜電',
];

// ─── 欄位定義 ─────────────────────────────────────────────────────
// type: 'lookup'=公式自動帶出  required/important 同舊版
// hint: 極簡提示（第2列，≤8字）
// dropdown: 固定選項陣列（inline）
// dropdownSheet: 從機種清冊讀取（用公式範圍）
// validate: 額外驗證規則 { type, operator, formula1, formula2, showErrorMessage, errorTitle, error }
const COLUMNS = [

  // ══ A 基本識別 ═══════════════════════════════════════════════════
  { header:'★ 接收日期',  key:'recv_date',    width:13, required:true,
    hint:'送修到廠的日期',
    example:'2026/04/13',
    validate:{ type:'date', operator:'greaterThan', formula1:'DATE(2020,1,1)',
      showErrorMessage:true, errorTitle:'日期格式錯誤',
      error:'請填寫正確日期，格式 YYYY/MM/DD，例如 2026/04/13' } },

  { header:'★ 檢修日期',  key:'date',         width:13, required:true,
    hint:'完成維修的日期',
    example:'2026/04/15',
    validate:{ type:'date', operator:'greaterThan', formula1:'DATE(2020,1,1)',
      showErrorMessage:true, errorTitle:'日期格式錯誤',
      error:'請填寫正確日期，格式 YYYY/MM/DD，例如 2026/04/15' } },

  { header:'★ 器材品號',  key:'model',        width:14, required:true,
    hint:'從下拉選擇；新品號可直接輸入',
    example:'MSM0801',
    dropdownSheet: true,  // 參照機種清冊工作表
    validate:{ type:'list', showErrorMessage:false,
      errorTitle:'品號不在清單中',
      error:'此品號不在機種清冊，請確認後輸入，或至「機種清冊」工作表新增此品號' } },

  { header:'★ 機器序號',  key:'serial',       width:15, required:true,
    hint:'機器唯一序號(SN)',
    example:'SN20250001' },

  // ══ B 製令 / 責任判定 ════════════════════════════════════════════
  { header:'☆ 製令品號',  key:'batch',        width:16, important:true,
    hint:'9位數字，解鎖責任分析',
    example:'250410057',
    validate:{ type:'textLength', operator:'equal', formula1:'9',
      showErrorMessage:true, errorTitle:'製令品號格式錯誤',
      error:'製令品號必須是9位數字（格式 YYMMDD+3碼序號），例如：250410057' } },

  { header:'☆ 製造日期',  key:'mfg',          width:13, important:true,
    hint:'機器標籤上的製造日期',
    example:'2025/04/10' },

  // ══ C 來源 ═══════════════════════════════════════════════════════
  { header:'來源類型',    key:'source_type',  width:13,
    hint:'選擇維修來源',
    example:'客戶退修',
    dropdown:['客戶退修','整新流程','內部品管','保固換修','其他'] },

  { header:'保固狀態',    key:'warranty',     width:11,
    hint:'是否在保固期內',
    example:'保固外',
    dropdown:['保固內','保固外','不明'] },

  { header:'外觀損傷',    key:'cosmetic_dmg', width:11,
    hint:'是否有人為損傷',
    example:'無',
    dropdown:['無','輕微','明顯'] },

  // ══ D 故障描述 ═══════════════════════════════════════════════════
  { header:'★ 故障原因',  key:'reason',       width:14, required:true,
    hint:'從下拉選擇大類',
    example:'電源系統',
    dropdown: FAULT_TYPES,
    validate:{ type:'list', showErrorMessage:true,
      errorTitle:'請從下拉選擇',
      error:'請點選欄位右側的下拉箭頭，選擇故障原因大類（共10類）' } },

  { header:'★ 故障內容',  key:'content',      width:42, required:true,
    hint:'詳述現象與換件',
    example:'無法開機，電源板輸出電壓異常，換電源模組後正常' },

  { header:'故障再現性',  key:'reproducible', width:14,
    hint:'故障能否在廠重現',
    example:'可重現',
    dropdown:['可重現','間歇性','NTF(無法重現)'] },

  // ══ E 維修用料 ═══════════════════════════════════════════════════
  { header:'☆ 故障零件一', key:'part1',       width:18, important:true,
    hint:'換件料號或零件名稱',
    example:'1180042' },

  { header:'  零件一大類', key:'part1_cat',   width:14, type:'lookup',
    hint:'(自動帶出，勿修改)',
    example:'(自動)' },

  { header:'☆ 數量一',    key:'qty1',        width:8, important:true,
    hint:'換件數量',
    example:'1' },

  { header:'故障零件二',  key:'part2',        width:18,
    hint:'第二換件料號',
    example:'' },

  { header:'  零件二大類', key:'part2_cat',   width:14, type:'lookup',
    hint:'(自動帶出)',
    example:'(自動)' },

  { header:'數量二',      key:'qty2',         width:8,
    hint:'數量',
    example:'' },

  { header:'故障零件三',  key:'part3',        width:18,
    hint:'第三換件料號',
    example:'' },

  { header:'  零件三大類', key:'part3_cat',   width:14, type:'lookup',
    hint:'(自動帶出)',
    example:'(自動)' },

  { header:'數量三',      key:'qty3',         width:8,
    hint:'數量',
    example:'' },

  // ══ F 維修結果 ═══════════════════════════════════════════════════
  { header:'維修方式',    key:'repair_method', width:14,
    hint:'選擇主要維修手段',
    example:'換件修復',
    dropdown:['換件修復','軟體/韌體更新','清潔調整','整機更換','無法修復','其他'] },

  { header:'★ 是否報廢',  key:'scrap',        width:10, required:true,
    hint:'Y=報廢 N=維修完成',
    example:'N',
    dropdown:['N','Y'],
    validate:{ type:'list', showErrorMessage:true,
      errorTitle:'請選擇Y或N',
      error:'請點下拉選擇：N=維修完成  Y=報廢' } },

  { header:'測試結果',    key:'test_result',  width:12,
    hint:'出廠前測試狀態',
    example:'通過',
    dropdown:['通過','失敗','待觀察'] },

  // ══ G 進階追蹤（選填）══════════════════════════════════════════════
  { header:'韌體版本',    key:'fw_version',   width:12,
    hint:'如 v2.3.1',
    example:'v2.3.1' },

  { header:'維修技師',    key:'technician',   width:11,
    hint:'姓名或工號',
    example:'王大明' },

  { header:'維修工時(h)', key:'labor_hours',  width:13,
    hint:'小時，如 1.5',
    example:'1.5' },

  { header:'備註',        key:'note',         width:35,
    hint:'其他說明',
    example:'' },
];

// ─── 工具函數 ─────────────────────────────────────────────────────
function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

function findColIdx(key) {
  return COLUMNS.findIndex(c => c.key === key);
}

function lookupFormula(partColLetter, rowNum) {
  const pno = `${partColLetter}${rowNum}`;
  return [
    `=IFERROR(`,
      `VLOOKUP(VALUE(LEFT(${pno},3)),料號對照!$A:$B,2,0),`,
      `IFERROR(`,
        `VLOOKUP(VALUE(LEFT(${pno},1)),料號對照!$A:$B,2,0),`,
        `""`,
      `)`,
    `)`,
  ].join('');
}

// ─── 機種清冊工作表 ──────────────────────────────────────────────
// 返回模型列表起始行號，以及最後一行（用於 dropdown 公式）
function buildModelSheet(wb) {
  const ws = {};
  const R = (r, c) => XLSX.utils.encode_cell({ r, c });

  let row = 0;

  // 說明標題
  ws[R(row, 0)] = { v: '【機種清冊】系統下拉選單來源 — 可隨時在各大類下方新增品號', t: 's' };
  ws[R(row, 1)] = { v: '', t: 's' };
  row++;
  ws[R(row, 0)] = { v: '大類', t: 's' };
  ws[R(row, 1)] = { v: '品號（器材品號）', t: 's' };
  ws[R(row, 2)] = { v: '備註（可填機種名稱、型號說明）', t: 's' };
  row++;

  const DATA_START_ROW = row; // 0-based, 此行開始是實際品號資料

  let totalModels = 0;

  for (const [cat, models] of Object.entries(MODEL_LIST)) {
    // 大類標題行
    ws[R(row, 0)] = { v: `── ${cat} ──`, t: 's' };
    ws[R(row, 1)] = { v: '', t: 's' };
    row++;

    for (const m of models) {
      ws[R(row, 0)] = { v: cat,  t: 's' };
      ws[R(row, 1)] = { v: m,   t: 's' };
      ws[R(row, 2)] = { v: '',  t: 's' };
      row++;
      totalModels++;
    }

    // 每個大類後保留 10 列空白供新增
    for (let i = 0; i < 10; i++) {
      ws[R(row, 0)] = { v: cat, t: 's' };
      ws[R(row, 1)] = { v: `← 在此輸入新品號（${cat}）`, t: 's' };
      ws[R(row, 2)] = { v: '', t: 's' };
      row++;
    }
  }

  // 末尾保留大塊空白（其他類）
  for (let i = 0; i < 20; i++) {
    ws[R(row, 0)] = { v: '其他', t: 's' };
    ws[R(row, 1)] = { v: '← 輸入不屬於以上大類的新品號', t: 's' };
    ws[R(row, 2)] = { v: '', t: 's' };
    row++;
  }

  const DATA_END_ROW = row - 1; // 0-based

  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:row,c:2} });
  ws['!cols'] = [{ wch:14 }, { wch:20 }, { wch:30 }];

  XLSX.utils.book_append_sheet(wb, ws, '機種清冊');

  // 返回品號欄的範圍（1-based row for Excel formulas）
  return {
    start: DATA_START_ROW + 1, // 1-based
    end:   DATA_END_ROW   + 1, // 1-based
    total: totalModels,
  };
}

// ─── 料號對照工作表 ──────────────────────────────────────────────
function buildPartLookupSheet(wb) {
  const ws = {};
  const R = (r, c) => XLSX.utils.encode_cell({ r, c });

  // 表頭
  ws[R(0,0)] = { v:'代碼前綴(數字)', t:'s' };
  ws[R(0,1)] = { v:'大類名稱', t:'s' };

  const rows = Object.entries(PART_CATEGORY)
    .map(([code, name]) => [parseInt(code,10), name])
    .sort((a,b) => a[0]-b[0]);

  rows.forEach(([code, name], ri) => {
    ws[R(ri+1, 0)] = { v: code, t: 'n' };
    ws[R(ri+1, 1)] = { v: name, t: 's' };
  });

  // 完整BOM區
  const bomStart = rows.length + 4;
  ws[R(bomStart,   0)] = { v:'────完整料號清冊（從ERP貼入，解鎖精確品名顯示）────', t:'s' };
  ws[R(bomStart+1, 0)] = { v:'完整料號', t:'s' };
  ws[R(bomStart+1, 1)] = { v:'品名', t:'s' };
  ws[R(bomStart+1, 2)] = { v:'規格/說明', t:'s' };
  for (let i = 0; i < 3; i++) {
    ws[R(bomStart+2+i, 0)] = { v:'(從ERP匯出後貼入此區)', t:'s' };
  }

  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:bomStart+52, c:2} });
  ws['!cols'] = [{ wch:16 }, { wch:22 }, { wch:30 }];

  XLSX.utils.book_append_sheet(wb, ws, '料號對照');
}

// ─── 維修記錄主工作表 ─────────────────────────────────────────────
function buildRepairSheet(wb, modelRange) {
  const ws = {};

  const HDR_ROW     = 1;  // 1-based: 標題列（有★☆符號）
  const HINT_ROW    = 2;  // 極簡提示
  const EXAMPLE_ROW = 3;  // 範例資料（灰色，可刪）
  const DATA_START  = 4;  // 第4列起填資料
  const DATA_ROWS   = 500;

  const R = (r, c) => XLSX.utils.encode_cell({ r: r-1, c });

  const part1Idx    = findColIdx('part1');
  const part2Idx    = findColIdx('part2');
  const part3Idx    = findColIdx('part3');
  const part1CatIdx = findColIdx('part1_cat');
  const part2CatIdx = findColIdx('part2_cat');
  const part3CatIdx = findColIdx('part3_cat');

  // ── 第1列：標題 ──
  COLUMNS.forEach((col, i) => {
    ws[R(HDR_ROW, i)] = { v: col.header, t: 's' };
  });

  // ── 第2列：極簡提示 ──
  COLUMNS.forEach((col, i) => {
    ws[R(HINT_ROW, i)] = { v: col.hint, t: 's' };
  });

  // ── 第3列：範例資料 ──
  COLUMNS.forEach((col, i) => {
    ws[R(EXAMPLE_ROW, i)] = { v: col.example, t: 's' };
  });

  // ── 第4列起：資料行 ──
  for (let row = DATA_START; row < DATA_START + DATA_ROWS; row++) {
    COLUMNS.forEach((col, i) => {
      if (col.type === 'lookup') {
        let srcIdx = -1;
        if (i === part1CatIdx) srcIdx = part1Idx;
        else if (i === part2CatIdx) srcIdx = part2Idx;
        else if (i === part3CatIdx) srcIdx = part3Idx;
        if (srcIdx >= 0) {
          ws[R(row, i)] = { f: lookupFormula(colLetter(srcIdx), row), t: 's' };
        }
      }
      // 其他欄位留空白（不設預設值）
    });
  }

  // ── 工作表範圍 ──
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r:0, c:0 },
    e: { r: DATA_START + DATA_ROWS - 2, c: COLUMNS.length - 1 },
  });

  // ── 欄寬 ──
  ws['!cols'] = COLUMNS.map(c => ({ wch: c.width }));

  // ── 凍結前3列＋前4欄（接收日期/檢修日期/器材品號/序號） ──
  ws['!freeze'] = { xSplit: 4, ySplit: 3 };

  // ── 資料驗證 ──
  const dvs = [];

  COLUMNS.forEach((col, i) => {
    const startCell = `${colLetter(i)}${DATA_START}`;
    const endCell   = `${colLetter(i)}${DATA_START + DATA_ROWS - 1}`;
    const sqref     = `${startCell}:${endCell}`;

    if (col.dropdownSheet && modelRange) {
      // 器材品號：從機種清冊工作表的B欄讀取
      dvs.push({
        type: 'list',
        formula1: `機種清冊!$B$${modelRange.start}:$B$${modelRange.end}`,
        sqref,
        showErrorMessage: false,  // 警告模式：新品號可通過
        errorTitle: '品號不在清單中',
        error: '此品號不在機種清冊，請確認後輸入，或至「機種清冊」工作表新增',
      });
    } else if (col.dropdown) {
      dvs.push({
        type: 'list',
        formula1: `"${col.dropdown.join(',')}"`,
        sqref,
        showErrorMessage: col.validate?.showErrorMessage ?? false,
        errorTitle: col.validate?.errorTitle ?? '',
        error: col.validate?.error ?? '',
      });
    } else if (col.validate && col.validate.type !== 'list') {
      dvs.push({
        ...col.validate,
        sqref,
      });
    }
  });

  if (dvs.length) ws['!dataValidation'] = dvs;

  XLSX.utils.book_append_sheet(wb, ws, '維修記錄');
}

// ─── 系品彙總工作表 ──────────────────────────────────────────────
function buildSummarySheet(wb) {
  const ws = {};
  const R = (r, c) => XLSX.utils.encode_cell({ r: r-1, c: c-1 });

  const headers = ['系品大類','器材品號','月份','整新出廠數量'];
  const hints   = ['如：車機系統','如：MSM0801','格式 YYYY-MM','當月整新出廠總數'];
  headers.forEach((h,i) => ws[R(1,i+1)] = { v:h, t:'s' });
  hints.forEach((n,i)   => ws[R(2,i+1)] = { v:n, t:'s' });

  const demo = [
    ['車機系統','MSM0801','2026-04',120],
    ['車機系統','MSM1201','2026-04', 85],
    ['監視器',  'IP43A3Z','2026-04', 60],
    ['傳統保全','SPM0051','2026-04', 45],
  ];
  demo.forEach((row,ri) => row.forEach((val,ci) => {
    ws[R(3+ri, ci+1)] = { v:val, t: typeof val==='number'?'n':'s' };
  }));

  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:25,c:3} });
  ws['!cols'] = [{ wch:14 }, { wch:16 }, { wch:12 }, { wch:14 }];
  XLSX.utils.book_append_sheet(wb, ws, '系品彙總');
}

// ─── 說明工作表 ──────────────────────────────────────────────────
function buildGuideSheet(wb) {
  const rows = [
    ['TITAN-STAR 維修記錄填寫說明 v3'],
    [''],
    ['★ 必填（共6欄）：接收日期、檢修日期、器材品號、機器序號、故障原因、故障內容、是否報廢'],
    ['☆ 重要（強烈建議填）：製令品號、製造日期、故障零件一、數量一'],
    ['  選填：其餘欄位，有填有對應進階分析'],
    [''],
    ['─────────────────────────────────────────────'],
    ['【器材品號】'],
    ['  點選欄位後，右側會出現下拉箭頭，從清單選擇品號。'],
    ['  若本月維修品項清單沒有，直接輸入品號即可（系統接受新品號）。'],
    ['  如需讓新品號出現在下拉清單，請至「機種清冊」工作表，在對應大類下方空白列填入品號。'],
    [''],
    ['【製令品號格式】'],
    ['  格式：YYMMDD + 3碼序號 = 共9位數字'],
    ['  範例：250410057 = 2025年04月10日、第057批次'],
    ['  ※ 格式不對系統會彈出提示，請修正後繼續'],
    [''],
    ['【故障原因（10大類）】'],
    ['  電源系統  → 無法開機、電壓異常、過熱、電源板故障'],
    ['  主板PCB   → 主機板故障、元件損壞、電路短路'],
    ['  顯示螢幕  → 不顯示、黑屏、顯示異常'],
    ['  儲存記憶  → SD卡、硬碟、記憶體、資料遺失'],
    ['  感測鏡頭  → 攝影機、PIR感測、麥克風故障'],
    ['  機構外觀  → 外殼破裂、按鍵失效、接頭鬆動'],
    ['  通訊網路  → 網路斷線、Wi-Fi/藍牙、通訊模組'],
    ['  韌體軟體  → 當機、更新失敗、功能異常'],
    ['  運輸損傷  → 外包裝完整但內部受損、掉落撞傷'],
    ['  電磁靜電  → ESD靜電、雷擊突波、EMI干擾'],
    [''],
    ['【料號自動帶出】'],
    ['  「故障零件一/二/三」填入料號（如 2170064），'],
    ['  右側「大類」欄自動顯示名稱（如「SMD連接器」）。'],
    ['  若要顯示完整品名，請將ERP料號清冊貼入「料號對照」工作表的指定區域。'],
    [''],
    ['【NTF（無法重現）說明】'],
    ['  故障再現性選「NTF(無法重現)」表示在廠內無法重現客戶反映的問題。'],
    ['  NTF比例高（>15%）代表診斷流程或客戶操作問題，QA應追蹤改善。'],
    [''],
    ['【每月上傳步驟】'],
    ['  1. 月底確認所有維修紀錄填寫完整（特別注意製令品號欄）'],
    ['  2. 存檔（建議命名：2026-04 維修記錄.xlsx）'],
    ['  3. 開啟 TITAN-STAR → 上傳/管理 → 拖曳上傳'],
    ['  4. 系統自動解析，確認月份標籤正確即完成'],
  ];

  const ws = {};
  rows.forEach((row, ri) => {
    ws[XLSX.utils.encode_cell({r:ri, c:0})] = { v: row[0] ?? '', t: 's' };
  });
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rows.length, c:0} });
  ws['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ws, '說明');
}

// ─── 主程式 ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

// 注意順序：機種清冊要先建，才能取得 modelRange 給維修記錄用
const modelRange = buildModelSheet(wb);
buildRepairSheet(wb, modelRange);
buildPartLookupSheet(wb);
buildSummarySheet(wb);
buildGuideSheet(wb);

const outPath = path.join(__dirname, 'TITAN-STAR-維修記錄模板.xlsx');
XLSX.writeFile(wb, outPath);

const totalModels = Object.values(MODEL_LIST).flat().length;
const totalCols   = COLUMNS.length;
const required    = COLUMNS.filter(c => c.required).length;
const important   = COLUMNS.filter(c => c.important).length;
const lookups     = COLUMNS.filter(c => c.type === 'lookup').length;
const optional    = totalCols - required - important - lookups;
const dv          = COLUMNS.filter(c => c.dropdown || c.dropdownSheet || c.validate).length;

console.log(`✓ 模板已生成：${outPath}`);
console.log(`  欄位：${totalCols} 欄（★必填 ${required} / ☆重要 ${important} / 自動帶出 ${lookups} / 選填 ${optional}）`);
console.log(`  放呆：${dv} 欄設有下拉或格式驗證`);
console.log(`  機種：${totalModels} 個已知品號，每大類保留10列空白供新增`);
console.log(`  料號：${Object.keys(PART_CATEGORY).length} 大類自動帶出`);
console.log(`  工作表：機種清冊、維修記錄、料號對照、系品彙總、說明`);
