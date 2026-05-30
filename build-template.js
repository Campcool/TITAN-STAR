/**
 * 建立 TITAN-STAR 維修記錄標準 Excel 模板 v2
 * 執行：node build-template.js
 * 輸出：TITAN-STAR-維修記錄模板.xlsx
 *
 * v2 新增：
 * - 料號對照表工作表（54大類 + 可貼入完整BOM）
 * - 零件欄旁自動帶出大類公式欄
 * - 工廠管理欄位：接收日期、TAT、故障再現性、維修方式、測試結果、來源類型、外觀損傷
 */

const XLSX = require('xlsx');
const path = require('path');

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

// ─── 欄位定義 ─────────────────────────────────────────────────────
// type: 'data'=一般欄, 'lookup'=公式自動帶出(不需人工填)
const COLUMNS = [

  // ══ A 基本識別（必填）══════════════════════════════════════════
  { header: '接收日期',      key: 'recv_date',    width: 14, required: true,
    note: '【必填】送修到廠日期。與檢修日期搭配計算維修週期(TAT)。格式 YYYY/MM/DD', example: '2026/04/13' },

  { header: '檢修日期',      key: 'date',         width: 14, required: true,
    note: '【必填】實際完成維修日期。格式 YYYY/MM/DD 或民國年 115/04/15', example: '2026/04/15' },

  { header: '器材品號',      key: 'model',        width: 16, required: true,
    note: '【必填】機器品號，如 MSM0801。系統以此識別機種、計算故障率', example: 'MSM0801' },

  { header: '機器序號',      key: 'serial',       width: 16, required: true,
    note: '【必填】唯一序號。系統追蹤同一台設備跨月維修歷程，找重複進廠設備', example: 'SN20250001' },

  // ══ B 責任判定（重要：解鎖全新/整新分析）══════════════════════
  { header: '製令品號',      key: 'batch',        width: 18, important: true,
    note: '【重要】出廠身分證，格式 YYMMDD+3碼序號（共9碼），如 250410057 = 2025年04月批次057。填此欄解鎖全新/整新責任判定', example: '250410057' },

  { header: '製造日期',      key: 'mfg',          width: 14, important: true,
    note: '【重要】機器標籤上的製造日期（整新後更新）。配合製令品號解鎖責任歸屬', example: '2025/04/10' },

  // ══ C 來源與品項狀態（工廠管理）══════════════════════════════
  { header: '來源類型',      key: 'source_type',  width: 14,
    note: '【選填】維修來源。填：客戶退修／整新流程／內部品管／保固換修',
    example: '客戶退修', dropdown: ['客戶退修','整新流程','內部品管','保固換修','其他'] },

  { header: '保固狀態',      key: 'warranty',     width: 12,
    note: '【選填】是否在保固期內。填：保固內／保固外／不明',
    example: '保固外', dropdown: ['保固內','保固外','不明'] },

  { header: '外觀損傷',      key: 'cosmetic_dmg', width: 12,
    note: '【選填】外觀是否有人為損傷（影響保固判定）。填：無／輕微／明顯',
    example: '無', dropdown: ['無','輕微','明顯'] },

  // ══ D 故障描述（必填）══════════════════════════════════════════
  { header: '故障原因',      key: 'reason',       width: 24, required: true,
    note: '【必填】故障大類。建議使用：電源系統／主板PCB／顯示螢幕／儲存記憶／感測鏡頭／機構外觀／通訊網路／韌體軟體／運輸損傷／電磁靜電', example: '電源系統' },

  { header: '故障內容',      key: 'content',      width: 40, required: true,
    note: '【必填】詳細描述現象與量測值。如：無法開機，量測電源板輸出 3V（正常 5V），更換電源模組後正常', example: '無法開機，電源板輸出電壓異常，換電源模組後正常' },

  { header: '故障再現性',    key: 'reproducible', width: 14,
    note: '【重要】故障能否重現。填：可重現／間歇性／NTF（無法重現）。NTF比例高代表診斷流程或操作問題',
    example: '可重現', dropdown: ['可重現','間歇性','NTF(無法重現)'] },

  // ══ E 維修用料（重要：Pareto & FMEA）══════════════════════════
  { header: '故障零件一',    key: 'part1',        width: 20, important: true,
    note: '【重要】換件料號（如 2170064）或零件名稱（如「電源模組」）。填料號可自動帶出大類', example: '1180042' },

  { header: '零件一大類',    key: 'part1_cat',    width: 16, type: 'lookup',
    note: '【自動帶出】由故障零件一料號自動查詢大類，請勿手動修改', example: '(自動)' },

  { header: '數量',          key: 'qty1',         width: 8, important: true,
    note: '【重要】故障零件一的數量', example: '1' },

  { header: '故障零件二',    key: 'part2',        width: 20,
    note: '【選填】第二個換件料號（若有）', example: '' },

  { header: '零件二大類',    key: 'part2_cat',    width: 16, type: 'lookup',
    note: '【自動帶出】由故障零件二料號自動查詢大類', example: '(自動)' },

  { header: '數量.1',        key: 'qty2',         width: 8,
    note: '【選填】故障零件二的數量', example: '' },

  { header: '故障零件三',    key: 'part3',        width: 20,
    note: '【選填】第三個換件料號（若有）', example: '' },

  { header: '零件三大類',    key: 'part3_cat',    width: 16, type: 'lookup',
    note: '【自動帶出】由故障零件三料號自動查詢大類', example: '(自動)' },

  { header: '數量.2',        key: 'qty3',         width: 8,
    note: '【選填】故障零件三的數量', example: '' },

  // ══ F 維修方式與結果（工廠管理）══════════════════════════════
  { header: '維修方式',      key: 'repair_method', width: 16,
    note: '【選填】主要維修手段。填：換件修復／軟體/韌體更新／清潔調整／整機更換／無法修復',
    example: '換件修復', dropdown: ['換件修復','軟體/韌體更新','清潔調整','整機更換','無法修復','其他'] },

  { header: '是否報廢',      key: 'scrap',        width: 10, required: true,
    note: '【必填】填 Y（報廢）或 N（維修完成）', example: 'N', dropdown: ['Y','N'] },

  { header: '測試結果',      key: 'test_result',  width: 14,
    note: '【選填】出廠前測試狀態。填：通過／失敗／待觀察',
    example: '通過', dropdown: ['通過','失敗','待觀察'] },

  // ══ G 進階追蹤（選填）══════════════════════════════════════════
  { header: '韌體版本',      key: 'fw_version',   width: 14,
    note: '【選填】維修當下機器的韌體版本（如 v2.3.1）。填此欄可做版本層級故障分析', example: 'v2.3.1' },

  { header: '維修技師',      key: 'technician',   width: 12,
    note: '【選填】維修人員姓名或工號。可追蹤技師首修成功率', example: '王大明' },

  { header: '維修工時(h)',   key: 'labor_hours',  width: 14,
    note: '【選填】實際維修工時（小時）。填此欄讓系統精確計算工時成本', example: '1.5' },

  { header: '備註',          key: 'note',         width: 40,
    note: '【選填】其他補充說明', example: '' },
];

