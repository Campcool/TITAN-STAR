/**
 * 建立 TITAN-STAR 維修記錄標準 Excel 模板
 * 執行：node build-template.js
 * 輸出：TITAN-STAR-維修記錄模板.xlsx
 */

const XLSX = require('xlsx');
const path = require('path');

// ─── 欄位定義 ─────────────────────────────────────────────────────
// required: 必填（系統分析必要）
// important: 重要（解鎖進階分析）
// optional: 選填
const COLUMNS = [
  // ── 基本資訊（必填）──
  { header: '檢修日期',   key: 'date',       width: 14, required: true,
    note: '必填。格式：YYYY/MM/DD 或民國年 115/04/01', example: '2026/04/15' },
  { header: '器材品號',   key: 'model',      width: 16, required: true,
    note: '必填。機器品號，如 MSM0801。系統以此識別機種', example: 'MSM0801' },
  { header: '機器序號',   key: 'serial',     width: 16, required: true,
    note: '必填。唯一序號，系統追蹤同一台設備跨月維修歷程', example: 'SN20250001' },
  { header: '是否報廢',   key: 'scrap',      width: 10, required: true,
    note: '必填。填 Y（報廢）或 N（維修完成）', example: 'N', dropdown: ['Y','N'] },

  // ── 責任判定（重要：解鎖全新/整新分析）──
  { header: '製令品號',   key: 'batch',      width: 18, important: true,
    note: '重要。出廠身分證，格式 YYMMDD+3碼序號，如 250410057（=2025年04月批次057）。填此欄可解鎖全新/整新責任分析', example: '250410057' },
  { header: '製造日期',   key: 'mfg',        width: 14, important: true,
    note: '重要。機器標籤上的製造日期（整新後會更新）。配合製令品號解鎖責任判定', example: '2025/04/10' },

  // ── 故障描述（必填）──
  { header: '故障原因',   key: 'reason',     width: 30, required: true,
    note: '必填。故障大類，如：電源異常、主板損壞、螢幕異常、機構損傷等', example: '電源異常' },
  { header: '故障內容',   key: 'content',    width: 40, required: true,
    note: '必填。詳細描述，如：無法開機，量測電源板輸出電壓僅 3V，正常應為 5V', example: '無法開機，電源板輸出電壓異常' },

  // ── 維修用料（重要：Pareto & FMEA 分析）──
  { header: '故障零件一', key: 'part1',      width: 20, important: true,
    note: '重要。換件料號或零件名稱，如 2170064 或「電源供應器」。填越完整FMEA越準確', example: '2170064' },
  { header: '數量',       key: 'qty1',       width: 8,  important: true,
    note: '故障零件一的數量', example: '1' },
  { header: '故障零件二', key: 'part2',      width: 20, important: true,
    note: '第二個換件料號（若有）', example: '1070123' },
  { header: '數量.1',     key: 'qty2',       width: 8,  important: true,
    note: '故障零件二的數量', example: '2' },
  { header: '故障零件三', key: 'part3',      width: 20,
    note: '第三個換件料號（若有）', example: '' },
  { header: '數量.2',     key: 'qty3',       width: 8,
    note: '故障零件三的數量', example: '' },

  // ── 進階追蹤欄位（選填）──
  { header: '保固狀態',   key: 'warranty',   width: 12,
    note: '選填。填「保固內」或「保固外」', example: '保固外', dropdown: ['保固內','保固外','不明'] },
  { header: '韌體版本',   key: 'fw_version', width: 14,
    note: '選填。維修當下機器韌體版本，如 v2.3.1。填此欄可解鎖韌體版本故障分析', example: 'v2.3.1' },
  { header: '維修技師',   key: 'technician', width: 12,
    note: '選填。維修人員姓名或工號。未來可進行技師績效分析', example: '王大明' },
  { header: '維修工時(h)', key: 'labor_hours', width: 14,
    note: '選填。實際維修工時（小時）。填此欄可精確計算工時成本', example: '1.5' },
  { header: '備註',       key: 'note',       width: 40,
    note: '選填。其他補充說明', example: '' },
];

// ─── 說明行（第1列）─────────────────────────────────────────────
const INSTRUCTION_ROW = COLUMNS.map(c => {
  const tag = c.required ? '【必填】' : c.important ? '【重要】' : '【選填】';
  return `${tag} ${c.note}`;
});

// ─── 範例資料行 ──────────────────────────────────────────────────
const EXAMPLE_ROW = COLUMNS.map(c => c.example);

