/**
 * TITAN-STAR 維修記錄 Excel 模板 v4（精簡版）
 * 執行：node build-template.js
 * 輸出：TITAN-STAR-維修記錄模板.xlsx
 *
 * v4 設計原則：
 * - 維持原始欄位順序與名稱，降低一線人員學習成本
 * - 僅新增兩個關鍵欄位：製令品號、製造日期（解鎖責任分析）
 * - 料號大類由系統端自動解析，Excel 不放 VLOOKUP 公式
 * - 工作表精簡：維修記錄 + 系品彙總 + 說明（共3張）
 * - 故障原因改為10大類下拉，避免自由文字造成分析失真
 * - 是否報廢改為 Y/N 下拉，防止填寫錯誤
 */

const XLSX = require('xlsx');
const path = require('path');

// 故障原因 10 大類（與 parser.js 一致）
const FAULT_TYPES = [
  '電源系統','主板PCB','顯示螢幕','儲存記憶',
  '感測鏡頭','機構外觀','通訊網路','韌體軟體',
  '運輸損傷','電磁靜電',
];

// ─── 欄位定義（接近原始欄位順序）────────────────────────────────
// ★ 必填  ☆ 建議填（解鎖進階分析）  無符號 = 選填
const COLUMNS = [
  { header:'★ 檢修日期',  key:'date',    width:13,
    hint:'完成維修的日期（YYYY/MM/DD）',  example:'2026/04/15' },

  { header:'★ 器材品號',  key:'model',   width:14,
    hint:'機器的產品型號',               example:'MSM0801' },

  { header:'★ 機器序號',  key:'serial',  width:15,
    hint:'機器唯一序號（SN）',           example:'SN20250001' },

  { header:'☆ 製令品號',  key:'batch',   width:16,
    hint:'9位數字，例：250410057',        example:'250410057',
    validate:{ type:'textLength', operator:'equal', formula1:'9',
      showErrorMessage:true, errorTitle:'製令品號格式錯誤',
      error:'製令品號必須是9位數字（YYMMDD+3碼序號），例：250410057' } },

  { header:'☆ 製造日期',  key:'mfg',     width:13,
    hint:'機器標籤上的製造日期',          example:'2025/04/10' },

  { header:'★ 故障原因',  key:'reason',  width:14,
    hint:'從下拉選擇（共10類）',           example:'電源系統',
    dropdown: FAULT_TYPES,
    validate:{ showErrorMessage:true, errorTitle:'請從下拉選擇',
      error:'請點選欄位右側下拉箭頭，選擇故障原因大類' } },

  { header:'★ 故障內容',  key:'content', width:45,
    hint:'詳述現象與處理方式',
    example:'無法開機，電源板輸出電壓異常，換電源模組後正常' },

  { header:'☆ 故障零件一', key:'part1',  width:20,
    hint:'換件名稱或料號',               example:'電源模組' },

  { header:'☆ 數量',       key:'qty1',   width:8,
    hint:'換件數量',                     example:'1' },

  { header:'故障零件二',   key:'part2',  width:20,
    hint:'第二換件（選填）',              example:'' },

  { header:'數量',          key:'qty2',  width:8,
    hint:'數量',                         example:'' },

  { header:'故障零件三',   key:'part3',  width:20,
    hint:'第三換件（選填）',              example:'' },

  { header:'數量',          key:'qty3',  width:8,
    hint:'數量',                         example:'' },

  { header:'★ 是否報廢',   key:'scrap',  width:10,
    hint:'N＝維修完成  Y＝報廢',          example:'N',
    dropdown:['N','Y'],
    validate:{ showErrorMessage:true, errorTitle:'請選擇Y或N',
      error:'請點下拉選擇：N＝維修完成  Y＝報廢' } },
];

// ─── 工具 ─────────────────────────────────────────────────────────
function colLetter(idx) {
  let s = '', i = idx + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// ─── 維修記錄工作表 ───────────────────────────────────────────────
function buildRepairSheet(wb) {
  const ws = {};
  const R = (r, c) => XLSX.utils.encode_cell({ r: r - 1, c });

  const HDR_ROW  = 1;   // 1-based
  const HINT_ROW = 2;
  const EX_ROW   = 3;   // 範例行
  const DATA_START = 4;
  const DATA_ROWS  = 500;

  // 標題列
  COLUMNS.forEach((col, i) => {
    ws[R(HDR_ROW, i)] = { v: col.header, t: 's' };
  });

  // 提示列
  COLUMNS.forEach((col, i) => {
    ws[R(HINT_ROW, i)] = { v: col.hint, t: 's' };
  });

  // 範例列（灰底，可刪除）
  COLUMNS.forEach((col, i) => {
    ws[R(EX_ROW, i)] = { v: col.example, t: 's' };
  });

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: DATA_START + DATA_ROWS - 2, c: COLUMNS.length - 1 },
  });

  ws['!cols'] = COLUMNS.map(c => ({ wch: c.width }));

  // 凍結前2列（標題+提示）+ 前3欄（檢修日期/器材品號/序號）
  ws['!freeze'] = { xSplit: 3, ySplit: 2 };

  // 資料驗證
  const dvs = [];
  COLUMNS.forEach((col, i) => {
    const start = `${colLetter(i)}${DATA_START}`;
    const end   = `${colLetter(i)}${DATA_START + DATA_ROWS - 1}`;
    const sqref = `${start}:${end}`;

    if (col.dropdown) {
      dvs.push({
        type: 'list',
        formula1: `"${col.dropdown.join(',')}"`,
        sqref,
        showErrorMessage: col.validate?.showErrorMessage ?? false,
        errorTitle: col.validate?.errorTitle ?? '',
        error: col.validate?.error ?? '',
      });
    } else if (col.validate) {
      dvs.push({ ...col.validate, sqref });
    }
  });
  if (dvs.length) ws['!dataValidation'] = dvs;

  XLSX.utils.book_append_sheet(wb, ws, '維修記錄');
}