// ─── 計算欄位索引（用於 LOOKUP 公式）────────────────────────────
function colLetter(idx) { // 0-based → A,B,...,Z,AA,...
  let s = '';
  idx++;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

// 找出各 lookup 依賴的來源欄
function findColIdx(key) {
  return COLUMNS.findIndex(c => c.key === key);
}

// VLOOKUP 公式：從料號前3碼查大類，再試前1碼
// 料號對照表在工作表「料號對照」，A欄=代碼, B欄=大類名稱
function lookupFormula(partColLetter, rowNum) {
  const pno = `${partColLetter}${rowNum}`;
  return `=IFERROR(VLOOKUP(VALUE(LEFT(${pno},3)),料號對照!$A:$C,2,0),IFERROR(VLOOKUP(VALUE(LEFT(${pno},1)),料號對照!$A:$C,2,0),""))`;
}

// ─── 建立維修記錄工作表 ──────────────────────────────────────────
function buildRepairSheet(wb, sheetName) {
  const ws = {};
  const HEADER_ROW = 1;
  const INSTR_ROW  = 2;
  const EXAMPLE_ROW_NUM = 3;
  const DATA_START = 4;
  const DATA_ROWS  = 300;

  const R = (r, c) => XLSX.utils.encode_cell({ r: r - 1, c });

  // 建立欄位索引（for lookup 公式）
  const part1Idx = findColIdx('part1');
  const part2Idx = findColIdx('part2');
  const part3Idx = findColIdx('part3');
  const part1CatIdx = findColIdx('part1_cat');
  const part2CatIdx = findColIdx('part2_cat');
  const part3CatIdx = findColIdx('part3_cat');

  // ── 第1列：標題 ──
  COLUMNS.forEach((col, i) => {
    const tag = col.required ? '★' : col.important ? '☆' : '';
    ws[R(HEADER_ROW, i)] = { v: tag ? `${tag} ${col.header}` : col.header, t: 's' };
  });

  // ── 第2列：說明 ──
  COLUMNS.forEach((col, i) => {
    ws[R(INSTR_ROW, i)] = { v: col.note, t: 's' };
  });

  // ── 第3列：範例 ──
  COLUMNS.forEach((col, i) => {
    ws[R(EXAMPLE_ROW_NUM, i)] = { v: col.example, t: 's' };
  });

  // ── 第4列起：資料行（空白 + lookup 公式）──
  for (let row = DATA_START; row < DATA_START + DATA_ROWS; row++) {
    COLUMNS.forEach((col, i) => {
      if (col.type === 'lookup') {
        // 判斷是哪個零件的 lookup
        let srcIdx = -1;
        if (i === part1CatIdx) srcIdx = part1Idx;
        else if (i === part2CatIdx) srcIdx = part2Idx;
        else if (i === part3CatIdx) srcIdx = part3Idx;

        if (srcIdx >= 0) {
          ws[R(row, i)] = { f: lookupFormula(colLetter(srcIdx), row), t: 's' };
        } else {
          ws[R(row, i)] = { v: '', t: 's' };
        }
      } else {
        ws[R(row, i)] = { v: '', t: 's' };
      }
    });
  }

  // ── 工作表範圍 ──
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: DATA_START + DATA_ROWS - 2, c: COLUMNS.length - 1 },
  });

  // ── 欄寬 ──
  ws['!cols'] = COLUMNS.map(c => ({ wch: c.width }));

  // ── 凍結前3列 ──
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  // ── 資料驗證（下拉選單）──
  const dvs = [];
  COLUMNS.forEach((col, i) => {
    if (!col.dropdown) return;
    const startCell = `${colLetter(i)}${DATA_START}`;
    const endCell   = `${colLetter(i)}${DATA_START + DATA_ROWS - 1}`;
    dvs.push({
      type: 'list',
      formula1: `"${col.dropdown.join(',')}"`,
      sqref: `${startCell}:${endCell}`,
    });
  });
  if (dvs.length) ws['!dataValidation'] = dvs;

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