// ─── 建立工作表 ──────────────────────────────────────────────────
function buildRepairSheet(wb, sheetName) {
  const ws = {};
  const HEADER_ROW = 1;
  const INSTR_ROW = 2;
  const EXAMPLE_ROW_IDX = 3;
  const DATA_START = 4;
  const DATA_ROWS = 200;

  const R = (r, c) => XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });

  // 欄位標題（第1列）
  COLUMNS.forEach((col, i) => {
    const cell = { v: col.header, t: 's' };
    ws[R(HEADER_ROW, i + 1)] = cell;
  });

  // 說明行（第2列）
  INSTRUCTION_ROW.forEach((text, i) => {
    ws[R(INSTR_ROW, i + 1)] = { v: text, t: 's' };
  });

  // 範例行（第3列）
  EXAMPLE_ROW.forEach((val, i) => {
    ws[R(EXAMPLE_ROW_IDX, i + 1)] = { v: val, t: 's' };
  });

  // 空白資料行（第4列起）
  for (let row = DATA_START; row < DATA_START + DATA_ROWS; row++) {
    COLUMNS.forEach((col, i) => {
      ws[R(row, i + 1)] = { v: '', t: 's' };
    });
  }

  // 工作表範圍
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: DATA_START + DATA_ROWS - 2, c: COLUMNS.length - 1 },
  });

  // 欄寬
  ws['!cols'] = COLUMNS.map(c => ({ wch: c.width }));

  // 凍結前3列（標題+說明+範例）
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  // 資料驗證（下拉選單）
  const dvs = [];
  COLUMNS.forEach((col, i) => {
    if (!col.dropdown) return;
    dvs.push({
      type: 'list',
      formula1: `"${col.dropdown.join(',')}"`,
      sqref: `${XLSX.utils.encode_col(i)}${DATA_START}:${XLSX.utils.encode_col(i)}${DATA_START + DATA_ROWS - 1}`,
    });
  });
  if (dvs.length) ws['!dataValidation'] = dvs;

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

// ─── 系品彙總工作表（整新數分母）───────────────────────────────
function buildSummarySheet(wb) {
  const ws = {};
  const headers = ['系品', '器材品號', '月份', '整新數量'];
  const notes   = ['大類（如：車機系統）', '機器品號（如 MSM0801）', '月份（如 2026-04）', '該月整新總數'];
  const R = (r, c) => XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });

  headers.forEach((h, i) => ws[R(1, i+1)] = { v: h, t: 's' });
  notes.forEach((n, i) => ws[R(2, i+1)] = { v: n, t: 's' });

  // 示範資料
  const demo = [
    ['車機系統', 'MSM0801', '2026-04', 120],
    ['車機系統', 'MSM1201', '2026-04', 85],
    ['監視器',  'IP43A3Z', '2026-04', 60],
    ['傳統保全','SPM0051', '2026-04', 45],
  ];
  demo.forEach((row, ri) => {
    row.forEach((val, ci) => {
      ws[R(3 + ri, ci + 1)] = { v: val, t: typeof val === 'number' ? 'n' : 's' };
    });
  });

  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:20,c:3} });
  ws['!cols'] = [{ wch:14 }, { wch:16 }, { wch:12 }, { wch:12 }];
  XLSX.utils.book_append_sheet(wb, ws, '系品彙總');
}

// ─── 說明工作表 ──────────────────────────────────────────────────
function buildGuideSheet(wb) {
  const rows = [
    ['TITAN-STAR 維修記錄填寫說明'],
    [''],
    ['【本模板用途】'],
    ['每月維修完成後，由技師在對應欄位填入資料，上傳至 TITAN-STAR 系統進行多維度品質分析。'],
    [''],
    ['【工作表結構】'],
    ['① 維修記錄：每月維修資料填寫於此（可複製為多個工作表，以月份命名如 2026-04）'],
    ['② 系品彙總：填入各機種當月整新總數（系統計算故障率的分母）'],
    ['③ 說明：本說明頁'],
    [''],
    ['【填寫優先順序】'],
    ['★★★ 必填欄位：檢修日期、器材品號、機器序號、是否報廢、故障原因、故障內容'],
    ['★★☆ 重要欄位：製令品號、製造日期、故障零件一、數量（填此可解鎖責任判定與FMEA分析）'],
    ['★☆☆ 選填欄位：保固狀態、韌體版本、維修技師、維修工時、備註'],
    [''],
    ['【製令品號格式說明（重要）】'],
    ['格式：YYMMDD + 3碼序號，共 9 位數字'],
    ['範例：250410057 = 2025年04月出廠、批次序號057'],
    ['用途：系統據此判斷「全新（出廠月=維修月）」或「整新（出廠月≠維修月）」，並自動歸責'],
    [''],
    ['【故障原因建議填法】'],
    ['電源系統 / 主板PCB / 顯示螢幕 / 儲存記憶 / 感測鏡頭 / 機構外觀 / 通訊網路 / 韌體軟體 / 運輸損傷 / 電磁靜電'],
    ['（使用上述標準大類，系統自動分類至 FMEA；自由文字亦可，但分類準確度較低）'],
    [''],
    ['【每月上傳步驟】'],
    ['1. 將本月填寫完成的 Excel 存檔'],
    ['2. 開啟 TITAN-STAR 系統 → 點「上傳/管理」'],
    ['3. 拖曳或選擇本月 Excel 檔案 → 系統自動解析'],
    ['4. 確認月份標籤正確後，切換至「維修分析報表」'],
    [''],
    ['【聯絡資訊】'],
    ['系統問題請聯繫品保部門或系統管理員'],
  ];

  const ws = {};
  rows.forEach((row, ri) => {
    row.forEach((val, ci) => {
      ws[XLSX.utils.encode_cell({r: ri, c: ci})] = { v: val, t: 's' };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rows.length,c:2} });
  ws['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ws, '說明');
}

// ─── 主程式 ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
buildRepairSheet(wb, '維修記錄');
buildSummarySheet(wb);
buildGuideSheet(wb);

const outPath = path.join(__dirname, 'TITAN-STAR-維修記錄模板.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`✓ 模板已生成：${outPath}`);
console.log(`  欄位數：${COLUMNS.length}`);
console.log(`  工作表：維修記錄、系品彙總、說明`);