// ─── 系品彙總工作表（整新出廠數量，作為故障率分母）────────────────
function buildSummarySheet(wb) {
  const ws = {};
  const R = (r, c) => XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });

  ws[R(1,1)] = { v:'【系品彙總】每月整新出廠數量 — 作為故障率計算分母', t:'s' };
  ws[R(2,1)] = { v:'器材品號', t:'s' };
  ws[R(2,2)] = { v:'月份（YYYY-MM）', t:'s' };
  ws[R(2,3)] = { v:'整新出廠數量', t:'s' };
  ws[R(3,1)] = { v:'（提示）此工作表非必填，填入後故障率才能正確計算', t:'s' };

  const demo = [
    ['MSM0801', '2026-04', 120],
    ['MSM1201', '2026-04',  85],
    ['IP43A3Z', '2026-04',  60],
  ];
  demo.forEach(([m, mo, n], ri) => {
    ws[R(5 + ri, 1)] = { v: m,  t: 's' };
    ws[R(5 + ri, 2)] = { v: mo, t: 's' };
    ws[R(5 + ri, 3)] = { v: n,  t: 'n' };
  });

  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:25,c:3} });
  ws['!cols'] = [{ wch:2 }, { wch:16 }, { wch:16 }, { wch:14 }];
  XLSX.utils.book_append_sheet(wb, ws, '系品彙總');
}

// ─── 說明工作表 ──────────────────────────────────────────────────
function buildGuideSheet(wb) {
  const rows = [
    'TITAN-STAR 維修記錄填寫說明',
    '',
    '★ 必填欄位（共6欄）：檢修日期、器材品號、機器序號、故障原因、故障內容、是否報廢',
    '☆ 建議填（解鎖進階分析）：製令品號、製造日期、故障零件一、數量',
    '',
    '────────────────────────────────',
    '【製令品號】',
    '  格式：YYMMDD + 3碼序號 = 共9位數字',
    '  例：250410057 = 2025年04月10日、第057批次',
    '  填入後系統可自動判斷全新/整新、定位責任批次',
    '',
    '【故障原因（10大類）】',
    '  電源系統  → 無法開機、電壓異常、電源板故障',
    '  主板PCB   → 主機板故障、元件損壞',
    '  顯示螢幕  → 不顯示、黑屏、顯示異常',
    '  儲存記憶  → SD卡、硬碟、記憶體、資料遺失',
    '  感測鏡頭  → 攝影機、PIR感測、麥克風故障',
    '  機構外觀  → 外殼破裂、按鍵失效、接頭鬆動',
    '  通訊網路  → 網路斷線、Wi-Fi/藍牙、通訊模組',
    '  韌體軟體  → 當機、更新失敗、功能異常',
    '  運輸損傷  → 包裝完整但內部受損',
    '  電磁靜電  → ESD靜電、雷擊突波',
    '',
    '【故障零件】',
    '  填入換件的名稱即可（例：電源模組、主機板）',
    '  不需要填入料號；系統端自動對應大類',
    '',
    '【每月上傳步驟】',
    '  1. 月底確認所有維修紀錄填寫完整',
    '  2. 存檔（建議命名：2026-04 維修記錄.xlsx）',
    '  3. 開啟 TITAN-STAR → 上傳/管理 → 拖曳上傳',
    '  4. 系統自動解析，確認月份標籤正確即完成',
  ];

  const ws = {};
  rows.forEach((line, ri) => {
    ws[XLSX.utils.encode_cell({ r: ri, c: 0 })] = { v: line, t: 's' };
  });
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rows.length, c:0} });
  ws['!cols'] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, ws, '說明');
}

// ─── 主程式 ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
buildRepairSheet(wb);
buildSummarySheet(wb);
buildGuideSheet(wb);

const outPath = path.join(__dirname, 'TITAN-STAR-維修記錄模板.xlsx');
XLSX.writeFile(wb, outPath);

const required  = COLUMNS.filter(c => c.header.startsWith('★')).length;
const important = COLUMNS.filter(c => c.header.startsWith('☆')).length;
const optional  = COLUMNS.length - required - important;
console.log(`✓ 模板已生成：${outPath}`);
console.log(`  欄位：${COLUMNS.length} 欄（★必填 ${required} / ☆建議 ${important} / 選填 ${optional}）`);
console.log(`  工作表：維修記錄、系品彙總、說明`);