// ─── 料號對照表工作表 ─────────────────────────────────────────────
function buildPartLookupSheet(wb) {
  const ws = {};

  const headers = ['代碼(前N碼)', '大類名稱', '說明/用途'];
  headers.forEach((h, i) => {
    ws[XLSX.utils.encode_cell({r:0, c:i})] = { v: h, t: 's' };
  });

  ws[XLSX.utils.encode_cell({r:1, c:0})] = { v: '─── 系統自動查詢用（請勿刪除）───', t: 's' };

  const rows = Object.entries(PART_CATEGORY).map(([code, name]) => {
    const numCode = parseInt(code, 10);
    let desc = '';
    if (numCode < 10) desc = '一位碼：半成品/成品/外包等';
    else if (numCode < 200) desc = '1xx：DIP 類元件';
    else desc = '2xx：SMD 類元件';
    return [numCode, name, desc];
  });

  // 排序：數字由小到大
  rows.sort((a, b) => a[0] - b[0]);

  rows.forEach(([code, name, desc], ri) => {
    ws[XLSX.utils.encode_cell({r: ri + 2, c: 0})] = { v: code, t: 'n' };
    ws[XLSX.utils.encode_cell({r: ri + 2, c: 1})] = { v: name, t: 's' };
    ws[XLSX.utils.encode_cell({r: ri + 2, c: 2})] = { v: desc, t: 's' };
  });

  // ── 空間預留：讓工廠貼入完整BOM ──
  const bomStartRow = rows.length + 5;
  ws[XLSX.utils.encode_cell({r: bomStartRow, c: 0})] = { v: '──── 完整料號清冊（從ERP貼入，解鎖精確品名查詢）────', t: 's' };
  ws[XLSX.utils.encode_cell({r: bomStartRow+1, c: 0})] = { v: '完整料號', t: 's' };
  ws[XLSX.utils.encode_cell({r: bomStartRow+1, c: 1})] = { v: '品名', t: 's' };
  ws[XLSX.utils.encode_cell({r: bomStartRow+1, c: 2})] = { v: '規格/說明', t: 's' };
  ws[XLSX.utils.encode_cell({r: bomStartRow+2, c: 0})] = { v: '(從ERP匯出後貼入此區，公式欄將自動顯示品名)', t: 's' };

  ws['!ref'] = XLSX.utils.encode_range({
    s: {r:0, c:0},
    e: {r: bomStartRow + 50, c: 2}
  });
  ws['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 30 }];

  XLSX.utils.book_append_sheet(wb, ws, '料號對照');
}

// ─── 系品彙總工作表（整新數分母）────────────────────────────────
function buildSummarySheet(wb) {
  const ws = {};
  const R = (r, c) => XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });

  const headers = ['系品大類', '器材品號', '月份', '整新數量'];
  const notes   = ['大類（如：車機系統）', '品號（如 MSM0801）', '月份（如 2026-04）', '當月整新出廠總數'];
  headers.forEach((h, i) => ws[R(1, i+1)] = { v: h, t: 's' });
  notes.forEach((n, i)   => ws[R(2, i+1)] = { v: n, t: 's' });

  const demo = [
    ['車機系統', 'MSM0801', '2026-04', 120],
    ['車機系統', 'MSM1201', '2026-04',  85],
    ['監視器',  'IP43A3Z', '2026-04',  60],
    ['傳統保全','SPM0051', '2026-04',  45],
  ];
  demo.forEach((row, ri) => row.forEach((val, ci) => {
    ws[R(3 + ri, ci + 1)] = { v: val, t: typeof val === 'number' ? 'n' : 's' };
  }));

  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:25,c:3} });
  ws['!cols'] = [{ wch:14 }, { wch:16 }, { wch:12 }, { wch:12 }];
  XLSX.utils.book_append_sheet(wb, ws, '系品彙總');
}

// ─── 說明工作表 ──────────────────────────────────────────────────
function buildGuideSheet(wb) {
  const rows = [
    ['TITAN-STAR 維修記錄填寫說明 v2'],
    [''],
    ['【欄位重要性】'],
    ['★ 必填：系統分析的基礎，未填將影響所有報表準確度'],
    ['☆ 重要：選填但強烈建議填，解鎖責任分析、FMEA、成本量化等進階功能'],
    ['  選填：有填就有對應的進階分析，沒填不影響基本報表'],
    [''],
    ['【工廠管理欄位說明（v2新增）】'],
    ['接收日期   → 與「檢修日期」搭配，系統計算維修週期（TAT），管理積壓'],
    ['來源類型   → 區分客戶退修、整新流程、內部品管，分析各來源的故障率差異'],
    ['故障再現性 → NTF（無法重現）比例高，代表診斷流程或操作環境問題，建議QA追蹤'],
    ['外觀損傷   → 判斷是否為人為損傷，影響保固拒修依據'],
    ['維修方式   → 區分換件/軟體更新/清潔，量化各維修類型比例'],
    ['測試結果   → 出廠前必驗證，填「通過」代表完成驗收，「待觀察」需追蹤'],
    [''],
    ['【料號自動帶出功能】'],
    ['在「故障零件一/二/三」欄填入料號（如 2170064），'],
    ['右側「零件X大類」欄會自動顯示大類名稱（如「SMD連接器」）。'],
    [''],
    ['若需顯示完整品名（如「LMC6482 運算放大器」），請將 ERP 料號清冊'],
    ['（含「完整料號」和「品名」兩欄）貼入「料號對照」工作表的指定區域。'],
    [''],
    ['【製令品號格式（★ 必須正確才能解鎖責任分析）】'],
    ['格式：YYMMDD + 3碼序號（共9碼），全數字'],
    ['  YY = 西元年後兩碼（YY<50→20xx，YY≥50→19xx）'],
    ['  MM = 月份（01-12）'],
    ['  DD = 日期（01-31）'],
    ['  seq = 批次序號（001-999）'],
    ['範例：250410057 = 2025年04月10日、批次序號057'],
    [''],
    ['【故障原因標準大類（盡量使用以下描述）】'],
    ['電源系統 / 主板PCB / 顯示螢幕 / 儲存記憶 / 感測鏡頭 /'],
    ['機構外觀 / 通訊網路 / 韌體軟體 / 運輸損傷 / 電磁靜電'],
    ['（使用標準大類 → 系統自動分類至 FMEA & 根因樹；自由文字也可，但分類準確度較低）'],
    [''],
    ['【每月上傳步驟】'],
    ['1. 月底前確認所有維修記錄填寫完整（尤其製令品號欄）'],
    ['2. 存檔 Excel（建議命名：2026-04 維修記錄.xlsx）'],
    ['3. 開啟 TITAN-STAR 系統 → 點「上傳/管理」→ 拖曳上傳'],
    ['4. 系統自動解析，確認月份標籤無誤'],
  ];

  const ws = {};
  rows.forEach((row, ri) => {
    row.forEach((val, ci) => {
      ws[XLSX.utils.encode_cell({r: ri, c: ci})] = { v: val, t: 's' };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rows.length+1, c:0} });
  ws['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws, '說明');
}

// ─── 主程式 ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
buildRepairSheet(wb, '維修記錄');
buildPartLookupSheet(wb);
buildSummarySheet(wb);
buildGuideSheet(wb);

const outPath = path.join(__dirname, 'TITAN-STAR-維修記錄模板.xlsx');
XLSX.writeFile(wb, outPath);

const totalCols = COLUMNS.length;
const requiredCols = COLUMNS.filter(c => c.required).length;
const importantCols = COLUMNS.filter(c => c.important).length;
const lookupCols = COLUMNS.filter(c => c.type === 'lookup').length;
const partCategories = Object.keys(PART_CATEGORY).length;

console.log(`✓ 模板已生成：${outPath}`);
console.log(`  欄位總數：${totalCols}（必填 ${requiredCols} / 重要 ${importantCols} / 自動帶出 ${lookupCols} / 選填 ${totalCols-requiredCols-importantCols-lookupCols}）`);
console.log(`  料號大類：${partCategories} 類（可貼入完整BOM解鎖精確品名）`);
console.log(`  工作表：維修記錄、料號對照、系品彙總、說明`);
