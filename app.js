// ════════════════════════════════════════════════════════════════════
// App — state, rendering, charts
// ════════════════════════════════════════════════════════════════════

window.App = (function () {

  // ─────────────── Theme / chart defaults ───────────────
  const COLORS = {
    bg: '#161d28',
    surface: '#1f2835',
    surface2: '#2a3442',
    border: 'rgba(255,255,255,0.10)',
    border2: 'rgba(255,255,255,0.20)',
    text: '#f5f8fc',
    text2: '#c0cbda',
    text3: '#94a2b6',
    textMute: '#6f7e93',
    accent: '#38bdf8',
    critical: '#ef4444',
    warn: '#f59e0b',
    ok: '#10b981',
    info: '#818cf8',
  };
  const CAT_COLOR = {
    '監視器':   '#38bdf8',
    '傳統保全': '#fb923c',
    '無線保全': '#10b981',
    '車機系統': '#a78bfa',
    'AED':      '#f472b6',
    '門禁':     '#facc15',
    '其他':     '#64748b',
  };
  const PALETTE = ['#38bdf8','#fb923c','#10b981','#a78bfa','#f472b6','#facc15','#ef4444','#06b6d4','#84cc16','#f97316'];

  if (window.Chart) {
    Chart.defaults.color = COLORS.text2;
    Chart.defaults.font.family = "'Inter','Noto Sans TC',sans-serif";
    Chart.defaults.font.size = 14;
    Chart.defaults.borderColor = COLORS.border;
    // B3: register zoom plugin; C3: register annotation plugin
    if (window.ChartZoom) Chart.register(window.ChartZoom);
    if (window['chartjs-plugin-annotation']) Chart.register(window['chartjs-plugin-annotation']);
  }

  // ─────────────── Analysis Role Definitions ───────────────
  const ANALYSIS_ROLES = {
    all:      { label:'綜合視角', short:'綜合',  icon:'⊞', color:'#38bdf8', desc:'全部指標總覽，適合快速掌握全域狀況' },
    ceo:      { label:'董事長',   short:'董事長', icon:'◈', color:'#a78bfa', desc:'戰略績效 · 風險評估 · 財務影響' },
    factory:  { label:'廠長',     short:'廠長',   icon:'⊙', color:'#fb923c', desc:'跨部門協調 · 積壓管理 · 資源調配' },
    procure:  { label:'採購主管', short:'採購',   icon:'◎', color:'#facc15', desc:'零件需求 · 供應商風險 · 採購觸發點' },
    prod:     { label:'生產主管', short:'生產',   icon:'⚙', color:'#10b981', desc:'良率分析 · 製程缺陷 · 機種表現' },
    qa:       { label:'品檢主管', short:'品檢',   icon:'◇', color:'#f472b6', desc:'重複維修 · 保固退回率 · CAPA候選' },
    logistics:{ label:'物流主管', short:'物流',   icon:'↗', color:'#34d399', desc:'報廢率 · 維修週期 · 流量管控' },
    cs:       { label:'客服主管', short:'客服',   icon:'◉', color:'#60a5fa', desc:'重複投訴 · 保固曝險 · 客戶體驗' },
    repair:   { label:'維修主管', short:'維修',   icon:'✦', color:'#f59e0b', desc:'技術效率 · 故障模式 · 報廢決策' },
    hw:       { label:'硬體研發', short:'硬體',   icon:'◁', color:'#818cf8', desc:'設計缺陷 · ECO候選 · 元件可靠性' },
    fw:       { label:'韌體研發', short:'韌體',   icon:'▷', color:'#22d3ee', desc:'韌體關鍵字故障 · OTA候選 · 系統穩定性' },
    finance:  { label:'財務主管', short:'財務',   icon:'$', color:'#4ade80', desc:'品質成本 COPQ · 報廢金額 · 改善 ROI' },
    sales:    { label:'業務主管', short:'業務',   icon:'◐', color:'#fbbf24', desc:'產品口碑 · 客戶信心 · 可推廣機種' },
  };

  // ─────────────── State ───────────────
  const state = {
    db: { months: {} },
    selectedMonths: [],       // [] = all
    selectedCategory: '全部',
    selectedModel: '全部',
    currentPage: 'summary',
    analysisRole: 'all',
    charts: {},               // chart instance refs
    detailSearch: '',
    summaryBadgeDismissed: false,
  };

  // ─────────────── Helpers ───────────────
  const $ = (id) => document.getElementById(id);

  const fmt = {
    int: (n) => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en'),
    pct: (n, digits = 1) => (n == null || isNaN(n)) ? '—' : `${n.toFixed(digits)}%`,
    pctRaw: (n, digits = 1) => (n == null || isNaN(n)) ? '—' : `${(n * 100).toFixed(digits)}%`,
    monthLabel: (mk) => {
      if (!mk) return '';
      const [y, m] = mk.split('-');
      return `${parseInt(y, 10) - 1911}/${m}`;  // Display as Taiwan year, e.g. "115/04"
    },
  };

  // MoM 環比徽章：上升=紅(惡化)、下降=綠(改善)；pp=百分點模式
  function momBadge(cur, prev, opts = {}) {
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev)) return '';
    const d = cur - prev;
    const isPP = !!opts.pp;
    if (Math.abs(d) < (isPP ? 0.05 : 0.5)) return `<span class="mom-flat">— 持平</span>`;
    const cls = d > 0 ? 'mom-up' : 'mom-dn';
    const arrow = d > 0 ? '▲' : '▼';
    const val = isPP ? Math.abs(d).toFixed(1) + 'pp' : Math.abs(Math.round(d)).toLocaleString('en');
    const rel = (!isPP && prev > 0) ? ` (${d > 0 ? '+' : '−'}${Math.abs(d / prev * 100).toFixed(0)}%)` : '';
    return `<span class="${cls}">${arrow} ${val}${rel}</span>`;
  }
  // 取目前選擇範圍最新月份的「上一個月」(從全部資料找，不限選擇範圍)
  function prevMonthOf(curMk) {
    const all = Object.keys(state.db.months).sort();
    const i = all.indexOf(curMk);
    return i > 0 ? all[i - 1] : null;
  }

  function showLoad(msg, sub = '') {
    $('loadM').textContent = msg;
    $('loadS').textContent = sub;
    $('loadOv').style.display = 'flex';
  }
  function hideLoad() { $('loadOv').style.display = 'none'; }

  // ─────────────── File upload ───────────────
  function setupUpload() {
    const drop = $('dropZone');
    const input = $('fileInput');

    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('drag');
      handleFiles(Array.from(e.dataTransfer.files));
    });
    input.addEventListener('change', e => handleFiles(Array.from(e.target.files)));
  }

  async function handleFiles(files) {
    const xlsxFiles = files.filter(f => /\.xlsx?$/i.test(f.name));
    if (!xlsxFiles.length) {
      alert('請選擇 Excel 檔案 (.xlsx)');
      return;
    }

    const results = [];
    for (let i = 0; i < xlsxFiles.length; i++) {
      const f = xlsxFiles[i];
      showLoad(`正在讀取 ${f.name}…`, `${i + 1} / ${xlsxFiles.length} 個檔案`);
      try {
        const monthData = await RepairParser.parseFile(f);
        if (!monthData.records.length) {
          results.push({ ok: false, name: f.name, error: '未偵測到維修資料' });
          continue;
        }
        RepairDB.addMonth(monthData);
        results.push({ ok: true, name: f.name, records: monthData.records.length, month: monthData.monthLabel });
      } catch (err) {
        console.error(err);
        results.push({ ok: false, name: f.name, error: err.message });
      }
    }

    hideLoad();
    $('fileInput').value = '';
    state.db = RepairDB.load();
    state.summaryBadgeDismissed = false;
    renderUploadList();

    if (results.some(r => !r.ok)) {
      const errs = results.filter(r => !r.ok).map(r => `• ${r.name}：${r.error}`).join('\n');
      alert(`部分檔案讀取失敗：\n${errs}`);
    }
  }

  function storageKB() {
    try {
      const raw = localStorage.getItem('repair_db_v2') || '';
      return Math.round(raw.length * 2 / 1024);
    } catch { return 0; }
  }

  function canMaintainData() {
    try {
      const session = JSON.parse(sessionStorage.getItem('titan_session') || 'null');
      return !!(session && session.isAdmin);
    } catch {
      return false;
    }
  }

  function setTopbarDataControls() {
    const uploadBtn = $('modeUploadBtn');
    if (uploadBtn) uploadBtn.style.display = 'none';
    const reportBtn = $('modeReportBtn');
    if (reportBtn) reportBtn.style.display = 'none';
    const excelBtn = $('modeExcelBtn');
    if (excelBtn) excelBtn.style.display = 'none';
    const roleSel = $('roleSelWrap');
    if (roleSel) roleSel.style.display = '';
    const rmaBtn = $('modeRma');
    if (rmaBtn) rmaBtn.style.display = 'none';
  }

  // ─────────────── Cloud sync (read-only shared data via repo data.json) ───────────────
  const CLOUD_URL = './data.json';
  const CLOUD_SEEN_KEY = 'repair_cloud_seen';
  const CLOUD_CHECK_KEY = 'repair_cloud_checked_month';
  const AUTO_REPORT_DIR = './monthly-reports/';
  const AUTO_REPORT_CHECK_KEY = 'repair_auto_report_checked_month';

  function currentMonthKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function isMonthlySyncDay(d = new Date()) {
    return d.getDate() === 1;
  }

  function previousMonthReportInfo(d = new Date()) {
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const y = prev.getFullYear();
    const m = String(prev.getMonth() + 1).padStart(2, '0');
    const roc = y - 1911;
    const fileName = `${roc}年 ${m} 月維修報表.xlsx`;
    return {
      monthLabel: `${y}-${m}`,
      fileName,
      url: AUTO_REPORT_DIR + encodeURIComponent(fileName),
    };
  }

  function countDbRecords(db) {
    try {
      return Object.values((db && db.months) || {})
        .reduce((sum, month) => sum + ((month && month.records) ? month.records.length : 0), 0);
    } catch {
      return 0;
    }
  }

  function hasUsableLocalData() {
    return countDbRecords(RepairDB.load()) > 0;
  }

  function dbStats(db) {
    const months = Object.keys((db && db.months) || {}).sort();
    return {
      months,
      monthCount: months.length,
      records: countDbRecords(db),
      latestMonth: months[months.length - 1] || '',
    };
  }

  function shouldAdoptCloudData(cloud, localDb, seen) {
    const cloudStats = dbStats(cloud);
    const localStats = dbStats(localDb);
    if (!cloudStats.monthCount) return false;
    if (!localStats.records) return true;
    if (cloudStats.latestMonth > localStats.latestMonth) return true;
    if (cloudStats.monthCount > localStats.monthCount) return true;
    if (cloudStats.records > localStats.records) return true;
    if (cloud.publishedAt && cloud.publishedAt !== seen) return true;
    return false;
  }

  // Fetch shared data.json on boot; monthly Excel parsing still runs only on day 1.
  // If GitHub has newer/more records than this browser, adopt it automatically.
  async function syncCloud() {
    try {
      const res = await fetch(CLOUD_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      localStorage.setItem(CLOUD_CHECK_KEY, currentMonthKey());
      const cloud = await res.json();
      if (!cloud || !cloud.months) return null;
      const cloudStats = dbStats(cloud);
      const localDb = RepairDB.load();
      const localStats = dbStats(localDb);
      state.cloudMeta = {
        publishedAt: cloud.publishedAt || null,
        publishedBy: cloud.publishedBy || '',
        months: cloudStats.monthCount,
        records: cloudStats.records,
        localMonths: localStats.monthCount,
        localRecords: localStats.records,
      };
      if (!cloudStats.monthCount) return cloud;

      const seen = localStorage.getItem(CLOUD_SEEN_KEY);
      if (shouldAdoptCloudData(cloud, localDb, seen)) {
        // Adopt cloud data into localStorage so every user auto-syncs.
        localStorage.setItem('repair_db_v2', JSON.stringify({ months: cloud.months }));
        if (cloud.partsMaster) { try { localStorage.setItem('titan_partsmaster_v1', JSON.stringify(cloud.partsMaster)); } catch(e) {} }
        if (cloud.capa) localStorage.setItem('titan_capa_v1', JSON.stringify(cloud.capa));
        if (cloud.costCfg) localStorage.setItem('titan_cost_cfg_v1', JSON.stringify(cloud.costCfg));
        localStorage.setItem(CLOUD_SEEN_KEY, cloud.publishedAt);
        state.cloudJustLoaded = true;
        // B5: notify if critical anomalies in new data
        setTimeout(() => {
          try {
            const latestMonth = Object.keys(cloud.months || {}).sort().pop();
            if (latestMonth) {
              const anom = RepairAnalyzer.detectAnomalies({ months: cloud.months }, latestMonth);
              notifyNewAnomalies(anom);
            }
          } catch(e) {}
        }, 2000);
      }
      // partsMaster 補寫：即使 months 未變，本機缺料件主檔時也要補上
      if (cloud.partsMaster && !localStorage.getItem('titan_partsmaster_v1')) {
        try { localStorage.setItem('titan_partsmaster_v1', JSON.stringify(cloud.partsMaster)); } catch(e) {}
      }
      return cloud;
    } catch (e) {
      console.warn('Cloud sync skipped:', e.message);
      return null;
    }
  }

  async function syncMonthlyWorkbook() {
    try {
      if (!isMonthlySyncDay()) return null;
      const checkedMonth = currentMonthKey();
      if (localStorage.getItem(AUTO_REPORT_CHECK_KEY) === checkedMonth) return null;

      const report = previousMonthReportInfo();
      const db = RepairDB.load();
      if (db.months && db.months[report.monthLabel]) {
        localStorage.setItem(AUTO_REPORT_CHECK_KEY, checkedMonth);
        state.autoReportMeta = { skipped: true, reason: 'already-imported', ...report };
        return null;
      }
      if (!window.XLSX || !RepairParser || !RepairParser.parseWorkbook) {
        state.autoReportMeta = { skipped: true, reason: 'xlsx-not-ready', ...report };
        return null;
      }

      const res = await fetch(report.url, { cache: 'no-store' });
      localStorage.setItem(AUTO_REPORT_CHECK_KEY, checkedMonth);
      if (!res.ok) {
        state.autoReportMeta = { skipped: true, reason: 'not-found', status: res.status, ...report };
        return null;
      }

      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const monthData = RepairParser.parseWorkbook(wb, report.fileName);
      if (!monthData || !monthData.monthLabel || !(monthData.records || []).length) {
        state.autoReportMeta = { skipped: true, reason: 'empty-parse', ...report };
        return null;
      }

      const nextDb = RepairDB.load();
      nextDb.months[monthData.monthLabel] = monthData;
      RepairDB.save(nextDb);
      state.autoReportMeta = {
        imported: true,
        monthLabel: monthData.monthLabel,
        fileName: report.fileName,
        records: monthData.records.length,
      };
      return monthData;
    } catch (e) {
      state.autoReportMeta = { skipped: true, reason: e.message };
      console.warn('Monthly workbook sync skipped:', e.message);
      return null;
    }
  }

  // Maintainer action: produce a data.json to commit to the repo.
  function publishData() {
    try {
      if (!canMaintainData()) { alert('只有管理員可以發布共用資料'); return; }
      const raw = localStorage.getItem('repair_db_v2');
      const db = raw ? JSON.parse(raw) : { months: {} };
      if (!Object.keys(db.months || {}).length) { alert('目前沒有資料可發布,請先上傳報表'); return; }
      const KNOWN_NAMES = {
        '031780':'陳皇銘','773999':'鄧金汀','690091':'李榮貴','109004':'廖裕淳',
        '111003':'曾慕棠','114001':'楊永富','114002':'葉燕玲','114004':'林以臻',
        '114005':'徐啟芳','114007':'柯智傑','114008':'劉柏增','114011':'徐瑞霞',
        '114024':'蔡宜佑','115005':'劉書銘','068910':'高世璋',
      };
      const rawUsers = JSON.parse(localStorage.getItem('titan_users_v1') || '{}');
      // Ensure names are filled before publishing
      for (const [uid, name] of Object.entries(KNOWN_NAMES)) {
        if (rawUsers[uid] && !rawUsers[uid].name) rawUsers[uid].name = name;
      }
      const payload = {
        months: db.months,
        users: rawUsers,
        capa: JSON.parse(localStorage.getItem('titan_capa_v1') || '[]'),
        costCfg: JSON.parse(localStorage.getItem('titan_cost_cfg_v1') || 'null'),
        partsMaster: pdbMergedMaster(),
        publishedAt: new Date().toISOString(),
        publishedBy: '',
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data.json';
      a.click();
      URL.revokeObjectURL(url);
      // Mark this publish as seen locally so the maintainer isn't re-prompted.
      localStorage.setItem(CLOUD_SEEN_KEY, payload.publishedAt);
      alert('✓ 已產生 data.json\n\n請將此檔上傳/覆蓋到 GitHub repo 根目錄並 commit,\n所有人下次開啟網址就會自動同步看到這份資料。');
    } catch (e) {
      alert('發布失敗:' + e.message);
    }
  }

  function cloudStatusHtml() {
    const m = state.cloudMeta;
    const auto = state.autoReportMeta;
    const autoHtml = (() => {
      if (!auto) {
        if (!isMonthlySyncDay()) return `<div class="uz-cloud-bar ok">📁 自動月報：僅每月 1 號檢查 GitHub monthly-reports/</div>`;
        return '';
      }
      if (auto.imported) {
        return `<div class="uz-cloud-bar ok">📁 自動月報已匯入：${auto.monthLabel} · ${auto.records.toLocaleString()} 筆 · ${auto.fileName}</div>`;
      }
      const reasonMap = {
        'already-imported': `已存在 ${auto.monthLabel}，本月不重複匯入`,
        'not-found': `找不到 ${auto.fileName}，請確認已放到 monthly-reports/`,
        'empty-parse': `${auto.fileName} 沒有解析到維修資料`,
        'xlsx-not-ready': 'Excel 解析器尚未載入',
      };
      const msg = reasonMap[auto.reason] || auto.reason || '未執行';
      return `<div class="uz-cloud-bar none">📁 自動月報：${msg}</div>`;
    })();
    if (!m || !m.publishedAt) {
      return `<div class="uz-cloud-bar none">☁ 雲端尚無共用資料 — 上傳後按「發布到雲端」即可讓所有人同步</div>${autoHtml}`;
    }
    const d = new Date(m.publishedAt);
    const ds = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const syncNote = m.skipped ? ' · 本次未讀取 GitHub' : '';
    return `<div class="uz-cloud-bar ok">☁ 已連動雲端共用資料 · ${m.months} 個月份 · 發布於 ${ds}${state.cloudJustLoaded ? ' <strong>(已載入最新版)</strong>' : ''}${syncNote}</div>${autoHtml}`;
  }

  function renderUploadList() {
    const months = Object.values(state.db.months).sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));
    const uzMonths = $('uzMonths');
    if (!months.length) {
      uzMonths.style.display = 'none';
      return;
    }
    uzMonths.style.display = 'block';

    const kb = storageKB();
    const pct = Math.min(Math.round(kb / 51200 * 100), 100); // 5 MB max
    const totalRecords = months.reduce((s, m) => s + m.records.length, 0);

    $('uzMonthList').innerHTML = `
      ${cloudStatusHtml()}
      <!-- Storage bar -->
      <div class="uz-storage-bar">
        <div class="uz-storage-info">
          <span>本機儲存空間</span>
          <span class="uz-storage-val">${kb.toLocaleString()} KB / ~5 MB</span>
        </div>
        <div class="uz-storage-track">
          <div class="uz-storage-fill" style="width:${pct}%;background:${pct>80?'var(--critical)':pct>50?'var(--warn)':'var(--ok)'}"></div>
        </div>
      </div>

      <!-- Month cards -->
      <div class="uz-month-grid">
        ${months.map(m => {
          const denomTotal = Object.values(m.denominators || {}).reduce((a, b) => a + b, 0);
          // Model breakdown: top 4 by record count
          const modelCount = {};
          for (const r of m.records) {
            const k = r.model || '其他';
            modelCount[k] = (modelCount[k] || 0) + 1;
          }
          const topModels = Object.entries(modelCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
          const catCount = {};
          for (const r of m.records) {
            catCount[r.category || '其他'] = (catCount[r.category || '其他'] || 0) + 1;
          }
          const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
          const scrapCount = m.records.filter(r => r.isScrap).length;
          return `
            <div class="uz-month-card">
              <div class="uz-month-card-h">
                <div>
                  <div class="uz-month-big">${fmt.monthLabel(m.monthLabel)}</div>
                  <div class="uz-month-file">${m.fileName}</div>
                </div>
                <button class="uz-month-del" onclick="App.removeMonth('${m.monthLabel}')" title="移除此月份">✕</button>
              </div>
              <div class="uz-month-stats">
                <div class="uz-month-stat">
                  <div class="uz-month-stat-v">${m.records.length.toLocaleString()}</div>
                  <div class="uz-month-stat-l">維修筆數</div>
                </div>
                <div class="uz-month-stat">
                  <div class="uz-month-stat-v">${denomTotal.toLocaleString()}</div>
                  <div class="uz-month-stat-l">整新數</div>
                </div>
                <div class="uz-month-stat">
                  <div class="uz-month-stat-v" style="color:${scrapCount>0?'var(--critical)':'var(--ok)'}">${scrapCount}</div>
                  <div class="uz-month-stat-l">報廢件</div>
                </div>
                <div class="uz-month-stat">
                  <div class="uz-month-stat-v">${Object.keys(modelCount).length}</div>
                  <div class="uz-month-stat-l">機種數</div>
                </div>
              </div>
              <div class="uz-month-models">
                ${topModels.map(([k, n]) =>
                  `<span class="uz-model-chip" title="${k}">${k} <em>${n}</em></span>`
                ).join('')}
                ${Object.keys(modelCount).length > 5 ? `<span class="uz-model-chip uz-model-more">+${Object.keys(modelCount).length - 5}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Summary + CTA -->
      <div class="uz-cta-row">
        <div class="uz-cta-summary">
          共 <strong>${months.length}</strong> 個月份 · <strong>${totalRecords.toLocaleString()}</strong> 筆記錄
        </div>
        <div class="uz-cta-btns">
          <button class="btn primary" onclick="App.publishData()" title="產生 data.json 上傳到 GitHub,讓所有人同步看到">☁ 發布到雲端</button>
          <button class="btn" onclick="App.exportData()" title="匯出所有資料為 JSON 備份檔">⤓ 備份資料</button>
          <label class="btn" style="cursor:pointer" title="從 JSON 備份檔還原">
            ⤒ 還原備份<input type="file" id="jsonInput" accept=".json" style="display:none" onchange="App.importData(this)">
          </label>
          <button class="btn danger" onclick="App.clearAll()">清除全部</button>
          <button class="btn primary uz-enter-btn" onclick="App.openDashboard()">進入分析報表 →</button>
        </div>
      </div>
    `;
  }

  function exportData() {
    if (!canMaintainData()) { alert('只有管理員可以備份資料'); return; }
    try {
      const raw = localStorage.getItem('repair_db_v2');
      if (!raw) { alert('目前沒有資料可備份'); return; }
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const ds = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
      a.href = url;
      a.download = `TITAN-STAR備份_${ds}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('匯出失敗：' + e.message);
    }
  }

  function importData(input) {
    if (!canMaintainData()) { alert('只有管理員可以還原資料'); if (input) input.value = ''; return; }
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.months) throw new Error('不是有效的備份格式');
        localStorage.setItem('repair_db_v2', e.target.result);
        state.db = RepairDB.load();
        state.summaryBadgeDismissed = false;
        renderUploadList();
        alert(`✓ 還原成功：${Object.keys(data.months).length} 個月份已載入`);
      } catch (err) {
        alert('還原失敗：' + err.message);
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  function removeMonth(mk) {
    if (!canMaintainData()) { alert('只有管理員可以移除月份資料'); return; }
    if (!confirm(`確定移除 ${fmt.monthLabel(mk)} 的資料？`)) return;
    RepairDB.removeMonth(mk);
    state.db = RepairDB.load();
    renderUploadList();
  }

  function clearAll() {
    if (!canMaintainData()) { alert('只有管理員可以清除資料'); return; }
    if (!confirm('確定清除所有累積資料？此操作無法復原。')) return;
    state.db = RepairDB.clear();
    renderUploadList();
  }

  function confirmClear() {
    if (!canMaintainData()) { alert('只有管理員可以清除資料'); return; }
    if (!confirm('確定清除所有累積資料？此操作無法復原。')) return;
    state.db = RepairDB.clear();
    openUpload();
  }

  // ─────────────── Page switching ───────────────
  async function openDashboardDirect() {
    // 等雲端資料就緒（避免快速登入時 syncCloud 尚未完成）
    if (syncCloudPromise) { try { await syncCloudPromise; } catch(e) {} }
    // 登入後直接進主介面，不彈 alert；若無資料則顯示引導畫面
    state.db = RepairDB.load();
    $('uploadZone').style.display = 'none';
    $('dash').classList.add('active');
    if ($('modeBar')) $('modeBar').style.display = 'flex';
    if ($('rmaDash')) $('rmaDash').style.display = 'none';
    setTopbarDataControls();
    try {
      const c = localStorage.getItem('titan_subbar_collapsed');
      const sb = $('subbar');
      if (sb) sb.classList.toggle('collapsed', c === '1');
    } catch(e) {}
    try {
      const m = localStorage.getItem('titan_sidebar_mini');
      const sbar = $('sidebar');
      const layout = document.querySelector('.layout');
      const miniBtn = $('sidebarMiniToggle');
      if (m === '1') {
        if (sbar) sbar.classList.add('mini');
        if (layout) layout.classList.add('sidebar-mini');
        if (miniBtn) miniBtn.textContent = '▷';
      }
    } catch(e) {}
    if (!Object.keys(state.db.months).length) {
      // 無資料：顯示引導畫面
      $('anomGrid') && ($('anomGrid').innerHTML = '');
      const content = document.getElementById('pageOverview');
      if (content) {
        content.classList.add('active');
        // 在頁面頂端插入上傳引導卡（若尚未插入）
        if (!document.getElementById('noDataGuide')) {
          const guide = document.createElement('div');
          guide.id = 'noDataGuide';
          guide.className = 'no-data-guide';
          guide.innerHTML = `
            <div class="ndg-ico">☁</div>
            <div class="ndg-t">尚未同步報表資料</div>
            <div class="ndg-d">請確認每月維修資料已放到 GitHub 指定資料夾；重新整理或下次登入後會自動載入結果。</div>`;
          content.prepend(guide);
        }
      }
      return;
    }
    // 有資料：登入後直接回到乾淨的主管摘要，不沿用可能卡住的舊篩選。
    state.currentPage = 'summary';
    state.selectedMonths = Object.keys(state.db.months).sort();
    state.selectedCategory = '全部';
    state.selectedModel = '全部';
    renderAnalysisRoleBar();
    renderAll();
    window.scrollTo(0, 0);
    // B5: request notification permission (deferred, non-blocking)
    setTimeout(() => requestNotificationPermission(), 3000);
    // 設定瀏覽歷史基準頁，作為手機「上一頁」的返回終點
    try { history.replaceState({ __page: state.currentPage }, ''); } catch (e) {}
  }

  function openDashboard() {
    state.db = RepairDB.load();
    if (!Object.keys(state.db.months).length) {
      alert('請先上傳至少一個月份的報表');
      return;
    }
    $('uploadZone').style.display = 'none';
    $('dash').classList.add('active');
    if ($('modeBar')) $('modeBar').style.display = 'flex';
    if ($('rmaDash')) $('rmaDash').style.display = 'none';
    setTopbarDataControls();
    // Restore subbar collapsed state
    try {
      const c = localStorage.getItem('titan_subbar_collapsed');
      const sb = $('subbar');
      if (sb) sb.classList.toggle('collapsed', c === '1');
    } catch(e) {}
    // Restore sidebar mini state
    try {
      const m = localStorage.getItem('titan_sidebar_mini');
      const sbar = $('sidebar');
      const layout = document.querySelector('.layout');
      const miniBtn = $('sidebarMiniToggle');
      if (m === '1') {
        if (sbar) sbar.classList.add('mini');
        if (layout) layout.classList.add('sidebar-mini');
        if (miniBtn) miniBtn.textContent = '▷';
      }
    } catch(e) {}
    // Default: select all months, all categories
    state.selectedMonths = Object.keys(state.db.months).sort();
    state.selectedCategory = '全部';
    state.selectedModel = '全部';
    renderAnalysisRoleBar();
    renderAll();
    // Always start at top
    window.scrollTo(0, 0);
  }

  function openUpload() {
    openDashboardDirect();
  }

  // 純切換頁面 DOM（不動瀏覽歷史）
  function switchPageDom(name) {
    state.currentPage = name;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.snav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    $(`page${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
    // Dismiss badges when viewing related pages
    if (name === 'summary') dismissSummaryBadge();
    if (name === 'alerts') dismissAlertPulse();
    if (name === 'scrap') dismissCrossMonthPulse();
    collapseSubbar();
    closeNav();
    renderPage();
    window.scrollTo(0, 0);
    const rankWrap = document.getElementById('rankWrap');
    if (rankWrap) rankWrap.scrollTop = 0;
  }

  // 對外的頁面切換：納入瀏覽歷史，讓手機「上一頁」回到前一頁而非離開 App
  function switchPage(name) {
    if (name === state.currentPage && !isDrawerOpen()) return;
    if (isDrawerOpen()) {
      // 由抽屜內的「前往 XX」下鑽：關閉抽屜，並把抽屜的歷史項換成目標頁，
      // 這樣按「上一頁」會回到開抽屜前所在的頁面。
      domCloseDrawer();
      history.replaceState({ __page: name }, '');
    } else {
      history.pushState({ __page: name }, '');
    }
    switchPageDom(name);
  }

  // ─────────────── Mobile nav drawer ───────────────
  function toggleNav() {
    const sb = $('sidebar');
    if (!sb) return;
    if (sb.classList.contains('open')) closeNav(); else openNav();
  }
  function openNav() {
    const sb = $('sidebar'), ov = $('navOverlay');
    if (sb) sb.classList.add('open');
    if (ov) ov.classList.add('show');
    document.body.classList.add('nav-open');
  }
  function closeNav() {
    const sb = $('sidebar'), ov = $('navOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
    document.body.classList.remove('nav-open');
  }

  // ─────────────── Filter chips ───────────────
  function renderFilters() {
    const months = Object.keys(state.db.months).sort();
    const all = state.selectedMonths.length === 0 || state.selectedMonths.length === months.length;
    const selMonth = all ? '__ALL__' : (state.selectedMonths[0] || '__ALL__');

    // 各月整新數（分母）
    const monthDenom = {};
    let allDenom = 0;
    for (const mk of months) {
      const d = RepairAnalyzer.getDenominators(state.db, { months: [mk] }).total;
      monthDenom[mk] = d;
      allDenom += d;
    }

    // Month chips（維修件數 + 整新數）
    const mc = $('monthChips');
    mc.innerHTML = '<div class="sb-label">月份</div>'
      + `<button class="chip ${all ? 'active' : ''}" onclick="App.setMonth('__ALL__')">全部 <span class="num">${months.length}</span>${allDenom ? `<span class="num-den" title="整新數">整新 ${fmt.int(allDenom)}</span>` : ''}</button>`
      + months.map(mk => {
        const sel = !all && state.selectedMonths.includes(mk);
        const m = state.db.months[mk];
        const den = monthDenom[mk];
        return `<button class="chip ${sel ? 'active' : ''}" onclick="App.setMonth('${mk}')">${fmt.monthLabel(mk)} <span class="num">${m.records.length}</span>${den ? `<span class="num-den" title="整新數">整新 ${fmt.int(den)}</span>` : ''}</button>`;
      }).join('');

    // Mobile month select（含整新數）
    const ms = $('monthSelect');
    if (ms) {
      ms.innerHTML = `<option value="__ALL__">月份：全部 ${months.length}個月${allDenom ? ` · 整新${fmt.int(allDenom)}` : ''}</option>`
        + months.map(mk => `<option value="${mk}">${fmt.monthLabel(mk)} · 維修${state.db.months[mk].records.length}${monthDenom[mk] ? ` · 整新${fmt.int(monthDenom[mk])}` : ''}</option>`).join('');
      ms.value = selMonth;
    }

    // Category chips
    const records = RepairAnalyzer.getRecords(state.db, { months: state.selectedMonths });
    const catCounts = {};
    for (const r of records) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    const cats = ['全部', ...Object.keys(RepairParser.CATEGORY_MAP), '其他'].filter(c => c === '全部' || catCounts[c]);

    // 各大類整新數（依機種分母彙總到大類）
    const denomAll = RepairAnalyzer.getDenominators(state.db, { months: state.selectedMonths });
    const catDenom = {};
    for (const [model, n] of Object.entries(denomAll.byModel || {})) {
      const c = RepairParser.getCategory(model);
      catDenom[c] = (catDenom[c] || 0) + n;
    }
    const catDen = (c) => c === '全部' ? denomAll.total : (catDenom[c] || 0);

    const cc = $('catChips');
    cc.innerHTML = '<div class="sb-label">大類</div>'
      + cats.map(c => {
        const sel = state.selectedCategory === c;
        const count = c === '全部' ? records.length : (catCounts[c] || 0);
        const den = catDen(c);
        const color = c === '全部' ? COLORS.text3 : (CAT_COLOR[c] || COLORS.text3);
        return `<button class="chip cat-chip ${sel ? 'active' : ''}" style="--c:${color}" onclick="App.setCategory('${c}')">${c} <span class="num">${count}</span>${den ? `<span class="num-den" title="整新數">整新 ${fmt.int(den)}</span>` : ''}</button>`;
      }).join('');

    // Mobile category select（含整新數）
    const cs = $('catSelect');
    if (cs) {
      cs.innerHTML = cats.map(c => {
        const count = c === '全部' ? records.length : (catCounts[c] || 0);
        const den = catDen(c);
        const label = c === '全部' ? '大類：全部' : c;
        return `<option value="${c}">${label} · 維修${count}${den ? ` · 整新${fmt.int(den)}` : ''}</option>`;
      }).join('');
      cs.value = state.selectedCategory;
    }

    const allModelCounts = {};
    for (const r of records) allModelCounts[r.model] = (allModelCounts[r.model] || 0) + 1;
    const allModels = Object.entries(allModelCounts).sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const modelList = $('modelLookupList');
    if (modelList) {
      modelList.innerHTML = allModels.map(m => `<option value="${m}">${allModelCounts[m]} 筆</option>`).join('');
    }
    const modelInput = $('modelQuickSearch');
    if (modelInput && document.activeElement !== modelInput) {
      modelInput.value = state.selectedModel === '全部' ? '' : state.selectedModel;
    }

    // Model chips (only when a category is selected)
    if (state.selectedCategory !== '全部') {
      const inCat = records.filter(r => r.category === state.selectedCategory);
      const mCount = {};
      for (const r of inCat) mCount[r.model] = (mCount[r.model] || 0) + 1;
      const models = Object.entries(mCount).sort((a, b) => b[1] - a[1]).map(([m]) => m);
      const md = $('modelChips');
      md.style.display = 'flex';
      md.innerHTML = '<div class="sb-label">機種</div>'
        + `<button class="chip ${state.selectedModel === '全部' ? 'active' : ''}" onclick="App.setModel('全部')">全部</button>`
        + models.map(m => {
          const sel = state.selectedModel === m;
          return `<button class="chip ${sel ? 'active' : ''}" onclick="App.setModel('${m}')">${m} <span class="num">${mCount[m]}</span></button>`;
        }).join('');
    } else {
      $('modelChips').style.display = 'none';
    }
  }

  function collapseSubbar() {
    const sb = $('subbar');
    if (sb && !sb.classList.contains('collapsed')) {
      sb.classList.add('collapsed');
      try { localStorage.setItem('titan_subbar_collapsed', '1'); } catch(e) {}
    }
  }

  function collapseSidebarMini() {
    const sidebar = $('sidebar');
    const layout = document.querySelector('.layout');
    if (sidebar && !sidebar.classList.contains('mini')) {
      sidebar.classList.add('mini');
      if (layout) layout.classList.add('sidebar-mini');
      const btn = $('sidebarMiniToggle');
      if (btn) btn.textContent = '▷';
      try { localStorage.setItem('titan_sidebar_mini', '1'); } catch(e) {}
    }
  }

  function setMonth(mk) {
    const allMonths = Object.keys(state.db.months).sort();
    if (mk === '__ALL__') {
      state.selectedMonths = allMonths.slice();
    } else {
      const all = state.selectedMonths.length === allMonths.length;
      if (all) {
        state.selectedMonths = [mk];
      } else if (state.selectedMonths.includes(mk)) {
        state.selectedMonths = state.selectedMonths.filter(m => m !== mk);
        if (state.selectedMonths.length === 0) state.selectedMonths = allMonths.slice();
      } else {
        state.selectedMonths.push(mk);
      }
    }
    renderAll();
    saveFilterState();
    collapseSubbar();
  }
  function setMonthDirect(mk) {
    const allMonths = Object.keys(state.db.months).sort();
    state.selectedMonths = mk === '__ALL__' ? allMonths.slice() : [mk];
    renderAll();
    collapseSubbar();
  }

  function setCategory(c) {
    state.selectedCategory = c;
    state.selectedModel = '全部';
    renderAll();
    saveFilterState();
    collapseSubbar();
  }

  function setModel(m) {
    state.selectedModel = m;
    renderAll();
    saveFilterState();
    collapseSubbar();
  }

  let quickModelSearchTimer = null;
  let lastAutoModelSearch = '';

  function resolveModelQuery(raw) {
    const q = String(raw || '').trim();
    const records = RepairAnalyzer.getRecords(state.db, {});
    const models = Array.from(new Set(records.map(r => r.model))).sort();
    const normFn = RepairAnalyzer.normalizeModel || (s => String(s).toUpperCase().replace(/[-_\s]/g, ''));
    const norm = normFn(q);
    const exact = models.find(m => normFn(m) === norm);
    // 模糊比對兩邊都先正規化，輸入 msm-0801 / zspmg 51 也能命中
    const fuzzy = exact || (norm.length >= 3 ? models.find(m => { const nm = normFn(m); return nm.includes(norm) || norm.includes(nm); }) : null);
    return { q, norm, exact, fuzzy };
  }

  function quickModelSearchInput(raw) {
    const { q, exact } = resolveModelQuery(raw);
    clearTimeout(quickModelSearchTimer);
    if (!q || !exact) return;
    if (exact === lastAutoModelSearch && isDrawerOpen()) return;
    quickModelSearchTimer = setTimeout(() => {
      const latest = $('modelQuickSearch')?.value || raw;
      const resolved = resolveModelQuery(latest);
      if (resolved.exact && (resolved.exact !== lastAutoModelSearch || !isDrawerOpen())) {
        lastAutoModelSearch = resolved.exact;
        quickModelSearch(resolved.exact, { silentMissing: true });
      }
    }, 280);
  }

  function quickModelSearch(raw, opts = {}) {
    const { q, fuzzy } = resolveModelQuery(raw);
    if (!q) {
      state.selectedModel = '全部';
      lastAutoModelSearch = '';
      renderAll();
      saveFilterState();
      return;
    }
    if (!fuzzy) {
      if (!opts.silentMissing) alert(`找不到型號「${q}」。請確認月份範圍是否包含該型號。`);
      return;
    }
    lastAutoModelSearch = fuzzy;
    state.selectedCategory = '全部';
    state.selectedModel = fuzzy;
    state.selectedMonths = Object.keys(state.db.months).sort();
    // 必須真正切換頁面 DOM（.page.active / 導覽高亮），
    // 否則在其他分頁搜尋時結果會渲染進隱藏的摘要頁，看起來像沒反應
    if (state.currentPage !== 'summary') {
      try { history.pushState({ __page: 'summary' }, ''); } catch (e) {}
      switchPageDom('summary');   // 內含 renderPage()
      safeRenderStep('filters', renderFilters);
      safeRenderStep('subbar summary', updateSubbarSummary);
    } else {
      renderAll();
    }
    saveFilterState();
    collapseSubbar();
  }

  // ─────────────── Render orchestration ───────────────
  function safeRenderStep(name, fn) {
    try {
      fn();
      return true;
    } catch (e) {
      console.error(`[render] ${name} failed:`, e);
      return false;
    }
  }

  function renderFallbackDashboard(error) {
    const months = Object.keys((state.db && state.db.months) || {}).sort();
    const rows = countDbRecords(state.db);
    const meta = $('summaryMeta');
    if (meta) meta.textContent = `${months.length} 個月 · ${rows.toLocaleString()} 筆`;

    const kpi = $('sumKpi');
    if (kpi) {
      kpi.innerHTML = `
        <div class="kpi k-blue"><div class="kpi-h"><div class="kpi-l">資料月份</div><div class="kpi-ico">#</div></div>
          <div class="kpi-v">${months.length}</div><div class="kpi-d"><span class="muted">${months.map(fmt.monthLabel).join(' / ')}</span></div></div>
        <div class="kpi k-info"><div class="kpi-h"><div class="kpi-l">維修筆數</div><div class="kpi-ico">≡</div></div>
          <div class="kpi-v">${rows.toLocaleString()}</div><div class="kpi-d"><span class="muted">已成功載入資料</span></div></div>`;
    }

    const body = $('sumBody') || document.querySelector('.page.active');
    if (body) {
      body.innerHTML = `
        <div class="card render-fallback">
          <div class="empty">
            <div class="empty-ico">i</div>
            <div class="empty-t">資料已載入，但摘要頁有一段顯示失敗</div>
            <div class="empty-d">可以先按「總覽」查看完整資料；系統已避免卡在空白頁。</div>
            <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
              <button class="btn primary" onclick="App.switchPage('overview')">看總覽</button>
              <button class="btn" onclick="App.switchPage('alerts')">看異常</button>
            </div>
          </div>
        </div>`;
    }

    if (error) console.error('[render] fallback shown:', error);
  }

  function renderAll() {
    // 資料庫摘要在 subbar 第二列，hdrSub 不再使用

    safeRenderStep('filters', renderFilters);
    safeRenderStep('role bar', renderAnalysisRoleBar);
    safeRenderStep('alert badge', updateAlertBadge);
    safeRenderStep('summary badge', updateSummaryBadge);
    const pageOk = safeRenderStep('page', renderPage);
    if (!pageOk) renderFallbackDashboard();
    safeRenderStep('subbar summary', updateSubbarSummary);
  }

  // What each role should focus on — shown in the global banner on every page.
  const ROLE_FOCUS = {
    all:      '全域核心指標與最嚴重異常',
    ceo:      '戰略績效、財務曝險與紅線異常',
    factory:  '跨部門待協調事項與產能積壓',
    procure:  '高用量零件、出廠批次來料瑕疵與安全庫存',
    prod:     '高故障/高報廢機種、製程與批次缺陷',
    qa:       '重複維修、批次/早夭、CAPA 與保固責任',
    logistics:'報廢影響出貨、重工循環與流量',
    cs:       '跨月重複故障客戶、保固曝險與客訴風險',
    repair:   '主力備料、報廢主因與返修品質',
    hw:       '設計缺陷、元件可靠性與 ECO 候選',
    fw:       '韌體關鍵字故障與 OTA 候選',
    finance:  '品質成本 COPQ、報廢金額與改善 ROI',
    sales:    '產品口碑紅黃綠燈與可推廣機種',
  };

  function setAnalysisRole(role) {
    state.analysisRole = role;
    renderAnalysisRoleBar();
    renderPage();   // role now affects every page (summary / overview / per-page banner)
  }

  function renderAnalysisRoleBar() {
    // Legacy in-content bar (kept for fallback, may be empty)
    const bar = $('analysisRoleBar');
    if (bar) bar.innerHTML = '';

    // Top-bar compact selector
    const cur = state.analysisRole;
    const curR = ANALYSIS_ROLES[cur] || ANALYSIS_ROLES.all;
    const ico = $('roleSelIco');
    const lbl = $('roleSelLabel');
    const foc = $('roleSelFocus');
    if (ico) { ico.textContent = curR.icon; ico.style.color = curR.color; }
    if (lbl) lbl.textContent = `角色觀點：${curR.short}`;
    if (foc) foc.textContent = '重點：' + (ROLE_FOCUS[cur] || curR.desc);

    // Rebuild dropdown items
    const drop = $('roleSelDrop');
    if (drop) {
      drop.innerHTML = Object.entries(ANALYSIS_ROLES).map(([k, r]) =>
        `<button class="role-sel-item ${k === cur ? 'active' : ''}" style="--rc:${r.color}"
          onclick="App.setAnalysisRole('${k}');App.closeRoleDropdown()" title="${r.desc}">
          <span style="color:${r.color}">${r.icon}</span><span>${r.label}</span>
        </button>`
      ).join('');
    }
    // Mobile select: populate once, sync value always
    const msel = $('roleSelMobile');
    if (msel) {
      if (!msel.options.length) {
        msel.innerHTML = Object.entries(ANALYSIS_ROLES).map(([k, r]) =>
          `<option value="${k}">${r.icon} 角色觀點：${r.label}</option>`).join('');
      }
      msel.value = cur;
    }

    // In-content banner hidden: focus now shown beside the top-bar selector
    const gb = $('globalRoleBanner');
    if (gb) gb.style.display = 'none';
  }

  function toggleRoleDropdown() {
    const drop = $('roleSelDrop');
    if (!drop) return;
    const open = drop.style.display !== 'none';
    drop.style.display = open ? 'none' : '';
    if (!open) {
      const close = (e) => {
        if (!$('roleSelWrap').contains(e.target)) {
          drop.style.display = 'none';
          document.removeEventListener('click', close);
        }
      };
      setTimeout(() => document.addEventListener('click', close), 0);
    }
  }

  function closeRoleDropdown() {
    const drop = $('roleSelDrop');
    if (drop) drop.style.display = 'none';
  }

  function toggleSidebarMini() {
    const sidebar = $('sidebar');
    const layout = document.querySelector('.layout');
    if (!sidebar) return;
    const isMini = sidebar.classList.toggle('mini');
    if (layout) layout.classList.toggle('sidebar-mini', isMini);
    const btn = $('sidebarMiniToggle');
    if (btn) btn.textContent = isMini ? '▷' : '◁';
    try { localStorage.setItem('titan_sidebar_mini', isMini ? '1' : '0'); } catch(e) {}
  }

  function toggleSubbar() {
    const sb = $('subbar');
    if (!sb) return;
    const collapsed = sb.classList.toggle('collapsed');
    try { localStorage.setItem('titan_subbar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
  }

  function updateSubbarSummary() {
    if (!state.db) return;
    const el = $('subbarSummaryText');
    if (!el) return;

    const allMonthKeys = Object.keys(state.db.months).sort();
    const allIsSelected = state.selectedMonths.length === allMonthKeys.length;
    const cat = state.selectedCategory || '全部';
    const model = state.selectedModel || '全部';

    // Build stats for current filter
    const filteredRecords = RepairAnalyzer.getRecords(state.db, { months: state.selectedMonths, category: cat === '全部' ? null : cat, model: model === '全部' ? null : model });
    const filteredRefurb = state.selectedMonths.reduce((s, mk) => s + Object.values((state.db.months[mk] || {}).denominators || {}).reduce((a, b) => a + b, 0), 0);

    // Month label
    const monthLabel = allIsSelected
      ? `月份(全部)`
      : state.selectedMonths.map(m => { const [y, mo] = m.split('-'); return `${parseInt(y)-1911}/${mo}`; }).join('、');

    // Category/model label
    let catLabel = '';
    if (cat === '全部') {
      catLabel = '大類(全部)';
    } else if (model !== '全部') {
      catLabel = `${model}`;
    } else {
      catLabel = `大類/${cat}`;
    }

    // Stats line
    const nMonths = state.selectedMonths.length;
    const statsLabel = `${nMonths}個月 · ${filteredRecords.length.toLocaleString()}筆紀錄${filteredRefurb > 0 ? ` · 整新數 ${filteredRefurb.toLocaleString()}` : ''}`;

    el.innerHTML = `<span class="sb-pill">${monthLabel}</span><span class="sb-pill">${catLabel}</span><span class="sb-pill-stat">${filteredRecords.length.toLocaleString()}筆</span>`;
  }

  function renderGlobalRoleBanner() {
    // 角色焦點已移至頂列選擇器旁，內容區橫幅不再顯示
    const el = $('globalRoleBanner');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  // ─── Role-specific insight engine ───
  function computeRoleInsights(role, records, kpis, anoms, allRecords) {
    const allMonths = state.selectedMonths.slice().sort();
    const curMonthKey = allMonths[allMonths.length - 1];
    const prevMonthKey = allMonths[allMonths.length - 2];

    // Shared derived data
    const scrapRecs  = records.filter(r => r.isScrap);
    const pareto     = RepairAnalyzer.partPareto(records);
    const crossSerial = RepairAnalyzer.crossMonthSerials(state.db, {});

    // Keyword search helpers
    const hasKw = (r, kws) => kws.some(kw => (r.content || r.faultContent || '').includes(kw) || (r.faultCause || '').includes(kw));
    const kwCount = (kws) => records.filter(r => hasKw(r, kws)).length;

    // Per-category counts
    const catCount = {};
    for (const r of records) catCount[r.category || '其他'] = (catCount[r.category || '其他'] || 0) + 1;

    // Top model fault info
    const modelCount = {};
    for (const r of records) modelCount[r.model] = (modelCount[r.model] || 0) + 1;
    const topModel = Object.entries(modelCount).sort((a,b)=>b[1]-a[1])[0];

    // Month-on-month comparison
    let momText = null;
    if (curMonthKey && prevMonthKey) {
      const curRecs = state.db.months[curMonthKey]?.records || [];
      const prevRecs = state.db.months[prevMonthKey]?.records || [];
      const delta = curRecs.length - prevRecs.length;
      const sign = delta > 0 ? '+' : '';
      momText = `${fmt.monthLabel(curMonthKey)} vs ${fmt.monthLabel(prevMonthKey)}：維修量 <strong style="color:${delta>0?'var(--critical)':delta<0?'var(--ok)':'var(--text2)'}">${sign}${delta}</strong> 件`;
    }

    // Repeated serials within selected period
    const serialMap = {};
    for (const r of records) {
      if (!r.serial) continue;
      const k = `${r.model}|${r.serial}`;
      serialMap[k] = (serialMap[k] || 0) + 1;
    }
    const repeatedList = Object.entries(serialMap).filter(([,c]) => c >= 2).sort((a,b)=>b[1]-a[1]);

    // Warranty-in records (保固內)
    const warrantyIn = records.filter(r => (r.warranty || '').includes('保固') || (r.warranty || '').toLowerCase() === 'y' || (r.warrantyType || '').includes('保固'));

    // Firmware keywords
    const fwKws = ['韌體','異常關機','無回應','當機','重啟','升級','OTA','firmware','update','版本','軟體','APP'];
    const fwRecs = records.filter(r => hasKw(r, fwKws));

    // Hardware-design keywords (排除純軟體)
    const hwKws = ['斷路','焊接','電容','電阻','PCB','主板','電源板','線路','短路','開路','元件','接腳','腐蝕','燒毀','變形'];
    const hwRecs = records.filter(r => hasKw(r, hwKws));

    // Top 3 anomalies filtered by role
    const roleAnomMap = {
      all:      anoms,
      ceo:      anoms.filter(a => a.severity === 'critical' || a.severity === 'warn'),
      factory:  anoms,
      procure:  anoms.filter(a => (a.title||'').includes('零件') || (a.title||'').includes('用量')),
      prod:     anoms.filter(a => (a.title||'').includes('故障') || (a.title||'').includes('機種')),
      qa:       anoms.filter(a => (a.title||'').includes('重複') || (a.title||'').includes('保固') || a.severity === 'critical'),
      logistics:anoms.filter(a => (a.title||'').includes('報廢') || (a.title||'').includes('零件')),
      cs:       anoms.filter(a => (a.title||'').includes('重複') || (a.title||'').includes('保固')),
      repair:   anoms,
      hw:       anoms.filter(a => a.severity === 'critical'),
      fw:       anoms.filter(a => (a.title||'').includes('零件') || (a.title||'').includes('重複')),
      finance:  anoms.filter(a => (a.title||'').includes('報廢') || a.severity === 'critical'),
      sales:    anoms.filter(a => (a.title||'').includes('故障率') || (a.title||'').includes('重複') || a.severity === 'critical'),
    };
    const roleAnoms = (roleAnomMap[role] || anoms).slice(0, 3);

    const insights = [];

    const addCard = (icon, color, title, body, tag, nav) => {
      insights.push({ icon, color, title, body, tag, nav });
    };

    switch (role) {
      case 'all':
        if (momText) addCard('↗','var(--accent)','月度比較',momText,'趨勢');
        if (kpis.scrapPct >= 5) addCard('✕','var(--critical)','報廢警示',`報廢率 <strong>${fmt.pct(kpis.scrapPct)}</strong>，已達警戒線（5%），建議立即調查主因機種`,'品質');
        if (repeatedList.length > 0) addCard('♺','var(--warn)','重複維修',`共 <strong>${repeatedList.length}</strong> 台機器在篩選期間維修 ≥2 次；最高：${repeatedList[0][0].split('|')[1]} ×${repeatedList[0][1]}`,'品質');
        if (crossSerial.length > 0) addCard('⇄','var(--info)','跨月重複',`<strong>${crossSerial.length}</strong> 台序號跨月出現，疑似長期未解決問題`,'追蹤','scrap');
        break;

      case 'ceo':
        addCard('◈','var(--info)','經營摘要',`累積維修 <strong>${fmt.int(kpis.totalRepairs)}</strong> 件 / 整新數 <strong>${fmt.int(kpis.denomTotal)}</strong>，整體故障率 <strong>${fmt.pct(kpis.denomPct)}</strong>`,'績效');
        if (kpis.scrapPct >= 3) addCard('✕','var(--critical)','財務風險',`報廢 <strong>${fmt.int(kpis.scrap)}</strong> 件（${fmt.pct(kpis.scrapPct)}），每件報廢代表直接物料損失，需主管評估報廢原因集中度`,'風險');
        if (crossSerial.length >= 5) addCard('⇄','var(--warn)','品牌曝險',`<strong>${crossSerial.length}</strong> 台機器跨月重複故障，若涉及保固條款，可能引發客訴升級`,'風險','scrap');
        if (anoms.filter(a=>a.severity==='critical').length > 0) addCard('!','var(--critical)','緊急異常',`本期偵測到 <strong>${anoms.filter(a=>a.severity==='critical').length}</strong> 項嚴重異常，需優先關注`,'決策');
        if (momText) addCard('↗','var(--accent)','月度動向',momText,'趨勢');
        break;

      case 'factory':
        addCard('⊙','var(--ok)','全廠概況',`${Object.entries(catCount).map(([c,n])=>`${c} ${n}件`).join(' · ')}`,'總覽');
        if (anoms.length > 0) addCard('!','var(--warn)','待協調事項',`本期偵測 <strong>${anoms.length}</strong> 項異常，涉及多部門需跨部門協調`,'調度');
        if (repeatedList.length > 5) addCard('♺','var(--warn)','積壓風險',`<strong>${repeatedList.length}</strong> 台機器重複進廠，佔用維修產能，建議與品檢確認根本原因`,'資源');
        if (momText) addCard('↗','var(--accent)','產量比較',momText,'趨勢');
        {
          const capaList = loadCapa();
          const capaOpen = capaList.filter(c => c.status !== 'closed');
          const today = new Date().toISOString().slice(0,10);
          const capaOverdue = capaOpen.filter(c => c.due && c.due < today);
          const criticalAnoms = anoms.filter(a => a.severity === 'critical');
          const todoItems = [];
          if (capaOverdue.length) {
            const names = capaOverdue.slice(0,2).map(c=>`#${c.id} ${(c.problem||'').slice(0,15)}`).join('、');
            todoItems.push(`⚠ CAPA 逾期 ${capaOverdue.length} 項（${names}${capaOverdue.length>2?'…':''}）`);
          }
          if (criticalAnoms.length) {
            const anames = criticalAnoms.slice(0,2).map(a=>a.title).join('、');
            todoItems.push(`🔴 嚴重異常 ${criticalAnoms.length} 項（${anames}${criticalAnoms.length>2?'…':''}）`);
          }
          if (capaOpen.length > 0 && !capaOverdue.length) todoItems.push(`📌 進行中 CAPA ${capaOpen.length} 項`);
          if (todoItems.length) {
            addCard('📋','var(--critical)','今日跨部門待辦', todoItems.join(' · '), '協調');
          }
        }
        break;

      case 'procure':
        if (pareto.length > 0) addCard('◎','var(--warn)','採購觸發',`最高換件：<strong>${pareto[0].name}</strong> ×${pareto[0].count}，涉及 ${pareto[0].models.length} 機種；建議評估安全庫存`,'庫存');
        if (pareto.length > 2) addCard('▤','var(--info)','零件集中度',`前 3 大零件：${pareto.slice(0,3).map(p=>`${p.name}(${p.count})`).join('、')}，佔總用量 ${fmt.pct(pareto.slice(0,3).reduce((s,p)=>s+p.count,0)/Math.max(records.length,1)*100)}`,'分析');
        const multiModelParts = pareto.filter(p => p.models.length >= 3);
        if (multiModelParts.length > 0) addCard('⇄','var(--critical)','跨機種零件',`<strong>${multiModelParts[0].name}</strong> 跨 ${multiModelParts[0].models.length} 機種，若庫存不足將多線停修`,'風險');
        if (momText) addCard('↗','var(--accent)','用量趨勢',momText,'趨勢');
        break;

      case 'prod': {
        if (topModel) addCard('⚙','var(--warn)','故障最多機種',`<strong>${topModel[0]}</strong> 維修量最高（${topModel[1]} 件），佔整體 ${fmt.pct(topModel[1]/Math.max(kpis.totalRepairs,1)*100)}`,'良率');
        addCard('◈','var(--info)','機種數量',`本期涉及 <strong>${kpis.models}</strong> 個機種，${Object.entries(catCount).map(([c,n])=>`${c} ${n}件`).join('、')}`,'生產');
        if (scrapRecs.length > 0) {
          const scrapByModel = {};
          for (const r of scrapRecs) scrapByModel[r.model] = (scrapByModel[r.model]||0)+1;
          const topScrapModel = Object.entries(scrapByModel).sort((a,b)=>b[1]-a[1])[0];
          addCard('✕','var(--critical)','報廢集中',`報廢最高機種：<strong>${topScrapModel[0]}</strong> ×${topScrapModel[1]}，建議確認製程 SOP`,'品質');
        }
        // 本月 vs 上月機種品質快照
        if (curMonthKey && prevMonthKey) {
          const curByModel = {}, prevByModel = {};
          for (const r of (state.db.months[curMonthKey]?.records||[])) curByModel[r.model] = (curByModel[r.model]||0)+1;
          for (const r of (state.db.months[prevMonthKey]?.records||[])) prevByModel[r.model] = (prevByModel[r.model]||0)+1;
          const allM = [...new Set([...Object.keys(curByModel),...Object.keys(prevByModel)])];
          const changed = allM
            .map(m => ({ m, cur: curByModel[m]||0, prv: prevByModel[m]||0 }))
            .filter(x => x.cur > 0)
            .sort((a,b) => b.cur - a.cur)
            .slice(0, 5);
          if (changed.length) {
            const rows = changed.map(x => {
              const d = x.cur - x.prv;
              const arrow = d > 0 ? `▲${d}` : d < 0 ? `▼${Math.abs(d)}` : '—';
              const color = d > 0 ? 'var(--critical)' : d < 0 ? 'var(--ok)' : 'var(--text3)';
              return `${x.m} ${x.cur}件 <span style="color:${color}">${arrow}</span>`;
            }).join('　');
            addCard('📊','var(--info)','機種品質快照（本月 vs 上月）', rows, '生產');
          }
        }
        break;
      }

      case 'qa':
        addCard('◇','var(--warn)','重複維修率',`同期重複進廠 <strong>${repeatedList.length}</strong> 台（${fmt.pct(repeatedList.length/Math.max(kpis.totalRepairs,1)*100)}），是品質未閉環的指標`,'CAPA');
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','跨月重複',`<strong>${crossSerial.length}</strong> 台跨月重複，強烈建議開立 CAPA 追蹤`,'CAPA','scrap');
        if (warrantyIn.length > 0) addCard('◉','var(--info)','保固退回',`保固期內 <strong>${warrantyIn.length}</strong> 件（${fmt.pct(warrantyIn.length/Math.max(kpis.totalRepairs,1)*100)}），需評估設計或製程責任`,'品質');
        addCard('✕','var(--critical)','報廢率',`${fmt.pct(kpis.scrapPct)}（${kpis.scrap} 件），${kpis.scrapPct>=10?'已達高風險':'建議持續監控'}`,'品質');
        break;

      case 'logistics':
        addCard('↗','var(--ok)','流量概況',`本期收件 <strong>${fmt.int(kpis.totalRepairs)}</strong>，報廢 <strong>${fmt.int(kpis.scrap)}</strong>，有效出貨率 <strong>${fmt.pct((kpis.totalRepairs-kpis.scrap)/Math.max(kpis.totalRepairs,1)*100)}</strong>`,'流量');
        if (kpis.scrapPct >= 5) addCard('✕','var(--critical)','報廢影響',`報廢率 ${fmt.pct(kpis.scrapPct)}，影響有效出貨量，需與生產協調補件計畫`,'調度');
        if (repeatedList.length > 0) addCard('♺','var(--warn)','重工循環',`${repeatedList.length} 台重複進廠，造成物流二次處理成本`,'成本');
        if (momText) addCard('↗','var(--accent)','月度比較',momText,'趨勢');
        break;

      case 'cs':
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','高風險客戶',`<strong>${crossSerial.length}</strong> 台跨月重複故障，若持續未修好將導致客戶投訴升級`,'客訴','scrap');
        if (warrantyIn.length > 0) addCard('◉','var(--warn)','保固曝險',`保固期內 <strong>${warrantyIn.length}</strong> 件（${fmt.pct(warrantyIn.length/Math.max(kpis.totalRepairs,1)*100)}），建議主動聯繫客戶說明修復進度`,'保固');
        addCard('♺','var(--info)','回修滿意度風險',`重複進廠 ${repeatedList.length} 台，重複報修是客戶不滿最直接的信號`,'服務');
        if (topModel) addCard('⚙','var(--warn)','主訴機種',`${topModel[0]} 維修量最高（${topModel[1]}件），客服話術應準備對應說明`,'溝通');
        break;

      case 'repair':
        if (pareto.length > 0) addCard('▤','var(--warn)','主力零件',`<strong>${pareto[0].name}</strong> 使用最頻繁（${pareto[0].count}次），備料優先級最高`,'備料');
        if (scrapRecs.length > 0) {
          const scrapCauses = {};
          for (const r of scrapRecs) {
            const cause = r.faultCause || r.content || '不明';
            scrapCauses[cause] = (scrapCauses[cause]||0)+1;
          }
          const topCause = Object.entries(scrapCauses).sort((a,b)=>b[1]-a[1])[0];
          addCard('✕','var(--critical)','報廢主因',`最常見報廢原因：<strong>${topCause[0]}</strong>（${topCause[1]}件），需技術研討是否可降低報廢率`,'技術');
        }
        addCard('♺','var(--info)','重修率',`重複進廠 ${repeatedList.length} 台，疑似首修未解決，請確認技師維修紀錄完整性`,'品質');
        if (momText) addCard('↗','var(--accent)','工作量比較',momText,'趨勢');
        break;

      case 'hw':
        if (hwRecs.length > 0) addCard('◁','var(--warn)','疑似設計缺陷',`含硬體關鍵字記錄 <strong>${hwRecs.length}</strong> 件（${fmt.pct(hwRecs.length/Math.max(kpis.totalRepairs,1)*100)}），建議歸類 ECO 候選`,'ECO');
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','設計根因',`${crossSerial.length} 台跨月重複故障，若硬體設計問題未改版，將持續復發`,'ECO','scrap');
        if (scrapRecs.length > 0) addCard('✕','var(--warn)','元件可靠性',`報廢 ${scrapRecs.length} 件，建議確認主要報廢原因是否與特定元件批次相關`,'可靠度');
        if (topModel) addCard('⚙','var(--info)','高關注機種',`${topModel[0]} 維修量最高，若屬硬體問題需優先安排設計審查`,'審查');
        break;

      case 'fw': {
        if (fwRecs.length > 0) {
          // 機種分布
          const fwByModel = {};
          for (const r of fwRecs) fwByModel[r.model] = (fwByModel[r.model]||0)+1;
          const fwTop = Object.entries(fwByModel).sort((a,b)=>b[1]-a[1]).slice(0,4);
          const fwModelDetail = fwTop.map(([m,n])=>`${m}（${n}件）`).join('、');
          addCard('▷','var(--warn)','韌體相關故障機種分布',`共 ${fwRecs.length} 件（${fmt.pct(fwRecs.length/Math.max(kpis.totalRepairs,1)*100)}）。依機種：${fwModelDetail}。建議逐機種確認在役韌體版本是否一致`,'OTA');
          // 常見故障描述摘要
          const fwContentMap = {};
          for (const r of fwRecs) {
            const key = (r.content || r.reason || '').trim().slice(0,30);
            if (key) fwContentMap[key] = (fwContentMap[key]||0)+1;
          }
          const fwTopContent = Object.entries(fwContentMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
          if (fwTopContent.length) {
            addCard('📝','var(--info)','韌體故障描述 TOP3',fwTopContent.map(([k,n])=>`「${k}」×${n}`).join('；'),'分析');
          }
        } else {
          addCard('▷','var(--ok)','韌體狀況','本期未偵測到明顯韌體相關故障關鍵字，韌體穩定度良好','OTA');
        }
        if (crossSerial.length > 0) addCard('⇄','var(--info)','潛在韌體根因',`${crossSerial.length} 台跨月重複，若排除硬體因素，需確認韌體 OTA 是否成功落版`,'追蹤','scrap');
        break;
      }

      case 'finance': {
        const cfg = (function(){ try { return JSON.parse(localStorage.getItem('titan_cost_cfg_v1')||'null'); } catch { return null; } })();
        const cost = RepairAnalyzer.costAnalysis(records, cfg || {});
        if (cost.configured) {
          const money = (n)=>'NT$ '+Math.round(n).toLocaleString('en');
          addCard('$','var(--critical)','品質成本 COPQ',`本期總損失 <strong>${money(cost.totalCost)}</strong>（報廢 ${money(cost.scrapCost)} + 工時 ${money(cost.laborCost)}）`,'成本');
          if (cost.byCategory.length) addCard('▤','var(--warn)','損失最高類別',`<strong>${cost.byCategory[0].cat}</strong>：${money(cost.byCategory[0].total)}，是成本改善的第一優先`,'ROI');
        } else {
          addCard('$','var(--info)','尚未設定單價',`只需填入「每台維修成本」與「每台報廢損失」兩個數字，系統即自動計算本期 COPQ。目前本期 ${fmt.int(kpis.scrap)} 件報廢尚未量化損失。`,'設定');
        }
        if (kpis.scrap > 0) addCard('✕','var(--critical)','報廢件數',`本期報廢 <strong>${kpis.scrap}</strong> 件，每一件都是直接物料損失，高單價機種尤須關注`,'損失');
        const fc = RepairAnalyzer.forecastNextMonth(state.db, {});
        if (fc.ready) addCard('↗','var(--accent)','下月成本預估',`預估下月維修 <strong>${fc.forecast}</strong> 件（${fc.deltaPct>=0?'+':''}${fc.deltaPct.toFixed(0)}%），可據此估算下月品質成本`,'預測');
        break;
      }

      case 'sales': {
        // 產品口碑紅黃綠燈
        const ranks = RepairAnalyzer.modelRank(records, RepairAnalyzer.getDenominators(state.db, currentFilter()), state.db, state.selectedMonths);

        // Compute consecutive green months for each model
        const stableModels = [];
        const improvedModels = [];
        for (const r of ranks) {
          if (!r.history || r.history.length < 2) continue;
          const hist = r.history.filter(h => h.denom > 0);
          if (hist.length < 2) continue;
          let consecutive = 0;
          for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].faultRate != null && hist[i].faultRate < 0.05) consecutive++;
            else break;
          }
          if (consecutive >= 2) stableModels.push({ model: r.model, months: consecutive });
          const last = hist[hist.length - 1];
          const prev = hist[hist.length - 2];
          if (last.faultRate != null && last.faultRate < 0.05 &&
              prev.faultRate != null && prev.faultRate >= 0.05) {
            improvedModels.push(r.model);
          }
        }

        const risky = ranks.filter(r => (r.faultRate||0) >= 0.1 || r.scrap > 0).slice(0,3);
        const stable = ranks.filter(r => (r.faultRate!=null) && r.faultRate < 0.05).slice(0,3);
        if (risky.length) {
          const riskyDetail = risky.map(r=>`${r.model}（故障率${r.faultRate!=null?(r.faultRate*100).toFixed(1)+'%':'—'}${r.scrap>0?'、有報廢':''}）`).join('；');
          addCard('●','var(--critical)','需謹慎銷售（紅燈）',`${riskyDetail}，對外溝通宜保守，可說「持續改善中」`,'口碑');
        }
        if (stableModels.length) {
          const stableDetail = stableModels.slice(0,4).map(m=>`${m.model}（連續${m.months}月低故障）`).join('；');
          addCard('●','var(--ok)','可安心主推（穩定 ≥2月）',`${stableDetail}。推薦說法：「品質穩定、通過連續多月考驗」`,'推廣');
        } else if (stable.length) {
          addCard('●','var(--ok)','可安心主推（綠燈）',`${stable.map(r=>`${r.model}（故障率${r.faultRate!=null?(r.faultRate*100).toFixed(1)+'%':'—'}）`).join('；')}，適合作為主力推廣機種`,'推廣');
        }
        if (improvedModels.length) addCard('↗','var(--accent)','近期改善機種',`${improvedModels.slice(0,3).join('、')} 從高故障轉為穩定，推薦說法：「已完成品質改善，近期表現顯著提升」`,'改善');
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','客戶信心風險',`<strong>${crossSerial.length}</strong> 台跨月重複故障，這是客戶實際感受到的「不可靠」，恐影響續單`,'客戶','scrap');
        if (topModel) addCard('⚙','var(--warn)','主訴機種',`${topModel[0]} 維修量最高（${topModel[1]}件），備好說法：「已列入重點追蹤，改善方案進行中」`,'溝通');
        const monthCount = Object.keys(state.db.months).length;
        const sampleNote = monthCount < 6
          ? `目前僅 ${monthCount} 個月資料，口碑判定為「估算性質」，建議 6 個月後作為正式依據。紅/綠燈可用於內部參考，對外溝通請保守。`
          : `資料已達 ${monthCount} 個月，口碑判定信度提升，可作為業務說明依據。`;
        addCard('ℹ','var(--info)','口碑資料信度', sampleNote, '注意');
        break;
      }
    }

    return { insights, roleAnoms };
  }

  function renderRoleInsights(role, records, kpis, anoms) {
    const roleInfo = ANALYSIS_ROLES[role] || ANALYSIS_ROLES.all;
    const { insights, roleAnoms } = computeRoleInsights(role, records, kpis, anoms);
    const el = $('roleInsightPanel');
    if (!el) return;

    if (role === 'all' && insights.length === 0) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = `
      <div class="ri-banner" style="--rc:${roleInfo.color}">
        <span class="ri-banner-ico">${roleInfo.icon}</span>
        <span class="ri-banner-label">${roleInfo.label} 視角</span>
        <span class="ri-banner-desc">${roleInfo.desc}</span>
      </div>
      <div class="ri-cards">
        ${insights.map(ins => {
          const page = ins.nav || TAG_PAGE[ins.tag] || null;
          const clickable = page && page !== state.currentPage;
          const navLabel = clickable ? (PAGE_NAME[page] || page) : '';
          return `
          <div class="ri-card${clickable ? ' ri-card-clickable' : ''}" style="--rc:${ins.color}"
               ${clickable ? `role="button" tabindex="0" onclick="App.switchPage('${page}')"` : ''}>
            <div class="ri-card-top">
              <span class="ri-card-ico">${ins.icon}</span>
              <span class="ri-card-tag">${ins.tag}</span>
              ${clickable ? `<span class="ri-card-go">前往 ${navLabel} →</span>` : ''}
            </div>
            <div class="ri-card-title">${ins.title}</div>
            <div class="ri-card-body">${ins.body}</div>
          </div>`;
        }).join('')}
      </div>
      ${roleAnoms.length > 0 ? `
        <div class="ri-anoms-label">本視角相關異常警示</div>
        <div class="ri-anoms">
          ${roleAnoms.map(a => {
            const gi = (state.currentAnomalies || []).indexOf(a);
            return `
            <div class="ri-anom ${a.severity}" role="button" tabindex="0" onclick="App.openAnomalyDrawer(${gi})">
              <span class="ri-anom-ico">${a.icon}</span>
              <span class="ri-anom-t">${a.title}</span>
              <span class="ri-anom-m">${escapeHtml(a.subject)}</span>
              <span class="ri-anom-arrow">→</span>
            </div>`;
          }).join('')}
        </div>
      ` : ''}
    `;
  }

  function currentFilter() {
    return {
      months: state.selectedMonths,
      category: state.selectedCategory,
      model: state.selectedModel,
    };
  }

  // ═══════════════ Manager Summary (per-role digest report) ═══════════════
  // Gather findings from EVERY analysis engine, tag each with the roles that
  // care + a drill-down page; the summary page then filters by role and groups
  // by severity — so each manager sees a clean, prioritised "to-track" list.
  const SEV_RANK = { critical: 0, warn: 1, info: 2 };
  const PAGE_NAME = { summary:'主管摘要', overview:'總覽', alerts:'異常偵測', parts:'零件 Pareto', cross:'跨機種矩陣', trend:'月份趨勢', reason:'故障原因', quality:'品質/SPC', batch:'製造批次', risk:'風險/根因', capa:'CAPA', cost:'成本量化', scrap:'報廢/重修', detail:'明細' };
  // 角色洞察摘要卡的標籤 → 最相關分頁，點卡片即下鑽到該頁看完整資料
  const TAG_PAGE = {
    趨勢:'trend', 預測:'trend', 月度:'trend',
    品質:'quality', 良率:'quality', 可靠度:'quality',
    風險:'risk', 決策:'risk', ECO:'risk', 根因:'risk',
    報廢:'scrap', 損失:'scrap', 流量:'scrap',
    CAPA:'capa', 改善:'capa', ROI:'capa', 審查:'capa',
    成本:'cost', 設定:'cost',
    庫存:'parts', 備料:'parts', 零件:'parts',
    OTA:'reason', 韌體:'reason', 原因:'reason',
    批次:'batch', 製程:'batch',
    追蹤:'cross',
    客戶:'detail', 客訴:'detail', 保固:'detail', 服務:'detail', 溝通:'detail', 口碑:'detail', 推廣:'detail', 技術:'detail',
    調度:'alerts', 資源:'alerts',
    績效:'overview', 總覽:'overview', 生產:'overview', 分析:'overview',
  };

  function gatherFindings(records, kpis, anoms) {
    const f = currentFilter();
    const findings = [];
    const add = (o) => findings.push(o);

    // (1) Anomalies → role-tagged
    const anomRoles = (a) => {
      const t = a.title || '';
      const roles = new Set(['factory']);
      if (a.severity === 'critical') ['ceo', 'qa'].forEach(r => roles.add(r));
      if (t.includes('零件') || t.includes('用量')) ['procure', 'repair'].forEach(r => roles.add(r));
      if (t.includes('故障') || t.includes('機種')) ['prod', 'sales'].forEach(r => roles.add(r));
      if (t.includes('重複')) ['qa', 'cs', 'repair', 'hw'].forEach(r => roles.add(r));
      if (t.includes('報廢')) ['prod', 'finance', 'logistics'].forEach(r => roles.add(r));
      if (t.includes('保固')) ['qa', 'cs'].forEach(r => roles.add(r));
      return Array.from(roles);
    };
    for (const a of anoms) {
      add({ sev: a.severity === 'critical' ? 'critical' : a.severity === 'warn' ? 'warn' : 'info',
        area: '異常偵測', icon: a.icon || '!', title: a.title,
        detail: `${a.subject || ''}${a.message ? '：' + a.message : ''}`,
        action: '至「異常偵測」查看完整清單與下鑽', page: 'alerts', roles: anomRoles(a) });
    }

    // (2) Manufacture/origin-batch flags
    const batch = RepairAnalyzer.batchAnalysis(records);
    for (const b of batch) {
      for (const fl of b.flags) {
        let sev = 'warn', roles = ['qa', 'prod'], action = '';
        if (fl === '全新早夭') { sev = 'critical'; roles = ['prod', 'hw', 'qa', 'ceo']; action = '檢討該機種 OQC 出廠檢驗項目，擋下問題批'; }
        else if (fl === '整新後即壞') { sev = 'critical'; roles = ['repair', 'qa']; action = '檢討整新製程與整新後驗收'; }
        else if (fl === '出廠批次集中') { roles = ['procure', 'hw', 'qa', 'prod']; action = `追溯 ${b.topOrigin ? b.topOrigin.month : ''} 出廠批的料號/供應商/產線`; }
        else if (fl === '製造批次集中') { roles = ['prod', 'qa', 'repair']; action = '補上製令以區分出廠批或整新梯次'; }
        const topO = b.topOrigin ? `出廠批 ${b.topOrigin.month}(${(b.topOriginPct * 100).toFixed(0)}%)` : '';
        add({ sev, area: '製造批次', icon: '⊞', title: `${b.model}：${fl}`,
          detail: `維修 ${b.total} 件${topO ? '，' + topO : ''}${b.earlyNew ? `，全新早夭 ${b.earlyNew} 件` : ''}${b.earlyRefurb ? `，整新後即壞 ${b.earlyRefurb} 件` : ''}`,
          action, page: 'batch', roles });
      }
    }

    // (3) Origin-batch defect localisation (元件瑕疵落點)
    const ob = RepairAnalyzer.originBatchPareto(records);
    if (ob.list.length && ob.list[0].pct >= 0.25 && ob.total >= 20) {
      const t = ob.list[0];
      add({ sev: 'warn', area: '元件瑕疵', icon: '🏭', title: `元件瑕疵落點：${t.month} 出廠批`,
        detail: `${t.month} 出廠批佔故障 ${t.count} 件（${(t.pct * 100).toFixed(0)}%），機種 ${t.models.join('、')}`,
        action: '追溯該出廠批的元件來料批與供應商', page: 'batch', roles: ['procure', 'hw', 'qa'] });
    }

    // (4) FMEA high-RPN parts
    const fmea = RepairAnalyzer.fmeaAnalysis(records, state.db);
    for (const m of fmea.filter(x => x.rpn >= 100).slice(0, 4)) {
      add({ sev: m.rpn >= 200 ? 'critical' : 'warn', area: '風險(FMEA)', icon: '⚠',
        title: `${m.part} 風險 RPN ${m.rpn}`,
        detail: `S${m.severity}×O${m.occurrence}×D${m.detection}＝${m.rpn}，維修 ${m.count} 件、報廢 ${m.scrap} 件`,
        action: m.rpn >= 200 ? '立即開立 CAPA 改善專案' : '本月內評估開立 CAPA', page: 'risk', roles: ['qa', 'hw', 'repair'] });
    }

    // (5) Overdue CAPA
    const capa = loadCapa();
    const today = new Date().toISOString().slice(0, 10);
    const overdue = capa.filter(c => c.due && c.status !== 'closed' && c.due < today);
    if (overdue.length) add({ sev: 'warn', area: 'CAPA', icon: '✓', title: `CAPA 逾期 ${overdue.length} 項`,
      detail: `${overdue.slice(0, 3).map(c => `#${c.id} ${c.problem || ''}`).join('；')}${overdue.length > 3 ? ' …' : ''}`,
      action: '至 CAPA 追蹤頁催辦或調整截止日', page: 'capa', roles: ['qa', 'factory', 'ceo'] });

    // (6) Cross-month repeats — 重複進廠＝整新放行品質 + 物流來回成本 + 客訴風險
    const cross = RepairAnalyzer.crossMonthSerials(state.db, {});
    if (cross.length) {
      const heavy = cross.filter(c => c.visitCount >= 3).length;
      add({ sev: cross.length >= 5 ? 'warn' : 'info', area: '重複維修', icon: '⇄',
        title: `跨月重複故障 ${cross.length} 台`,
        detail: `同一序號跨月再進廠，疑似未根治${heavy ? `；其中 ${heavy} 台進廠≥3次（建議主動換機）` : ''}；最高 ${cross[0].model} #${cross[0].serial} 共 ${cross[0].visitCount} 次`,
        action: '開立 CAPA、比對首修紀錄/韌體版本；進廠≥3次者由客服主動換機', page: 'scrap',
        roles: ['qa', 'cs', 'repair', 'hw', 'prod', 'logistics'] });
    }

    // (7) Quality cost COPQ
    const cfg = (function () { try { return JSON.parse(localStorage.getItem('titan_cost_cfg_v1') || 'null'); } catch { return null; } })();
    const cost = RepairAnalyzer.costAnalysis(records, cfg || {});
    if (cost.configured && cost.totalCost > 0) {
      const money = (n) => 'NT$ ' + Math.round(n).toLocaleString('en');
      add({ sev: 'info', area: '品質成本', icon: '$', title: `本期 COPQ ${money(cost.totalCost)}`,
        detail: `報廢 ${money(cost.scrapCost)} + 工時 ${money(cost.laborCost)}${cost.byCategory.length ? `，最高 ${cost.byCategory[0].cat}` : ''}`,
        action: '用於管理層 ROI 與改善優先序排定', page: 'cost', roles: ['finance', 'ceo'] });
    } else {
      // 成本參數未設定 → 給財務一個「立即上線」的行動卡，而非空白
      add({ sev: 'warn', area: '品質成本', icon: '$', title: '品質成本(COPQ)尚未啟用',
        detail: `本期報廢 ${kpis.scrap} 件、跨月重複 ${cross.length} 台，財務影響尚未量化——僅需填入「每台維修成本/每台報廢損失/單次物流成本」即可即時估算`,
        action: '點「成本量化」頁面 → 填入三個概略數字 → 5分鐘後即可看到本期品質損失金額（NT$）', page: 'cost', roles: ['finance', 'ceo'] });
    }

    // (8) Component-category dominance
    const cc = RepairAnalyzer.componentCategoryPareto(state.db, f);
    if (cc.list.length && cc.list[0].pct >= 0.3) {
      const c = cc.list[0];
      add({ sev: 'info', area: '零件大類', icon: '🧩', title: `故障集中於「${c.name}」類`,
        detail: `${c.name} 佔故障零件 ${(c.pct * 100).toFixed(0)}%（${c.count} 件），主要：${c.topParts.slice(0, 2).map(p => p.name).join('、')}`,
        action: '針對該零件大類找供應商/設計根因', page: 'parts', roles: ['procure', 'hw', 'repair'] });
    }

    // (9) High fault-rate models
    const denom = RepairAnalyzer.getDenominators(state.db, f);
    const ranks = RepairAnalyzer.modelRank(records, denom, state.db, state.selectedMonths);
    for (const r of ranks.filter(r => (r.faultRate || 0) >= 0.1).slice(0, 3)) {
      add({ sev: r.faultRate >= 0.2 ? 'critical' : 'warn', area: '高故障機種', icon: '⚙',
        title: `${r.model} 故障率 ${(r.faultRate * 100).toFixed(1)}%`,
        detail: `維修 ${r.count} 件${r.scrap ? `、報廢 ${r.scrap} 件` : ''}，高於 10% 警戒線`,
        action: '生產/研發排查製程或設計；業務對外溝通宜保守', page: 'overview', roles: ['prod', 'ceo', 'sales', 'qa'] });
    }

    // (11) Firmware / software signal in fault text → 韌體研發視角
    const FW_RE = /當機|死機|無法開機|重開機|軟體|韌體|程式|更新失敗|升級失敗|連線異常|連不上|藍[牙芽]|閃退|系統異常|無回應|無反應|誤報|誤動作/;
    const fwHits = records.filter(r => FW_RE.test(`${r.reason || ''} ${r.reasonRaw || ''} ${r.content || ''}`));
    if (fwHits.length) {
      const fwPct = records.length ? fwHits.length / records.length : 0;
      const byModel = {};
      for (const r of fwHits) byModel[r.model] = (byModel[r.model] || 0) + 1;
      const topM = Object.entries(byModel).sort((a, b) => b[1] - a[1])[0];
      add({ sev: fwPct >= 0.05 ? 'warn' : 'info', area: '韌體/軟體', icon: '⌨',
        title: `疑似韌體/軟體相關故障 ${fwHits.length} 件`,
        detail: `佔本期維修 ${(fwPct * 100).toFixed(1)}%${topM ? `，最多 ${topM[0]}（${topM[1]} 件）` : ''}；關鍵字：當機/無回應/更新失敗/連線異常等`,
        action: '比對韌體版本與故障序號，評估是否需發佈修正版或召回更新', page: 'parts', roles: ['fw', 'qa', 'cs'] });
    }

    // (10) Overall scrap rate
    if (kpis.scrapPct >= 5) add({ sev: kpis.scrapPct >= 10 ? 'critical' : 'warn', area: '報廢', icon: '✕',
      title: `整體報廢率 ${fmt.pct(kpis.scrapPct)}`,
      detail: `報廢 ${kpis.scrap} 件，${kpis.scrapPct >= 10 ? '已達高風險' : '達警戒線 (5%)'}`,
      action: '調查報廢主因機種與原因集中度', page: 'scrap', roles: ['prod', 'finance', 'logistics', 'ceo', 'qa'] });

    return findings;
  }

  function summaryForRole(role, records, kpis, anoms) {
    const all = gatherFindings(records, kpis, anoms);
    const mine = (role === 'all') ? all.slice() : all.filter(x => x.roles.includes(role));
    mine.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    return mine;
  }

  function updateSummaryBadge() {
    try {
      const f = currentFilter();
      const records = RepairAnalyzer.getRecords(state.db, f);
      const denom = RepairAnalyzer.getDenominators(state.db, f);
      const kpis = RepairAnalyzer.computeKPIs(records, denom);
      const lastMonth = state.selectedMonths.slice().sort().pop();
      const anoms = RepairAnalyzer.detectAnomalies(state.db, lastMonth);
      const mine = summaryForRole(state.analysisRole, records, kpis, anoms);
      const crit = mine.filter(x => x.sev === 'critical').length;
      const sb = $('summaryBadge');
      if (!sb) return;
      const n = crit || mine.length;
      if (n > 0 && !state.summaryBadgeDismissed) {
        sb.style.display = ''; sb.textContent = n;
        sb.classList.toggle('crit-level', crit > 0);
        sb.classList.add('pulse');
      } else {
        sb.style.display = 'none';
      }
    } catch (e) { /* badge is best-effort */ }
  }

  function dismissSummaryBadge() {
    state.summaryBadgeDismissed = true;
    const sb = $('summaryBadge');
    if (sb) { sb.style.display = 'none'; sb.classList.remove('pulse'); }
  }

  function renderSummary() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const denom = RepairAnalyzer.getDenominators(state.db, f);
    const kpis = RepairAnalyzer.computeKPIs(records, denom);
    const lastMonth = state.selectedMonths.slice().sort().pop();
    const anoms = RepairAnalyzer.detectAnomalies(state.db, lastMonth);
    if (f.model && f.model !== '全部') {
      renderModelSummary(f.model, records, kpis);
      return;
    }

    const role = state.analysisRole;
    const roleInfo = ANALYSIS_ROLES[role] || ANALYSIS_ROLES.all;
    const mine = summaryForRole(role, records, kpis, anoms);
    const crit = mine.filter(x => x.sev === 'critical');
    const warn = mine.filter(x => x.sev === 'warn');
    const info = mine.filter(x => x.sev === 'info');

    $('summaryMeta').textContent = `${mine.length} 項應追蹤 · ${crit.length} 立即處理`;
    updateSummaryBadge();

    $('sumBanner').innerHTML = `
      <div class="sum-banner-inner" style="--rc:${roleInfo.color}">
        <span class="sum-banner-ico">${roleInfo.icon}</span>
        <div>
          <div class="sum-banner-t">${roleInfo.label} · 應追蹤摘要</div>
          <div class="sum-banner-d">${roleInfo.desc}　·　重點關注：${ROLE_FOCUS[role] || ''}</div>
        </div>
        <div class="sum-banner-meta">${state.analysisRole === 'all' ? '綜合視角：顯示全部findings' : `已過濾出 ${roleInfo.label}相關事項`}</div>
      </div>`;

    $('sumKpi').innerHTML = `
      <div class="kpi k-red"><div class="kpi-h"><div class="kpi-l">立即處理</div><div class="kpi-ico">!</div></div>
        <div class="kpi-v">${crit.length}</div><div class="kpi-d"><span class="muted">嚴重 · 需馬上行動</span></div></div>
      <div class="kpi k-warn"><div class="kpi-h"><div class="kpi-l">本期關注</div><div class="kpi-ico">▲</div></div>
        <div class="kpi-v">${warn.length}</div><div class="kpi-d"><span class="muted">警示 · 本期內處理</span></div></div>
      <div class="kpi k-blue"><div class="kpi-h"><div class="kpi-l">整體故障率</div><div class="kpi-ico">%</div></div>
        <div class="kpi-v">${fmt.pct(kpis.denomPct)}</div><div class="kpi-d"><span class="muted">${fmt.int(kpis.totalRepairs)} / ${fmt.int(kpis.denomTotal)}</span></div></div>
      <div class="kpi k-info"><div class="kpi-h"><div class="kpi-l">報廢率</div><div class="kpi-ico">✕</div></div>
        <div class="kpi-v">${fmt.pct(kpis.scrapPct)}</div><div class="kpi-d"><span class="muted">${kpis.scrap} 件</span></div></div>
    `;

    const section = (label, items, cls) => {
      if (!items.length) return '';
      return `
        <div class="sum-sec">
          <div class="sum-sec-h ${cls}"><span class="sum-sec-dot"></span>${label}<span class="sum-sec-n">${items.length}</span></div>
          <div class="sum-cards">
            ${items.map(x => `
              <div class="sum-card ${x.sev}">
                <div class="sum-card-top"><span class="sum-card-ico">${x.icon}</span><span class="sum-card-area">${x.area}</span></div>
                <div class="sum-card-title">${escapeHtml(x.title)}</div>
                <div class="sum-card-detail">${escapeHtml(x.detail)}</div>
                ${x.action ? `<div class="sum-card-action">💡 ${escapeHtml(x.action)}</div>` : ''}
                <div class="sum-card-btns">
                  <button class="sum-card-go" onclick="App.switchPage('${x.page}')">前往 ${PAGE_NAME[x.page] || x.page} →</button>
                  <button class="sum-card-capa" onclick="App.openCapaForm(${escapeAttr(JSON.stringify({ problem: x.title, action: x.action || '', severity: x.sev }))})">＋CAPA</button>
                </div>
              </div>`).join('')}
          </div>
        </div>`;
    };

    const body = $('sumBody');
    if (!mine.length) {
      body.innerHTML = `<div class="card"><div class="empty"><div class="empty-ico">✓</div><div class="empty-t">本期此視角未偵測到須追蹤事項</div><div class="empty-d">可切換其他角色，或檢視「總覽」掌握全貌</div></div></div>`;
      return;
    }

    // CEO 本月一句話摘要
    let execBriefHtml = '';
    if (role === 'ceo' && mine.length) {
      const allMonthsSorted = Object.keys(state.db.months).sort();
      const n = allMonthsSorted.length;
      let trendWord = '';
      if (n >= 2) {
        const cur = (state.db.months[allMonthsSorted[n-1]]?.records || []).length;
        const prv = (state.db.months[allMonthsSorted[n-2]]?.records || []).length;
        const d = cur - prv;
        trendWord = d > 0 ? `較上月 ▲${d} 件` : d < 0 ? `較上月 ▼${Math.abs(d)} 件` : '與上月持平';
      }
      const topCrit = crit[0];
      const execText = `本期共維修 ${fmt.int(kpis.totalRepairs)} 件${trendWord ? '（' + trendWord + '）' : ''}，報廢率 ${fmt.pct(kpis.scrapPct)}${kpis.scrapPct >= 5 ? '（⚠ 超過警戒線）' : '（正常範圍）'}。${topCrit ? `最高優先行動：${topCrit.title}——${topCrit.action || '請至對應頁面確認'}。` : '本期無緊急事項。'}`;
      execBriefHtml = `<div class="exec-brief"><div class="eb-label">本月重點摘要</div><div class="eb-text">${escapeHtml(execText)}</div></div>`;
    }

    body.innerHTML = execBriefHtml + section('應立即追蹤', crit, 'critical') + section('本期應關注', warn, 'warn') + section('持續監控', info, 'info');
  }

  function renderModelSummary(modelName, records, kpis) {
    const M = modelMetrics(modelName);
    const cat = RepairParser.getCategory(modelName);
    const topPart = M.topParts[0];
    const topReason = M.topReason;
    $('summaryMeta').textContent = `${modelName} · ${records.length} 筆維修紀錄 · 只看此型號`;
    updateSummaryBadge();
    $('sumBanner').innerHTML = `
      <div class="sum-banner-inner" style="--rc:var(--accent)">
        <span class="sum-banner-ico">#</span>
        <div>
          <div class="sum-banner-t">${escapeHtml(modelName)} · 型號專用分析</div>
          <div class="sum-banner-d">這裡只看這個型號的維修紀錄、故障原因與零件落點。</div>
        </div>
        <div class="model-result-pill">結果已顯示在下方</div>
      </div>`;
    $('sumKpi').innerHTML = `
      <div class="kpi k-blue"><div class="kpi-h"><div class="kpi-l">維修紀錄</div><div class="kpi-ico">#</div></div>
        <div class="kpi-v">${fmt.int(M.count)}</div><div class="kpi-d"><span class="muted">${escapeHtml(cat)} · ${fmt.int(kpis.totalRepairs)} 筆</span></div></div>
      <div class="kpi k-info"><div class="kpi-h"><div class="kpi-l">換修率</div><div class="kpi-ico">%</div></div>
        <div class="kpi-v">${pctStr(M.rate)}</div><div class="kpi-d"><span class="muted">依目前匯入月份計算</span></div></div>
      <div class="kpi k-warn"><div class="kpi-h"><div class="kpi-l">最常換零件</div><div class="kpi-ico">▤</div></div>
        <div class="kpi-v">${topPart ? fmt.int(topPart.count) : '0'}</div><div class="kpi-d"><span class="muted">${topPart ? escapeHtml(pdbLabel(topPart.name)) : '目前無零件資料'}</span></div></div>
      <div class="kpi k-red"><div class="kpi-h"><div class="kpi-l">主要故障</div><div class="kpi-ico">!</div></div>
        <div class="kpi-v">${topReason ? fmt.int(topReason[1]) : '0'}</div><div class="kpi-d"><span class="muted">${topReason ? escapeHtml(topReason[0]) : '目前無原因資料'}</span></div></div>
    `;
    $('sumBody').innerHTML = `
      <div class="card">
        <div class="drawer-banner info">
          <strong>${escapeHtml(modelName)}</strong> 已切換為單一型號分析。下方內容不含其他設備異常。
        </div>
        ${modelDrillContent(modelName, '__all__')}
      </div>`;
  }

  function updateAlertBadge() {
    const lastMonth = state.selectedMonths.slice().sort().pop();
    const anoms = RepairAnalyzer.detectAnomalies(state.db, lastMonth);
    const total = anoms.length;
    const badge = $('alertBadge');

    if (total === 0 || state.alertsAcknowledged) {
      badge.style.display = 'none';
    } else {
      badge.style.display = '';
      badge.textContent = total;
      // Color level: ≥10 critical, ≥1 warn
      badge.classList.remove('warn-level', 'crit-level');
      badge.classList.add(total >= 10 ? 'crit-level' : 'warn-level');
      badge.classList.add('pulse');
    }

    // Cross-month repeat badge — same logic
    const cm = RepairAnalyzer.crossMonthSerials(state.db, {});
    const cmTotal = cm.length;
    const cmBadge = $('crossMonthBadge');
    if (cmTotal === 0 || state.crossMonthAcknowledged) {
      cmBadge.style.display = 'none';
    } else {
      cmBadge.style.display = '';
      cmBadge.textContent = cmTotal;
      cmBadge.classList.remove('warn-level', 'crit-level');
      cmBadge.classList.add(cmTotal >= 10 ? 'crit-level' : 'warn-level');
      cmBadge.classList.add('pulse');
    }
  }

  function dismissAlertPulse() {
    state.alertsAcknowledged = true;
    $('alertBadge').style.display = 'none';
  }

  function dismissCrossMonthPulse() {
    state.crossMonthAcknowledged = true;
    $('crossMonthBadge').style.display = 'none';
  }

  // ─────────────── 使用說明 (per-page help) ───────────────
  const HELP = {
    summary: {
      what: '依您選的主管視角，把全報表（異常偵測、製造批次、出廠批次/元件瑕疵、FMEA 風險、CAPA、跨月重複、品質成本、零件大類、高故障機種、報廢率）的發現「彙整成一份報告」，過濾出與您角色相關者，再依嚴重度分為「應立即追蹤 / 本期應關注 / 持續監控」三層，每項附建議行動與下鑽連結。上方角色列可隨時切換，全站每頁都會跟著切換視角。',
      meaning: '這頁解決「資訊雜湊」問題：不必逐頁翻找，系統替每位主管把「該你管的事」挑出來、排好序。紅色＝嚴重需馬上行動；橙色＝本期內處理；藍色＝持續監控。卡片的「💡建議行動」是下一步，「前往 →」直接跳到對應分析頁深究。',
      who: '所有層級主管的每日起點。董事長/廠長：看跨部門紅線；品檢：看批次/早夭/CAPA/重複維修；採購：看出廠批次來料瑕疵與高用量零件；研發：看 FMEA 與元件瑕疵落點；財務：看 COPQ；業務：看高故障機種口碑。切到「綜合視角」則顯示全部發現。',
      kpis: [
        { name:'立即處理', formula:'此角色相關的嚴重(critical)發現數', benchmark:'目標為 0；>0 代表有需馬上行動的事項', tip:'紅卡都應在 24–72 小時內指派負責人' },
        { name:'本期關注', formula:'此角色相關的警示(warn)發現數', benchmark:'本期(本月)內應處理完', tip:'橙卡建議轉為 CAPA 追蹤' },
        { name:'整體故障率 / 報廢率', formula:'維修數÷整新數 / 報廢數÷維修數', benchmark:'故障率趨勢向下、報廢率<5% 為佳', tip:'這兩個共用指標讓各角色有共同基準' },
      ],
      tips: [
        '先切到自己的角色，再由上而下處理「應立即追蹤」紅卡',
        '每張卡的「前往 →」會跳到對應分析頁，可深入查證再決策',
        '紅/橙卡建議直接到 CAPA 頁開立追蹤，形成品質閉環',
        '切到「綜合視角」可一覽全公司所有發現，適合主管會議',
        '導覽列「主管摘要」的紅色數字 = 你目前視角的待處理嚴重事項數',
      ],
    },
    overview: {
      what: '一眼掌握本期維修總量、報廢、重複維修、機種故障率排名與最常更換零件。上方可切換 13 種主管視角，系統會自動提煉該角色關心的洞察卡。',
      meaning: '故障率 = 維修數 ÷ 整新數（整新數是產能基數代理值）。報廢率高 → 良率或來料問題；重複維修多 → 治標未治本；機種排名紅色（≥10%）為高風險，黃色（5–10%）需觀察，綠色（<5%）正常。',
      who: '全體主管的起點。董事長看總量趨勢；廠長看異常警示；採購看零件欄；品檢看重複維修；業務看機種排名；財務先切到「成本量化」。',
      kpis: [
        { name:'總維修件數', formula:'當期所有維修筆數', benchmark:'依業種不同，趨勢下降為改善方向', tip:'點擊可展開各機種分布與月份走勢' },
        { name:'受檢機種', formula:'本期出現的不同機種數量', benchmark:'越多代表機種複雜度越高', tip:'點擊可查看各機種排名清單' },
        { name:'報廢件數 / 報廢率', formula:'無法修復件數 ÷ 總維修件數 × 100%', benchmark:'<2% 良好 · 2–5% 警戒 · >5% 高風險', tip:'點擊可查看各機種報廢分布' },
        { name:'重複維修台數', formula:'同一序號在選定期間維修 ≥2 次的台數', benchmark:'應趨近於 0；>5% 表示首修品質不足', tip:'點擊可查看哪些機台反覆進廠' },
      ],
      tips: [
        '先選擇「角色視角」按鈕（總覽頁頂端），系統會自動過濾並顯示該角色最關鍵的洞察',
        '點擊機種排名的任一格可展開該機種的詳細分析',
        '點擊月份欄中的數字可直接跳到該機種該月的分析',
        '紅色 ≥10% 的機種應優先開立 CAPA 追蹤',
        '每月上傳新資料後，建議先看這頁，再根據洞察卡前往相關頁面深入分析',
      ],
    },
    alerts: {
      what: '系統自動偵測 7 種異常：① 新出現的高頻零件 ② 零件用量暴增（MoM ≥100%）③ 機種故障率偏高（≥5%）④ 機種報廢比例偏高（≥30%）⑤ 零件跨機種出現（影響≥3機種）⑥ 同月重複維修（同序號≥3次）⑦ 跨月份重複維修 ⑧ 故障原因高度集中（單原因≥50%）。',
      meaning: '嚴重（紅）= 需立即召集相關部門討論；警告（黃）= 本月觀察，下月若持續則升級；資訊（藍）= 備注參考，不需立即行動。點擊卡片可進行深入分析（鑽取至零件/機種/序號層級）。',
      who: '廠長每期必看（判斷需跨部門協調的項目）；品檢負責轉換為 CAPA；採購看零件類異常（備料觸發）；研發看高故障率與集中原因（設計改版依據）；客服看重複維修（客訴預防）。',
      tips: [
        '嚴重（紅）異常通常需要在 3 個工作天內開立 CAPA 並指定負責人',
        '「新出現的高頻零件」最值得關注——代表突發的新問題，非漸進惡化',
        '「跨機種出現」異常代表共用料設計問題，單一供應商風險高',
        '「故障原因高度集中」對韌體研發最有價值——單一問題佔 50% 代表可能是系統性韌體 bug',
        '每月比對上月異常清單，若相同項目持續出現表示上月的 CAPA 尚未有效',
      ],
    },
    parts: {
      what: '兩個區塊：① 故障零件大類根因 — 依「元件料號大類」把故障零件歸類（連接器/電源/IC/開關/機構…），看故障的「性質」。② 零件件數 Pareto — 所有更換零件依使用量排序（80/20 法則），含累計佔比折線與影響機種數。點「詳情」可查看使用此零件的所有故障記錄。',
      meaning: '大類分析回答「壞在哪一類零件」：連接器/排線多→組裝接觸問題；電源/電容多→電性/老化；IC 多→設計/ESD；開關/按鍵多→機構耐用度；面板/塑膠/橡膠多→外觀機構或運輸。Pareto 回答「哪幾顆零件最該管」：前 20% 零件通常佔 80% 用量，累計線 80% 以上就是重點備料清單。',
      who: '採購主管：大類佔比鎖定該找哪一類供應商；前 10 大零件是議價與安全庫存重點。硬體研發：IC/電源/連接器大類偏高 → 設計審查候選。維修主管：備料優先序一目了然。物流主管：包裝/機構類偏高可能是運輸損傷。',
      kpis: [
        { name:'件數', formula:'選定期間此零件的換件總數量', benchmark:'依機種數量不同，趨勢穩定為正常', tip:'急速上升可能是來料批次問題' },
        { name:'佔比', formula:'此零件件數 ÷ 所有零件總件數', benchmark:'單一零件佔比 >20% 需特別關注', tip:'單一零件佔比過高代表故障高度集中，是最優先的改善與備料標的' },
        { name:'影響機種', formula:'有換用此零件的不同機種數', benchmark:'影響 ≥3 機種代表共用料風險', tip:'點詳情可看每個機種的故障描述' },
      ],
      tips: [
        '點「詳情」按鈕可展開該零件的所有故障記錄，並依故障部位（電源/PCB/機構…）分類整理',
        '圖表右側的折線是「累計佔比」——折線超過 80% 的位置就是需要重點管理的零件數量',
        '若某零件突然從排名後段跳到前段，可能是批次不良訊號，建議立刻到「異常偵測」確認',
        '採購可用此頁計算月均用量，設定安全庫存（建議：月均用量 × 1.5 倍）',
        '硬體研發應重點關注「影響 ≥3 機種」的零件，排查是否為共用料設計缺陷',
      ],
    },
    cross: {
      what: '矩陣呈現「同一零件（列） × 各機種（欄）」的換件數量。格子顏色深淺代表數量多寡；空格（·）代表此組合無記錄。可按「⤓ Excel」匯出完整矩陣。',
      meaning: '若同一個零件在多個機種都頻繁出現，問題多半出在零件本身（來料品質/設計缺陷），而非單一機種的製程或使用問題。這是鎖定供應商責任或啟動設計變更（ECO）的關鍵依據。',
      who: '採購主管：鎖定問題供應商（多機種同零件出問題 → 料件本身有問題）。硬體研發：判斷是否需要啟動共用料改版（ECO）。品檢：批次追溯，確認是否為單一批次流入多機種。廠長：評估跨產線的停修風險。',
      tips: [
        '最右欄「合計」排序代表單一零件的總影響量',
        '顏色最深的格子代表「此機種最常換這個零件」——是維修技師培訓的重點',
        '同一列（同一零件）多格都有數字 → 共用料問題 → 採購/研發行動',
        '同一欄（同一機種）多格都有數字 → 該機種維修複雜度高 → 研發審查',
        '匯出 Excel 後可進一步做供應商分析（若有供應商欄位資料）',
      ],
    },
    trend: {
      what: '3 張圖：① 維修件數 vs 報廢件數（長條圖，各月份）② 故障率走勢（折線，與整新數相比）③ 主要零件月度趨勢（前6大零件各自折線）。篩選大類或機種後，圖表只顯示該範圍。',
      meaning: '趨勢看的是「方向」而非單月數字。故障率持續上升 → 製程或設計惡化；持續下降 → 改善有效；劇烈波動 → 資料異常或批次問題。零件趨勢可預判備料需求。',
      who: '董事長：故障率是否逐月改善（問責依據）。生產主管：找出下降的月份對應了哪些改善行動（驗證效果）。採購：零件趨勢用於備料預測。業務：產品質量走向，銷售話術依據。財務：趨勢斜率決定下季品質成本預估。韌體研發：韌體版本推出後的那個月，故障率是否改善。',
      tips: [
        '選擇「特定機種」篩選後，可看該機種專屬的故障率走勢，評估是否在改善中',
        '比對「新版韌體推出時間」與「故障率折線」，驗證韌體改版效果',
        '零件趨勢圖中若某零件斜率明顯向上，立刻通知採購備貨',
        '相鄰兩月故障率差異 >3 個百分點需要找原因（換了供應商？換了配方？）',
        '故障率圖如果一直是「無整新數（分母為零）」，請確認 Excel 是否包含整新數欄位',
      ],
    },
    reason: {
      what: '三個視角：① 故障大類圓餅圖（依 Excel「故障原因」欄位分類）② 故障內容 TOP 10（依「故障內容」欄位）③ 故障部位分布（系統依關鍵字自動分入 9 大部位：電源/PCB/螢幕/儲存/感測/機構/通訊/韌體/運輸損傷）。',
      meaning: '故障大類是粗分類，故障部位是精分類。某一部位佔比 >40% 代表該部位有集中性根本原因，應優先改善。「運輸損傷」分類代表包裝/物流問題，責任歸屬不同於設計/製造問題。',
      who: '品檢主管：找出最大佔比類別，作為開立 CAPA 的主題。硬體研發：「PCB/電源」類集中 → 電路設計審查。韌體研發：「韌體/軟體」類集中 → 韌體 bug 追查。物流主管：「運輸損傷」佔比 → 包裝改善依據。維修主管：月度對比圖可看出哪個類別最近在上升。',
      tips: [
        '月度對比圖（右下區域）可看本月 vs 上月各部位數量變化——某部位突然增加需立刻調查',
        '「其他/未分類」比例高代表故障描述填寫不夠詳細，建議請維修技師補充描述',
        '同一部位持續 3 個月以上居首 → 應開立 CAPA 進行根因分析',
        '品檢主管：圓餅圖結合 CAPA 頁的狀態，確認每個大類別都有對應的矯正措施',
        '業務主管：「運輸損傷」比例高時，可作為改善包裝的客訴說明依據',
      ],
    },
    quality: {
      what: '4 個品質指標 KPI + SPC 管制圖。指標：DPPM（整體缺陷率）、報廢 DPPM（僅計報廢）、FPY 直通率（未進維修比例）、重工率（重複進廠率）。SPC 圖顯示各月故障率相對於歷史平均的位置。',
      meaning: 'DPPM 是國際通用品質語言，方便與業界對標。SPC 圖中：CL（中心線）= 歷史平均；UCL（紅線）= 管制上限（3σ）；超過 UCL 的月份 = 製程失控，需追查特殊原因，而非正常波動。',
      who: '品檢主管：核心戰場，每月必檢視是否有月份超出 UCL。生產主管：FPY 越高代表製程越好。董事長/財務：DPPM 是對標業界水準的語言。維修主管：重工率反映首修品質。',
      kpis: [
        { name:'DPPM', formula:'維修件數 ÷ 整新數 × 1,000,000', benchmark:'消費電子 <500 為佳 · <2,000 可接受 · >10,000 需重點改善', tip:'DPPM 不等於故障率，是把比例放大到百萬基數，方便跨公司比較' },
        { name:'報廢 DPPM', formula:'報廢件數 ÷ 整新數 × 1,000,000', benchmark:'應遠低於 DPPM；若接近 DPPM 代表大部分維修都無法修復', tip:'高報廢 DPPM 代表設計問題比製程問題更嚴重' },
        { name:'FPY 直通率', formula:'（整新數 - 維修件數）÷ 整新數 × 100%', benchmark:'>95% 佳 · 90–95% 可接受 · <90% 需改善（本系統以整新數為代理值）', tip:'FPY 是製造業最常用的良率指標；本值為代理估算，非出廠直通率' },
        { name:'重工率', formula:'重複進廠台數 ÷ 有序號的維修台數 × 100%', benchmark:'<3% 佳 · 3–8% 警戒 · >8% 首修品質有問題', tip:'重工代表同一台機器修了又壞，是維修技師技能或零件品質的指標' },
        { name:'SPC UCL', formula:'歷史平均故障率 + 3 × 標準差', benchmark:'超出 UCL 的月份 = 製程失控，必須找到特殊原因', tip:'SPC 需至少 2 個月資料才能計算；建議累積 6 個月以上才有意義' },
      ],
      tips: [
        'SPC 圖中，超出紅色 UCL 的月份必須找出「特殊原因」（換供應商？新批次？新操作員？）',
        'DPPM 持續下降但 FPY 沒有提升 → 可能是整新數計算問題，請確認分母資料正確',
        '重工率高但 DPPM 不高 → 維修品質問題（技師技能）；重工率高且 DPPM 也高 → 零件或設計問題',
        '品檢主管可將每月 DPPM 截圖，作為每月品質績效報告依據',
        '若 SPC 顯示「需至少 2 個月資料」，請繼續上傳月份資料，圖表會自動啟用',
      ],
    },
    batch: {
      what: '用器材的兩個日期維度做批次分析：① 製令 = 器材「身分證」(格式 YYMMDD+批次序號)，代表「原始出廠年月批次」，永不改變；② 製造日期 = 整新時重新貼上的日期（若從未整新則 = 製令年月）。本頁自動判定每台「全新 vs 整新」，並偵測：出廠批次集中、製造批次集中、全新早夭、整新後即壞，把責任落點分到「原廠/來料」或「整新單位」。',
      meaning: '全新 vs 整新（製造日期年月 是否等於 製令出廠年月）是責任歸屬的分水嶺：全新品故障 → 原始生產批/來料元件瑕疵（責任：當期生產＋採購/IQC）；整新品故障 → 整新製程問題（責任：整新單位）。「出廠批次分析」回答「哪一年的哪一批元件瑕疵」——故障集中在某個製令出廠年月，代表該原始批次的元件或製程有系統性問題（例：ZSPMG31 故障集中在 2019-11、2020-01 出廠批，磁簧開關批次瑕疵）。',
      who: '品檢主管：出廠批次集中或早夭的機種立刻啟動 8D/CAPA，並依全新/整新把責任分清楚。製造主管：全新早夭直指 OQC 出廠檢驗漏洞與特定生產梯次。整新單位：整新後即壞、整新品的製造批次集中是整新製程的責任。採購/IQC：出廠批次集中＝該年該批來料元件嫌疑，追溯供應商批號。研發：全新早夭＋零件大類集中（如連接器斷損）為設計強度問題。董事長：全新早夭件數是出廠品質紅線。',
      kpis: [
        { name:'出廠批次集中度', formula:'該機種最大「製令出廠年月」筆數 ÷ 該機種有製令筆數', benchmark:'≥40%（n≥5）標記「出廠批次集中」', tip:'集中的出廠年月＝拿該批序號追原始產線與來料元件批' },
        { name:'製造批次集中度', formula:'該機種最大「製造日期年月」筆數 ÷ 該機種有製造日期筆數', benchmark:'≥40%（n≥5）標記「製造批次集中」', tip:'需搭配製令才能確認是出廠批還是整新梯次；含製令後 整新品的此集中即整新梯次問題' },
        { name:'全新早夭件數', formula:'全新品（製造=製令年月）且 出廠月=檢修月 的筆數', benchmark:'任何 >0 都嚴重；≥5 標記', tip:'客戶剛收到新品就壞，責任在原廠出廠檢驗' },
        { name:'整新後即壞件數', formula:'整新品（製造≠製令年月）且 整新月=檢修月 的筆數', benchmark:'任何 >0 都要追；≥5 標記', tip:'整新完當月又壞，責任在整新製程/驗收' },
        { name:'製令涵蓋率', formula:'有製令筆數 ÷ 全部維修筆數', benchmark:'越高分析越準；偏低代表工廠尚未補齊製令', tip:'請工廠在各機種 sheet 補上製令欄，全新/整新判定才會完整' },
      ],
      tips: [
        '看「出廠批次分析」長條圖：某個製令年月特別高 → 該原始批次元件瑕疵，責任落在當期生產與來料',
        '全新早夭（紅）→ OQC 出廠檢驗破口，檢討該機種出廠測試；整新後即壞（橙）→ 整新製程/驗收問題',
        '同時具備「製令＋製造日期」才能判定全新/整新；目前多數機種只有其一，請工廠陸續補齊製令',
        '製令格式為 YYMMDD＋3碼批次序號（2位西元年），例 250410057 = 2025-04 第057批',
        '把本頁的批次集中機種，搭配「零件大類根因」一起看 — 出廠批次＋故障零件大類即可精準定位根因與責任',
      ],
    },
    risk: {
      what: '三個區塊：① 下月維修量預測（線性回歸 + 3 月移動平均的綜合預測）② FMEA 風險矩陣（8 大部位的 S×O×D=RPN 評分，S/O/D 可手動調整）③ 故障根因樹（每個部位的維修件數、報廢數、Top 5 故障模式）。',
      meaning: 'RPN（風險優先數）= 嚴重度(S) × 發生度(O) × 偵測度(D)。三個分數各 1–10，RPN 越高越需優先處理。系統會依資料自動計算分數，品檢主管可針對有主觀判斷的部位手動調整 S/O/D 值（調整後會保存並標記「人工調整」）。',
      who: '品檢主管：依 RPN 排序決定 CAPA 優先序，RPN≥200 的部位應立即開立改善專案。硬體研發：「PCB/電源」部位 RPN 高 → ECO 候選。韌體研發：「韌體/軟體」RPN 高 → 版本審查。採購/財務：預測值用於備料計劃與成本估算。廠長：根因樹中佔比最高的部位需要跨部門協調改善。',
      kpis: [
        { name:'S 嚴重度', formula:'由報廢率自動計算（報廢率越高→S越高）；可手動覆寫', benchmark:'7–10 = 嚴重（可能報廢或安全風險）· 4–6 = 中等 · 1–3 = 輕微', tip:'品檢主管應確認 S 分數符合實際嚴重程度，必要時手動調整' },
        { name:'O 發生度', formula:'由故障頻率相對排名自動計算', benchmark:'7–10 = 頻繁（每月都出現）· 4–6 = 偶發 · 1–3 = 罕見', tip:'O 高的部位是「老問題」，O 低的是「新問題」，兩者都需要關注' },
        { name:'D 偵測度', formula:'基礎值 5；跨月重複出現 +3；高報廢率 +1（偵測難度高＝分數高）', benchmark:'7–10 = 很難偵測（事後才發現）· 1–3 = 容易偵測', tip:'D 越高代表目前的檢測方式越抓不到這個問題' },
        { name:'RPN 風險優先數', formula:'S × O × D（最大值 1000）', benchmark:'≥200 極高（立即行動）· ≥100 高（本月內開立 CAPA）· ≥50 中 · <50 低', tip:'改善 RPN 最有效的方式通常是降低 D（加強檢測）而非降低 S（嚴重度）' },
        { name:'預測值', formula:'（線性回歸預測 + 3月移動平均）÷ 2', benchmark:'預測僅為估計；趨勢方向（↗↘→）比絕對數字更重要', tip:'預測持續↗表示問題在惡化，應提前備料與安排技師' },
      ],
      tips: [
        'FMEA 的 S/O/D 欄位可直接在表格中輸入數字修改，系統自動重算 RPN 並標記「人工調整」',
        '若要重置所有手動調整，點表格下方「重置手動調整」按鈕',
        'RPN 極高（紅色）的部位，應立刻到 CAPA 頁建立追蹤項目',
        '根因樹中「報廢數」較高的部位 S 分數應該高（若系統自動算偏低，請手動調高）',
        '預測值建議搭配「月份趨勢」頁的圖表一起看，趨勢方向一致才可信',
      ],
    },
    capa: {
      what: 'CAPA（Corrective and Preventive Action，矯正預防措施）追蹤清單。每筆包含：問題描述、負責人、截止日期、矯正措施說明、關聯 RMA 單號、狀態。狀態流程：待處理 → 進行中 → 驗證中 → 已結案。逾期自動標紅警示。頂部 KPI 格顯示總計/進行中/逾期/已結案件數。',
      meaning: 'CAPA 是品質閉環管理的核心。「發現問題」只是起點，沒有追蹤到結案的改善措施，問題會一再復發。逾期率是衡量改善執行力的指標；逾期率 >30% 代表資源不足或優先序錯誤。',
      who: '品檢主管：建立 CAPA（依異常偵測或 FMEA 高 RPN 項目）、追蹤狀態、進行驗證。廠長：督導跨部門執行，確保逾期件數受控。各責任部門（研發/採購/生產）：執行改善行動並回報進度。董事長：看逾期率與結案率，評估品質執行力。',
      kpis: [
        { name:'逾期率', formula:'逾期件數 ÷ 未結案件數 × 100%', benchmark:'<10% 正常 · 10–30% 警戒 · >30% 執行力不足', tip:'逾期件數增加時應找廠長協調資源' },
        { name:'結案率', formula:'已結案件數 ÷ 總件數 × 100%', benchmark:'成熟品質系統應 >70%', tip:'結案必須有「驗證有效」的記錄，不能只是「宣布完成」' },
      ],
      tips: [
        '狀態說明：待處理＝還沒開始行動；進行中＝已分配負責人執行中；驗證中＝已執行，等待確認效果；已結案＝已驗證有效並關閉',
        '建議每個異常偵測頁的「嚴重（紅）」異常都開立一筆 CAPA',
        '截止日期建議：嚴重問題 14 天內；警告問題 30 天內；資訊類 90 天內',
        '完成改善後請先改為「驗證中」而非直接「已結案」——需要下個月資料確認效果',
        '結案前確認：相關月份的異常偵測頁是否已不再出現此問題',
        '關聯 RMA 單號可讓 RMA 管理系統與品質追蹤之間形成完整閉環',
      ],
    },
    cost: {
      what: '品質成本 COPQ（Cost of Poor Quality）量化。分為：① 報廢成本（報廢件數 × 機種單價）② 維修工時成本（每件維修 × 設定工時成本）。提供月度趨勢折線圖，並可匯出 CSV。首次使用需點「⚙ 單價設定」輸入各類別或機種單價。',
      meaning: 'COPQ 是說服管理層投資改善的最有力語言。報廢一台高單價機種的成本 ≠ 報廢十台低單價機種。業界參考：COPQ 佔營收 5–15% 為正常，世界級企業目標 <4%。成本趨勢上升 = 品質問題在惡化；下降 = 改善有效。',
      who: '財務主管：核心頁面，月度 COPQ 報告依據，可匯出 CSV 貼入財務系統。董事長：品質問題的金額衝擊，投資改善的 ROI 評估依據。廠長：哪個類別損失最高決定改善優先序。採購：報廢成本高的機種零件需要評估換供應商。',
      kpis: [
        { name:'報廢成本', formula:'Σ（報廢件數 × 機種/類別單價）', benchmark:'應逐月下降；若上升需立刻對應', tip:'請確保單價設定準確，否則整個分析都會失真' },
        { name:'工時成本', formula:'總維修件數 × 每件工時成本（設定值）', benchmark:'工時成本高 → 維修複雜度高或產量大', tip:'工時成本設定建議用「維修一台的平均工時 × 技師時薪」' },
        { name:'COPQ 總損失', formula:'報廢成本 + 工時成本', benchmark:'每月 COPQ ÷ 月營收 < 5% 為世界級目標', tip:'若有保固賠付費用，可加入工時成本設定中一起計算' },
      ],
      tips: [
        '第一步：點「⚙ 單價設定」→ 輸入各類別的報廢單價（可從採購系統查詢）和每件工時成本',
        '單價設定好後記得點「☁ 發布到雲端」，讓所有人看到同樣的成本數字',
        '點「⤓ 匯出 CSV」可下載各月份 + 各類別的詳細成本明細，貼入財務試算表',
        '月度趨勢圖中，若報廢成本佔比遠高於工時成本，代表「報廢問題」比「維修量問題」更嚴重',
        '財務主管建議每季一次計算「改善投入 vs 預估年化損失」評估 ROI',
      ],
    },
    scrap: {
      what: '三個區塊：① 跨月份重複維修（同序號在 ≥2 個不同月份出現，顯示完整時間軸）② 本期重複維修（同序號在同月出現 ≥2 次）③ 報廢機種列表（依報廢件數排序，含主要報廢原因）。',
      meaning: '跨月重複 = 這台機器已超過一個月沒有真正修好，是品質未閉環的最直接證據，客訴風險最高。本期重複 = 同月多次進廠，可能是治標未治本。報廢記錄是損失計算與設計改版的原始資料。',
      who: '品檢主管：跨月重複每一台都應開立 CAPA。客服主管：跨月重複台數直接對應客戶不滿意程度，需主動聯繫說明。業務主管：特定機種的跨月重複集中時，銷售時需謹慎。維修主管：本期重複多代表技師首修品質不足，需技術研討。',
      tips: [
        '跨月重複清單中點擊序號可在「明細資料」頁追蹤完整維修歷程',
        '跨月重複 ≥3 個月的機台是最高優先級，應立刻進行根本原因分析',
        '若報廢原因都是「600」或「報廢」等簡略記錄，建議請技師改善記錄品質（需要真正的原因）',
        '報廢的機種如果集中在特定零件，應同步查看「零件 Pareto」確認是否有備料風險',
        '客服主管：用此頁的跨月重複清單，主動聯繫對應客戶說明修復進度',
      ],
    },
    detail: {
      what: '原始維修記錄逐筆瀏覽。包含：月份、日期、機種、序號、故障原因、故障內容、更換零件。上方搜尋框可輸入序號或機種名稱快速過濾（支援部分符合）。最多顯示 500 筆，超出時請用篩選器縮小範圍。',
      meaning: '這是所有分析的最底層資料來源。當分析頁面出現某個可疑指標時，用此頁查證原始記錄。序號搜尋可追溯特定機台的完整維修歷史（即使跨月份）。',
      who: '客服主管：輸入客戶回報的機台序號，立刻查到完整維修記錄用於客訴回應。維修主管：核對技師是否確實記錄了故障原因與更換零件。品檢主管：追溯特定批次問題，確認哪些序號受影響。研發：查看原始故障描述，排查是否有特定錯誤碼或症狀。',
      tips: [
        '在搜尋框輸入序號（或序號片段）可立刻篩選出該機台所有維修記錄',
        '輸入機種名稱可只看某機種的所有記錄，方便技師核對自己的工作',
        '報廢記錄會以紅色顯示，方便快速識別',
        '若資料筆數超過 500，先用左側「月份」或「大類」篩選，再在此頁查看',
        '若某筆記錄的零件欄位是空白，代表當次維修沒有換料，建議確認是否需要補登',
      ],
    },
  };

  const PAGE_GUIDE = {
    summary: {
      simple: '登入後先看這頁，知道今天最該處理哪幾件事。',
      when: '每天第一次打開、開週會或月會前先看。',
      read: '先看紅色和橘色提醒；沒有紅色，就代表暫時沒有大問題。',
      steps: ['選你的角色。', '看最上面的重點卡片。', '有紅色就按「前往」看原因。', '把要追的問題交給負責人。']
    },
    overview: {
      simple: '看全廠這個月壞了多少、哪個型號最多、哪個零件最多。',
      when: '想先知道整體狀況時看這頁。',
      read: '先看維修件數，再看型號排名和零件排名。',
      steps: ['確認月份是你要看的月份。', '看總維修數有沒有明顯變多。', '找出前三名型號。', '再去「零件分析」看是哪個零件造成。']
    },
    alerts: {
      simple: '幫你找「長期看起來不太正常」的地方。',
      when: '想知道有沒有未知異常、故障是不是變嚴重時看。',
      read: '紅色先處理；短暫上升只當提醒，不直接判定異常。',
      steps: ['先看紅色異常。', '確認是不是連續幾個月都上升。', '點到相關頁面看型號和零件。', '如果只是一個月變多，先觀察不要急著判定。']
    },
    parts: {
      simple: '看哪個零件最常壞，先抓最有影響的零件。',
      when: '要備料、改善零件品質、找常壞零件時看。',
      read: '排名越前面，代表越值得先檢查。',
      steps: ['看零件排行榜。', '先挑前三名。', '確認它們影響哪些型號。', '需要時再開改善追蹤。']
    },
    cross: {
      simple: '看同一個零件是不是害到很多型號。',
      when: '懷疑不是單一機種，而是共用零件本身有問題時看。',
      read: '同一零件出現在越多型號，越像共用料問題。',
      steps: ['找跨兩個以上型號的零件。', '看受影響型號清單。', '確認是否同供應商或同批料。', '通知採購、品保或工程一起追。']
    },
    trend: {
      simple: '看故障是慢慢變多、變少，還是只是某個月跳一下。',
      when: '要判斷長期趨勢時看這頁。',
      read: '連續上升才重要；單月跳高先當提醒。',
      steps: ['選最近 1 到 2 年資料。', '看總維修線有沒有連續上升。', '再看主要零件是否也上升。', '連續多月上升才列為優先處理。']
    },
    reason: {
      simple: '看產品到底是因為什麼原因壞掉。',
      when: '想找故障原因和改善方向時看。',
      read: '最大的故障原因，就是最先要問「為什麼」的地方。',
      steps: ['看故障原因排名。', '挑最多的原因。', '看它對應哪些型號和零件。', '再決定要改製程、料件或維修方式。']
    },
    scrap: {
      simple: '看報廢和修了又壞的狀況。',
      when: '想知道維修品質好不好、哪些序號一直回來時看。',
      read: '重複維修和報廢都代表成本和品質壓力。',
      steps: ['看重複維修數。', '找同一序號是否多次維修。', '看報廢集中在哪些型號。', '把高風險項目列入追蹤。']
    },
    detail: {
      simple: '查每一筆原始維修資料。',
      when: '需要查序號、型號、故障原因或匯出明細時看。',
      read: '這頁像資料表，拿來查證用。',
      steps: ['輸入序號、型號或零件。', '縮小搜尋結果。', '點開或匯出需要的資料。', '用明細確認前面頁面的判斷。']
    },
    quality: {
      simple: '給品保看整體品質指標。',
      when: '要向主管報告品質表現時看。',
      read: '數字變差不一定立刻異常，要搭配趨勢一起看。',
      steps: ['看故障率和重修率。', '確認是否連續變差。', '對照異常偵測頁。', '需要正式改善時再開追蹤。']
    },
    batch: {
      simple: '看是不是同一批產品或同一批料比較容易壞。',
      when: '懷疑批次問題時看。',
      read: '同批次集中出現，才值得往批次問題查。',
      steps: ['看故障是否集中在某批。', '確認批次數量夠不夠。', '比對故障零件和原因。', '必要時請品保追批次來源。']
    },
    risk: {
      simple: '把問題按風險大小排隊。',
      when: '問題很多，不知道先處理哪個時看。',
      read: '分數越高，越應該優先處理。',
      steps: ['看最高風險項目。', '確認是不是也有長期上升。', '選前幾名安排改善。', '處理後回來看分數是否下降。']
    },
    capa: {
      simple: '把要改善的事列成追蹤清單。',
      when: '確定有重大或長期異常，需要追到結案時看。',
      read: '這頁是管理改善事項，不是找異常的第一站。',
      steps: ['先從異常或風險頁找到問題。', '建立改善項目。', '填負責人和期限。', '每週更新狀態直到關閉。']
    },
    cost: {
      simple: '把故障和報廢換算成大概花了多少錢。',
      when: '要向管理層說明改善效益時看。',
      read: '成本需要先設定單價；沒設定時只當參考。',
      steps: ['先確認單價資料是否正確。', '看報廢和維修成本。', '找成本最高的型號或零件。', '用來支持改善優先順序。']
    },
    partsdb: {
      simple: '幫零件取好懂的分類名字。',
      when: '零件名稱太難懂、想統一分類時看。',
      read: '分類越清楚，其他頁面的分析越好懂。',
      steps: ['搜尋零件品號。', '確認系統分類是否正確。', '必要時改成好懂的類別。', '回到零件分析確認標籤是否正常。']
    }
  };

  function injectHelp(pageName) {
    const guide = PAGE_GUIDE[pageName];
    const help = HELP[pageName];
    const pageEl = $(`page${pageName.charAt(0).toUpperCase() + pageName.slice(1)}`);
    if (!pageEl) return;
    // Remove old inline help block if any
    const old = pageEl.querySelector(':scope > .page-simple-help, :scope > .page-help');
    if (old) old.remove();
    if (!help && !guide) return;
    // Inject i-button right after the page title text (inside .page-t)
    const titleEl = pageEl.querySelector(':scope > .page-h .page-t');
    if (!titleEl) return;
    if (!titleEl.querySelector('.ph-icon-btn')) {
      const ibtn = document.createElement('button');
      ibtn.className = 'ph-icon-btn';
      ibtn.title = '看詳細流程';
      ibtn.textContent = 'i';
      ibtn.onclick = () => App.showHelpModal(pageName);
      titleEl.appendChild(ibtn);
    }
    if (guide) {
      const box = document.createElement('div');
      box.className = 'page-simple-help';
      box.innerHTML = `
        <div class="page-simple-help-copy">
          <span class="page-simple-help-label">這頁做什麼</span>
          <span class="page-simple-help-text">${escapeHtml(guide.simple)}</span>
        </div>
        <button class="page-simple-help-btn" type="button">看詳細流程</button>`;
      const btn = box.querySelector('.page-simple-help-btn');
      if (btn) btn.onclick = () => App.showHelpModal(pageName);
      const header = pageEl.querySelector(':scope > .page-h');
      if (header) header.insertAdjacentElement('afterend', box);
    }
  }

  function showHelpModal(pageName) {
    const guide = PAGE_GUIDE[pageName];
    const help = HELP[pageName];
    if (!guide && !help) return;
    const pageTitleEl = document.querySelector(`#page${pageName.charAt(0).toUpperCase()+pageName.slice(1)} .page-t`);
    const pageTitle = pageTitleEl ? pageTitleEl.textContent.replace('i','').trim() : '使用說明';
    let modal = $('helpModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'helpModal';
      modal.className = 'help-modal-mask';
      modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
      document.body.appendChild(modal);
    }
    if (guide) {
      modal.innerHTML = `
      <div class="help-modal">
        <div class="help-modal-h">
          <span class="help-modal-ico">i</span>
          <span class="help-modal-title">${escapeHtml(pageTitle)} · 詳細流程</span>
          <button class="help-modal-close" onclick="document.getElementById('helpModal').style.display='none'">×</button>
        </div>
        <div class="help-modal-body help-modal-simple">
          <div class="help-flow-block">
            <span class="help-flow-label">一句話</span>
            <span class="help-flow-text">${escapeHtml(guide.simple)}</span>
          </div>
          <div class="help-flow-block">
            <span class="help-flow-label">什麼時候看</span>
            <span class="help-flow-text">${escapeHtml(guide.when)}</span>
          </div>
          <div class="help-flow-block help-flow-wide">
            <span class="help-flow-label">先看哪裡</span>
            <span class="help-flow-text">${escapeHtml(guide.read)}</span>
          </div>
          <div class="help-flow-block help-flow-wide">
            <span class="help-flow-label">照這樣做</span>
            <ol class="help-flow-steps">
              ${guide.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
            </ol>
          </div>
        </div>
      </div>`;
      modal.style.display = 'flex';
      return;
    }
    modal.innerHTML = `
      <div class="help-modal">
        <div class="help-modal-h">
          <span class="help-modal-ico">i</span>
          <span class="help-modal-title">${pageTitle} · 使用說明</span>
          <button class="help-modal-close" onclick="document.getElementById('helpModal').style.display='none'">✕</button>
        </div>
        <div class="help-modal-body">
          <div class="ph-item"><span class="ph-k">📊 能看出什麼</span><span class="ph-v">${help.what}</span></div>
          <div class="ph-item"><span class="ph-k">💡 代表什麼</span><span class="ph-v">${help.meaning}</span></div>
          <div class="ph-item"><span class="ph-k">👥 哪些單位要注意</span><span class="ph-v">${help.who}</span></div>
          ${help.kpis && help.kpis.length ? `
          <div class="ph-item ph-item-full">
            <span class="ph-k">📐 指標說明</span>
            <div class="ph-kpi-table">
              ${help.kpis.map(k => `
                <div class="ph-kpi-row">
                  <div class="ph-kpi-name">${k.name}</div>
                  <div class="ph-kpi-body">
                    <div class="ph-kpi-formula"><span class="ph-kpi-label">計算</span>${k.formula}</div>
                    <div class="ph-kpi-benchmark"><span class="ph-kpi-label">參考值</span>${k.benchmark}</div>
                    ${k.tip ? `<div class="ph-kpi-tip"><span class="ph-kpi-label">提示</span>${k.tip}</div>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>` : ''}
          ${help.tips && help.tips.length ? `
          <div class="ph-item ph-item-full">
            <span class="ph-k">✅ 操作提示</span>
            <ul class="ph-tips">
              ${help.tips.map(t => `<li>${t}</li>`).join('')}
            </ul>
          </div>` : ''}
        </div>
      </div>`;
    modal.style.display = 'flex';
  }

  function renderPage() {
    // Destroy any existing charts on the page
    for (const k of Object.keys(state.charts)) {
      if (state.charts[k]) { state.charts[k].destroy(); state.charts[k] = null; }
    }
    injectHelp(state.currentPage);
    renderGlobalRoleBanner();
    switch (state.currentPage) {
      case 'summary':  renderSummary(); break;
      case 'overview': renderOverview(); break;
      case 'alerts':   renderAlerts(); break;
      case 'parts':    renderParts(); break;
      case 'cross':    renderCross(); break;
      case 'trend':    renderTrend(); break;
      case 'reason':   renderReason(); break;
      case 'scrap':    renderScrap(); break;
      case 'detail':   renderDetail(); break;
      case 'quality':  renderQuality(); break;
      case 'batch':    renderBatch(); break;
      case 'risk':     renderRisk(); break;
      case 'capa':     renderCapa(); break;
      case 'cost':     renderCost(); break;
      case 'partsdb':  renderPartsdb(); break;
    }
  }

  // ─────────────── Overview ───────────────
  // C4: Month comparison mode
  function renderComparePanel() {
    const el = document.getElementById('comparePanel');
    if (!el || !state.db) return;
    const allMonths = Object.keys(state.db.months).sort();
    if (allMonths.length < 2) { el.style.display = 'none'; return; }

    const cmpA = state.compareMonthA || allMonths[allMonths.length - 1];
    const cmpB = state.compareMonthB || allMonths[allMonths.length - 2];
    state.compareMonthA = cmpA;
    state.compareMonthB = cmpB;

    const makeKpis = (mk) => {
      const recs = RepairAnalyzer.getRecords(state.db, { months: [mk] });
      const den = RepairAnalyzer.getDenominators(state.db, { months: [mk] });
      return RepairAnalyzer.computeKPIs(recs, den);
    };
    const kA = makeKpis(cmpA);
    const kB = makeKpis(cmpB);

    const diff = (a, b, pct) => {
      if (a == null || b == null || b === 0) return '';
      const delta = a - b;
      const pctD = b !== 0 ? ((a - b) / b * 100).toFixed(1) : null;
      const color = delta > 0 ? 'var(--critical)' : delta < 0 ? 'var(--ok)' : 'var(--text3)';
      const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
      return `<span style="color:${color};font-size:12px;margin-left:6px">${arrow}${pctD != null ? pctD + '%' : ''}</span>`;
    };

    const row = (label, ka, kb) => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px 12px;color:var(--text3);font-size:13px">${label}</td>
        <td style="padding:8px 12px;font-family:var(--mono);font-weight:600;text-align:right">${ka == null ? '—' : typeof ka === 'number' ? ka.toLocaleString() : ka}</td>
        <td style="padding:8px 12px;font-family:var(--mono);font-weight:600;text-align:right">${kb == null ? '—' : typeof kb === 'number' ? kb.toLocaleString() : kb}${diff(ka, kb)}</td>
      </tr>`;

    const opts = allMonths.map(m => `<option value="${m}" ${m === cmpA ? 'selected' : ''}>${fmt.monthLabel(m)}</option>`).join('');
    const optsB = allMonths.map(m => `<option value="${m}" ${m === cmpB ? 'selected' : ''}>${fmt.monthLabel(m)}</option>`).join('');

    el.innerHTML = `
      <div class="card-h" style="margin-bottom:12px">
        <div class="card-t">月份對比</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="fsc-sel" onchange="App.setCmpA(this.value)" style="padding:4px 8px;border-radius:6px">${opts}</select>
          <span style="color:var(--text3);font-size:13px">vs</span>
          <select class="fsc-sel" onchange="App.setCmpB(this.value)" style="padding:4px 8px;border-radius:6px">${optsB}</select>
        </div>
      </div>
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:320px">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:var(--text3)">指標</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:var(--accent)">${fmt.monthLabel(cmpA)}</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:var(--text2)">${fmt.monthLabel(cmpB)} <span style="font-size:11px;color:var(--text3)">(環比)</span></th>
        </tr></thead>
        <tbody>
          ${row('總維修件數', kA.totalRepairs, kB.totalRepairs)}
          ${row('報廢件數', kA.scrap, kB.scrap)}
          ${row('報廢率(%)', kA.scrapPct != null ? +kA.scrapPct.toFixed(2) : null, kB.scrapPct != null ? +kB.scrapPct.toFixed(2) : null)}
          ${row('受檢機種數', kA.models, kB.models)}
          ${row('重複維修台數', kA.repeatedSerials, kB.repeatedSerials)}
        </tbody>
      </table>
      </div>`;
  }

  function renderOverview() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const denom = RepairAnalyzer.getDenominators(state.db, f);
    const kpis = RepairAnalyzer.computeKPIs(records, denom);

    const allMonths = Object.keys(state.db.months).sort();
    const monthLabel = state.selectedMonths.length === allMonths.length
      ? `全部 ${allMonths.length} 個月`
      : state.selectedMonths.sort().map(fmt.monthLabel).join(' · ');
    $('overviewMeta').textContent = monthLabel;

    renderModelAuditBanner();

    // KPIs (all clickable)
    const scrapClass = kpis.scrapPct >= 10 ? 'bad' : kpis.scrapPct >= 5 ? 'warn' : 'good';
    const denomClass = kpis.denomPct >= 5 ? 'bad' : kpis.denomPct >= 2 ? 'warn' : 'good';

    // MoM：以選擇範圍最新月份 vs 它的上一個月（同篩選條件）
    const kpiCurMk = state.selectedMonths.slice().sort().pop();
    const kpiPrevMk = prevMonthOf(kpiCurMk);
    let momK = null, momCurK = null;
    if (kpiPrevMk) {
      const mf = { category: f.category, model: f.model };
      const curR = RepairAnalyzer.getRecords(state.db, { ...mf, months: [kpiCurMk] });
      const prevR = RepairAnalyzer.getRecords(state.db, { ...mf, months: [kpiPrevMk] });
      momCurK = RepairAnalyzer.computeKPIs(curR, RepairAnalyzer.getDenominators(state.db, { ...mf, months: [kpiCurMk] }));
      momK = RepairAnalyzer.computeKPIs(prevR, RepairAnalyzer.getDenominators(state.db, { ...mf, months: [kpiPrevMk] }));
    }
    const momLbl = kpiPrevMk ? `${fmt.monthLabel(kpiCurMk)} vs ${fmt.monthLabel(kpiPrevMk)}` : '';
    const momRow = (badge) => (momK && badge)
      ? `<div class="kpi-mom" title="${momLbl}">${badge}<span class="muted" style="margin-left:5px">vs 上月</span></div>` : '';

    $('kpiGrid').innerHTML = `
      <div class="kpi k-blue" onclick="App.openKpiDrawer('total')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">總維修件數</div><div class="kpi-ico">∑</div></div>
        <div class="kpi-v">${fmt.int(kpis.totalRepairs)}</div>
        <div class="kpi-d">
          佔整新數 <span class="pct ${denomClass}">${fmt.pct(kpis.denomPct)}</span>
          <span class="muted">/ ${fmt.int(kpis.denomTotal)}</span>
        </div>
        ${momRow(momK ? momBadge(momCurK.totalRepairs, momK.totalRepairs) : '')}
      </div>
      <div class="kpi k-info" onclick="App.openKpiDrawer('models')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">受檢機種</div><div class="kpi-ico">#</div></div>
        <div class="kpi-v">${fmt.int(kpis.models)}</div>
        <div class="kpi-d"><span class="muted">機種數 · ${state.selectedCategory === '全部' ? '全分類' : state.selectedCategory}</span></div>
        ${momRow(momK ? momBadge(momCurK.models, momK.models) : '')}
      </div>
      <div class="kpi k-red" onclick="App.openKpiDrawer('scrap')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">報廢件數</div><div class="kpi-ico">✕</div></div>
        <div class="kpi-v">${fmt.int(kpis.scrap)}</div>
        <div class="kpi-d">
          報廢率 <span class="pct ${scrapClass}">${fmt.pct(kpis.scrapPct)}</span>
          <span class="muted">/ 總維修</span>
        </div>
        ${momRow(momK ? momBadge(momCurK.scrap, momK.scrap) : '')}
      </div>
      <div class="kpi k-warn" onclick="App.openKpiDrawer('repeated')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">重複維修</div><div class="kpi-ico">♺</div></div>
        <div class="kpi-v">${fmt.int(kpis.repeatedSerials)}</div>
        <div class="kpi-d"><span class="muted">同序號 ≥ 2 次 · 治標未治本</span></div>
        ${momRow(momK ? momBadge(momCurK.repeatedSerials, momK.repeatedSerials) : '')}
      </div>
    `;

    // C4: Month comparison panel
    renderComparePanel();

    // Role-specific insight panel
    const lastMonth = state.selectedMonths.slice().sort().pop();
    const anoms = RepairAnalyzer.detectAnomalies(state.db, lastMonth);
    state.currentAnomalies = anoms;
    renderRoleInsights(state.analysisRole, records, kpis, anoms);

    $('alertStrip').innerHTML = anoms.length === 0
      ? `<div class="card" style="grid-column:1/-1"><div class="empty"><div class="empty-ico">✓</div><div class="empty-t">本期未偵測到顯著異常</div></div></div>`
      : anoms.slice(0, 3).map((a, i) => `
          <div class="alert ${a.severity}" onclick="App.dismissAlertPulse();App.openAnomalyDrawer(${i})">
            <div class="alert-h">
              <span class="alert-ico">${a.icon}</span>
              <span class="alert-t">${a.title}</span>
            </div>
            <div class="alert-s">${escapeHtml(a.subject)}</div>
            <div class="alert-m">${escapeHtml(a.message)}</div>
          </div>
      `).join('');

    // Machine ranking with per-month history (TABLE)
    // 排序依據：最新月份的故障率（本月有資料的優先），歷史月份僅供對照
    const sortedMonths = state.selectedMonths.slice().sort();
    const curMonth = sortedMonths[sortedMonths.length - 1];
    const curRecords = RepairAnalyzer.getRecords(state.db, { category: f.category, model: f.model, months: [curMonth] });
    const curDenom   = RepairAnalyzer.getDenominators(state.db, { category: f.category, model: f.model, months: [curMonth] });
    const ranks = RepairAnalyzer.modelRank(curRecords, curDenom, state.db, sortedMonths);
    state.currentRanks = ranks;  // cache for click handlers
    const maxCount = Math.max(...ranks.map(r => r.count), 1);
    $('rankMeta').textContent = `${ranks.length} 個機種 · 依本月(${fmt.monthLabel(curMonth)})故障率排序`;
    // Reverse for display: newest month first
    const displayMonths = sortedMonths.slice().reverse();

    const monthCount = displayMonths.length;
    const showTotalCol = monthCount >= 2;

    const rows = ranks.map((r, i) => {
      const altCls = (i % 2 === 1) ? ' alt' : '';
      const noClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const hist = r.history || [];
      const histByMonth = Object.fromEntries(hist.map(h => [h.month, h]));

      // Build month cells（本月格附帶環比變化，一眼看出惡化/改善）
      const rankPrevMk = sortedMonths.length >= 2 ? sortedMonths[sortedMonths.length - 2] : null;
      const prevH = rankPrevMk ? histByMonth[rankPrevMk] : null;
      const monthCells = displayMonths.map(mk => {
        const isCurrent = mk === curMonth;
        const h = histByMonth[mk];
        const clickAttr = `onclick="event.stopPropagation();App.openModelDrawer('${escapeAttr(r.model)}','${mk}')"`;
        let momHtml = '';
        if (isCurrent && prevH) {
          const curRate = h && h.faultRate != null ? h.faultRate * 100 : null;
          const prevRate = prevH.faultRate != null ? prevH.faultRate * 100 : null;
          const badge = (curRate != null && prevRate != null)
            ? momBadge(curRate, prevRate, { pp: true })
            : momBadge(h ? h.count : 0, prevH.count);
          if (badge) momHtml = `<div class="mc-mom" title="vs ${fmt.monthLabel(rankPrevMk)}">${badge}</div>`;
        }
        if (!h || h.count === 0) {
          return `<td class="month-cell empty ${isCurrent ? 'current' : ''}" ${clickAttr} style="cursor:pointer">
            <div class="mc-pct empty">—</div>${momHtml}
          </td>`;
        }
        if (h.denom === 0 || h.faultRate == null) {
          return `<td class="month-cell no-denom ${isCurrent ? 'current' : ''}" ${clickAttr} style="cursor:pointer">
            <div class="mc-pct">${h.count}<span class="unit">件</span></div>
            <div class="mc-ratio"><span class="no-denom-mark" title="此機種此月份無整新數資料">無分母</span></div>${momHtml}
          </td>`;
        }
        const pCls = h.faultRate >= 0.1 ? 'bad' : h.faultRate >= 0.05 ? 'warn' : 'good';
        return `<td class="month-cell ${isCurrent ? 'current' : ''}" ${clickAttr} style="cursor:pointer">
          <div class="mc-pct ${pCls}">${(h.faultRate * 100).toFixed(1)}%</div>
          <div class="mc-ratio"><span class="num">${h.count}</span> <span class="denom">/ ${h.denom}</span></div>${momHtml}
        </td>`;
      }).join('');

      // Total column
      let totalCell = '';
      if (showTotalCol) {
        const totalCount = hist.reduce((s, h) => s + h.count, 0);
        const totalDenom = hist.reduce((s, h) => s + (h.denom || 0), 0);
        const totalRate = totalDenom ? totalCount / totalDenom : null;
        if (totalCount === 0) {
          totalCell = `<td class="month-cell total empty"><div class="mc-pct empty">—</div></td>`;
        } else if (totalRate == null) {
          totalCell = `<td class="month-cell total no-denom">
            <div class="mc-pct">${totalCount}<span class="unit">件</span></div>
            <div class="mc-ratio"><span class="no-denom-mark" title="無整新數資料">無分母</span></div>
          </td>`;
        } else {
          const totalCls = totalRate >= 0.1 ? 'bad' : totalRate >= 0.05 ? 'warn' : 'good';
          totalCell = `<td class="month-cell total">
            <div class="mc-pct ${totalCls}">${(totalRate * 100).toFixed(1)}%</div>
            <div class="mc-ratio"><span class="num">${totalCount}</span> <span class="denom">/ ${totalDenom}</span></div>
          </td>`;
        }
      }

      return `
        <tr class="rank-row${altCls}" data-idx="${i}" onclick="App.toggleRankRow(${i})">
          <td class="rank-cell"><div class="rank-no ${noClass}">${i + 1}</div></td>
          <td class="model-cell" onclick="event.stopPropagation();App.openModelDrawer('${escapeAttr(r.model)}')">
            <div class="model-name">${r.model}</div>
            <div class="model-cat" style="--c:${CAT_COLOR[r.category] || COLORS.text3}">${r.category}</div>
          </td>
          ${monthCells}
          ${totalCell}
          <td class="trend-cell">
            <div class="trend-bar"><div style="width:${(r.count / maxCount * 100).toFixed(1)}%"></div></div>
            <div class="trend-label">${r.scrap} 報廢</div>
          </td>
          <td class="chev-cell"><span class="chev">▾</span></td>
        </tr>
        <tr class="rank-detail-row" id="rdr${i}">
          <td colspan="${4 + monthCount + (showTotalCol ? 1 : 0)}">
            <div class="rank-detail-grid">
              <div>
                <div class="mrank-sub-t">最常更換零件（本期）</div>
                <div class="barlist">
                  ${r.topParts.map(p => `
                    <div class="barlist-row" style="cursor:pointer" onclick="App.openPartDrawer('${escapeAttr(p.name)}')">
                      <div class="barlist-name">${pdbLabel(p.name)} ${pdbTag(p.name)}</div>
                      <div class="barlist-track"><div style="width:${(p.count / r.topParts[0].count * 100).toFixed(0)}%"></div></div>
                      <div class="barlist-n">${p.count}</div>
                    </div>`).join('') || '<div class="muted" style="font-size:12px">—</div>'}
                </div>
              </div>
              <div>
                <div class="mrank-sub-t">故障內容（本期）</div>
                <div class="barlist">
                  ${r.topContents.map(c => `
                    <div class="barlist-row">
                      <div class="barlist-name">${escapeHtml(c.name)}</div>
                      <div class="barlist-track"><div style="width:${(c.count / r.topContents[0].count * 100).toFixed(0)}%; background:var(--warn)"></div></div>
                      <div class="barlist-n">${c.count}</div>
                    </div>`).join('') || '<div class="muted" style="font-size:12px">—</div>'}
                </div>
                ${r.repeatedSerials.length > 0 ? `
                  <div class="mrank-sub-t" style="margin-top:20px">重複維修序號 (${r.repeatedSerials.length})</div>
                  <div style="font-family:var(--mono);font-size:12px;color:var(--text2);line-height:1.8">
                    ${r.repeatedSerials.slice(0, 6).map(([s, c]) => `<span style="cursor:pointer" onclick="App.openSerialDrawer('${escapeAttr(r.model)}','${escapeAttr(s)}')">#${s} <span class="muted">×${c}</span></span>`).join('　')}
                  </div>` : ''}
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Default column widths (px). User can drag to resize.
    const monthWidth = 140;
    const totalWidth = 140;
    const widths = {
      rank: 56,
      model: 200,
      month: monthWidth,
      total: totalWidth,
      trend: 130,
      chev: 48,
    };

    const tableHtml = ranks.length === 0
      ? `<div class="empty"><div class="empty-ico">◌</div><div class="empty-t">當前篩選範圍內無資料</div></div>`
      : `
        <div class="rank-legend">
          <span class="lg-item"><span class="lg-dot good"></span>故障率 &lt; 5%</span>
          <span class="lg-item"><span class="lg-dot warn"></span>5% – 10%</span>
          <span class="lg-item"><span class="lg-dot bad"></span>≥ 10%</span>
          <span class="lg-info"><span class="no-denom-mark">無分母</span> 代表該機種無整新數資料，僅顯示維修件數</span>
        </div>
        <div class="rank-wrap" id="rankWrap">
          <table class="rank-table" id="rankTable">
            <colgroup>
              <col style="width:${widths.rank}px">
              <col style="width:${widths.model}px">
              ${displayMonths.map(() => `<col style="width:${widths.month}px">`).join('')}
              ${showTotalCol ? `<col style="width:${widths.total}px">` : ''}
              <col style="width:${widths.trend}px">
              <col style="width:${widths.chev}px">
            </colgroup>
            <thead>
              <tr>
                <th>#<span class="col-resizer" data-col-idx="0"></span></th>
                <th class="model-th">機種<span class="col-resizer" data-col-idx="1"></span></th>
                ${displayMonths.map((mk, mi) => {
                  const isCurrent = mk === curMonth;
                  return `<th class="month-col ${isCurrent ? 'current' : ''}">
                    <span class="month-l">${isCurrent ? '本月' : '歷史'}</span>
                    <span class="month-v">${fmt.monthLabel(mk)}</span>
                    <span class="col-resizer" data-col-idx="${2 + mi}"></span>
                  </th>`;
                }).join('')}
                ${showTotalCol ? `<th class="month-col total-col">
                  <span class="month-l">累積</span>
                  <span class="month-v">合計</span>
                  <span class="col-resizer" data-col-idx="${2 + displayMonths.length}"></span>
                </th>` : ''}
                <th class="month-col trend-th">
                  <span class="month-l">趨勢</span>
                  <span class="month-v" style="font-size:11px;color:var(--text-mute)">維修量比</span>
                  <span class="col-resizer" data-col-idx="${2 + displayMonths.length + (showTotalCol ? 1 : 0)}"></span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    $('machineRank').innerHTML = tableHtml;

    // Wire up column resizers
    if (ranks.length > 0) setupColResizers();

    // Top parts strip (top 8) - clickable
    const pareto = RepairAnalyzer.partPareto(records).slice(0, 8);
    const top1 = pareto[0]?.count || 1;
    $('topPartsGrid').innerHTML = pareto.map((p, i) => `
      <div class="barlist-row" style="cursor:pointer" onclick="App.openPartDrawer('${escapeAttr(p.name)}')">
        <div class="barlist-name" title="${escapeHtml(p.name)}">
          <span class="muted" style="font-family:var(--mono);font-size:11px;margin-right:6px">${String(i + 1).padStart(2, '0')}</span>
          ${pdbLabel(p.name)}
          ${p.models.length > 1 ? `<span class="tag" style="margin-left:6px">⇄ ${p.models.length}機種</span>` : ''}
        </div>
        <div class="barlist-track"><div style="width:${(p.count / top1 * 100).toFixed(0)}%"></div></div>
        <div class="barlist-n">${p.count}</div>
      </div>
    `).join('') || '<div class="empty"><div class="empty-t">無資料</div></div>';
  }

  function toggleRank(el) {
    el.classList.toggle('open');
  }

  function toggleRankRow(idx) {
    const row = document.querySelector(`tr.rank-row[data-idx="${idx}"]`);
    const detail = document.getElementById(`rdr${idx}`);
    if (!row || !detail) return;
    const isOpen = row.classList.contains('open');
    if (isOpen) {
      row.classList.remove('open');
      detail.classList.remove('show');
    } else {
      row.classList.add('open');
      detail.classList.add('show');
    }
  }

  // ─────────────── Column resizers ───────────────
  function setupColResizers() {
    const table = $('rankTable');
    if (!table) return;
    const cols = table.querySelectorAll('col');
    const resizers = table.querySelectorAll('.col-resizer');

    resizers.forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const colIdx = parseInt(handle.dataset.colIdx, 10);
        const col = cols[colIdx];
        if (!col) return;
        const startX = e.clientX;
        const startWidth = parseInt(getComputedStyle(col).width, 10);

        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const newWidth = Math.max(60, startWidth + dx);
          col.style.width = newWidth + 'px';
        };
        const onUp = () => {
          handle.classList.remove('dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  // ─────────────── Alerts (full page) ───────────────
  function renderAlerts() {
    const lastMonth = state.selectedMonths.slice().sort().pop();
    const anoms = RepairAnalyzer.detectAnomalies(state.db, lastMonth);
    state.currentAnomalies = anoms;

    const groups = {
      critical: anoms.filter(a => a.severity === 'critical'),
      warn:     anoms.filter(a => a.severity === 'warn'),
      info:     anoms.filter(a => a.severity === 'info'),
    };
    $('alertsMeta').textContent = `${anoms.length} 筆 · ${groups.critical.length} 嚴重 · ${groups.warn.length} 注意 · ${groups.info.length} 提醒`;

    if (!anoms.length) {
      $('anomGrid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">✓</div><div class="empty-t">未偵測到顯著異常 — 一切看起來正常</div></div>`;
      return;
    }

    const collapsed = state.alertColCollapsed || {};
    const col = (key, label, cls) => {
      const items = groups[key];
      const isCol = !!collapsed[key];
      return `
        <div class="acol ${cls} ${isCol ? 'collapsed' : ''}">
          <button class="acol-head" onclick="App.toggleAlertCol('${key}')">
            <span class="acol-dot"></span>
            <span class="acol-label">${label}</span>
            <span class="acol-count">${items.length}</span>
            <span class="acol-arrow">▾</span>
          </button>
          <div class="acol-body">
            ${items.length ? items.map(a => alertMiniCard(a, anoms.indexOf(a))).join('') : '<div class="acol-empty">本期無此級別事項</div>'}
          </div>
        </div>`;
    };

    $('anomGrid').innerHTML = `
      <div class="alert-cols">
        ${col('critical', '嚴重', 'crit')}
        ${col('warn', '注意', 'warn')}
        ${col('info', '提醒', 'info')}
      </div>`;
  }

  function toggleAlertCol(key) {
    state.alertColCollapsed = state.alertColCollapsed || {};
    state.alertColCollapsed[key] = !state.alertColCollapsed[key];
    renderAlerts();
  }

  // 異常類型 → 顏色（讓不同種類警示一眼可辨）
  function anomalyTypeStyle(title) {
    const t = title || '';
    if (t.includes('報廢主因')) return { color: '#a78bfa', bg: 'rgba(167,139,250,.16)' };
    if (t.includes('零件'))     return { color: '#38bdf8', bg: 'rgba(56,189,248,.16)' };
    if (t.includes('機種'))     return { color: '#fb923c', bg: 'rgba(251,146,60,.16)' };
    if (t.includes('故障原因')) return { color: '#a78bfa', bg: 'rgba(167,139,250,.16)' };
    if (t.includes('報廢'))     return { color: '#ef4444', bg: 'rgba(239,68,68,.16)' };
    if (t.includes('重複'))     return { color: '#f472b6', bg: 'rgba(244,114,182,.16)' };
    return { color: '#94a3b8', bg: 'rgba(148,163,184,.16)' };
  }

  const SEV_COLOR = { critical: 'var(--critical)', warn: 'var(--warn)', info: 'var(--info)' };

  function alertMiniCard(a, idx) {
    const ts = anomalyTypeStyle(a.title);
    return `
      <div class="amini ${a.severity}" onclick="App.openAnomalyDrawer(${idx})">
        <span class="amini-type" style="background:${ts.bg};color:${ts.color}">${a.icon || '!'} ${a.title}</span>
        <div class="amini-subject">${escapeHtml(a.subject || '')}</div>
        ${a.message ? `<div class="amini-msg">${escapeHtml(a.message)}</div>` : ''}
        ${a.metric != null ? `<div class="amini-metric" style="color:${SEV_COLOR[a.severity] || 'var(--text)'}">${a.metric}<span>${a.metricLabel || ''}</span></div>` : ''}
      </div>`;
  }

  // ─────────────── Parts (Pareto) ───────────────
  // ── Component-category root cause (依元件料號大類分群) ──
  function renderComponentCategory(f) {
    const cc = RepairAnalyzer.componentCategoryPareto(state.db, f);
    const listEl = $('componentCatList');
    const canvas = $('componentCatChart');
    if (!cc.list.length) {
      if (listEl) listEl.innerHTML = `<div class="empty sm"><div class="empty-t">此範圍無可歸類的故障零件（需 故障零件總數 含品號）</div></div>`;
      return;
    }
    const top = cc.list.slice(0, 12);
    if (canvas) {
      state.charts.componentCat = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: top.map(c => c.name),
          datasets: [{
            label: '故障零件數',
            data: top.map(c => c.count),
            backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
            borderColor: top.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 0, borderRadius: 3,
          }],
        },
        options: {
          indexAxis: 'y',
          maintainAspectRatio: false, responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => `${c.parsed.x} 件 · ${(top[c.dataIndex].pct * 100).toFixed(1)}%` } },
          },
          scales: {
            x: { ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } },
            y: { ticks: { color: COLORS.text2, font: { size: 11 } }, grid: { display: false } },
          },
        },
      });
    }
    // breakdown list with top parts per category + 建議備料量 (近期故障數 × 1.5 安全係數)
    const monthsN = Math.max(1, (f.months && f.months.length) || (state.selectedMonths || []).length || 1);
    listEl.innerHTML = cc.list.slice(0, 8).map((c, i) => {
      const perMonth = c.count / monthsN;
      const suggest = Math.ceil(perMonth * 1.5);
      return `
      <div class="comp-cat-item">
        <div class="comp-cat-head">
          <span class="comp-cat-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
          <span class="comp-cat-name">${escapeHtml(c.name)}</span>
          <span class="comp-cat-val">${c.count} 件 · ${(c.pct * 100).toFixed(1)}%</span>
        </div>
        <div class="comp-cat-parts">${c.topParts.map(p => `${pdbLabel(p.name)}<span class="ccp-n">×${p.count}</span>`).join(' · ')}</div>
        <div class="comp-cat-stock">📦 建議安全備料 <b>${suggest}</b> 個/月　<span class="muted">（近 ${monthsN} 月月均 ${perMonth.toFixed(1)} 件 × 1.5 安全係數）</span></div>
      </div>`;
    }).join('') + (cc.uncategorized ? `<div class="comp-cat-foot">未能歸類 ${cc.uncategorized} 件（品號不在料號表）</div>` : '');
  }

  // ─────────────── Manufacture / origin batch analysis ───────────────
  function renderBatch() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const rows = RepairAnalyzer.batchAnalysis(records);
    const cond = RepairAnalyzer.conditionSummary(records);
    const flagged = rows.filter(r => r.flags.length);
    const total = records.length;
    const withOrder = rows.reduce((s, r) => s + r.withOrder, 0);
    const dated = rows.reduce((s, r) => s + r.dated, 0);
    const earlyNew = rows.reduce((s, r) => s + r.earlyNew, 0);
    const earlyRefurb = rows.reduce((s, r) => s + r.earlyRefurb, 0);
    $('batchMeta').textContent = `${rows.length} 機種 · 製令 ${withOrder}/${total} · 製造日期 ${dated}/${total}`;

    const badge = $('batchBadge');
    if (badge) { if (flagged.length) { badge.style.display = ''; badge.textContent = flagged.length; } else badge.style.display = 'none'; }

    const orderPct = total ? withOrder / total : 0;
    const noticeEl = $('batchNotice');
    if (noticeEl) {
      if (cond.known === 0 && orderPct < 0.5) {
        noticeEl.innerHTML = `<div class="data-notice warn"><span class="dn-ico">📋</span><div><strong>全新/整新分析功能待解鎖</strong>——這是資料尚未齊備的預期狀態，系統邏輯已備好。<br><strong>解鎖步驟：</strong>① 請工廠在 Excel 每工作表加「製令品號」欄位（格式 YYMMDD+3碼，如 250410057）→ ② 保留「製造日期」欄位 → ③ 重新上傳，系統自動研判全新/整新與責任落點。<br><span class="muted">目前 ${withOrder}/${total}（${Math.round(orderPct*100)}%）筆有製令，同時具備「製令＋製造日期」：0 筆。</span></div></div>`;
        noticeEl.style.display = '';
      } else { noticeEl.style.display = 'none'; }
    }

    $('batchKpi').innerHTML = `
      <div class="kpi k-red"><div class="kpi-h"><div class="kpi-l">全新早夭件數</div><div class="kpi-ico">⏱</div></div>
        <div class="kpi-v">${earlyNew}</div><div class="kpi-d"><span class="muted">全新品 · 出廠月=檢修月（原廠責任）</span></div></div>
      <div class="kpi k-warn"><div class="kpi-h"><div class="kpi-l">整新後即壞</div><div class="kpi-ico">♻</div></div>
        <div class="kpi-v">${earlyRefurb}</div><div class="kpi-d"><span class="muted">整新品 · 整新月=檢修月（整新責任）</span></div></div>
      <div class="kpi k-info"><div class="kpi-h"><div class="kpi-l">批次風險機種</div><div class="kpi-ico">⊞</div></div>
        <div class="kpi-v">${flagged.length}</div><div class="kpi-d"><span class="muted">出廠/製造批次集中或早夭</span></div></div>
      <div class="kpi k-blue"><div class="kpi-h"><div class="kpi-l">製令涵蓋率</div><div class="kpi-ico">%</div></div>
        <div class="kpi-v">${total ? Math.round(withOrder / total * 100) : 0}%</div><div class="kpi-d"><span class="muted">${withOrder}/${total} 筆有製令</span></div></div>
    `;

    // ── Condition doughnut (全新/整新/未知) ──
    const cc = $('conditionChart');
    if (cc) {
      state.charts.condition = new Chart(cc.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['全新', '整新', '未知（缺製令或製造日期）'],
          datasets: [{ data: [cond.brandNew, cond.refurb, cond.unknown], backgroundColor: [COLORS.accent, COLORS.warn, COLORS.surface2], borderColor: COLORS.bg, borderWidth: 2 }],
        },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: COLORS.text2, font: { size: 11 } } } } },
      });
    }
    $('conditionNote').innerHTML = cond.known
      ? `<div class="bn-line">可判定 ${cond.known} 筆：全新 ${cond.brandNew}（報廢率 ${(cond.brandNewScrapPct * 100).toFixed(0)}%）· 整新 ${cond.refurb}（報廢率 ${(cond.refurbScrapPct * 100).toFixed(0)}%）。<b>全新故障→原廠/來料責任；整新故障→整新製程責任。</b></div>`
      : `<div class="bn-line muted">目前 ${total} 筆中無單筆同時具備「製令 + 製造日期」，暫無法判定全新/整新。待工廠補齊製令後即自動分類。</div>`;

    // ── Origin-batch Pareto (元件瑕疵落點) ──
    const ob = RepairAnalyzer.originBatchPareto(records);
    const oc = $('originBatchChart');
    if (oc && ob.list.length) {
      const top = ob.list.slice(0, 12).slice().sort((a, b) => a.month < b.month ? -1 : 1);
      state.charts.originBatch = new Chart(oc.getContext('2d'), {
        type: 'bar',
        data: {
          labels: top.map(b => b.month),
          datasets: [{ label: '故障件數', data: top.map(b => b.count), backgroundColor: top.map(b => b.pct >= 0.2 ? COLORS.critical + 'cc' : COLORS.accent + 'cc'), borderColor: top.map(b => b.pct >= 0.2 ? COLORS.critical : COLORS.accent), borderWidth: 0, borderRadius: 3 }],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} 件 · ${(top[c.dataIndex].pct * 100).toFixed(1)}% · 機種 ${top[c.dataIndex].models.join(',')}` } } },
          scales: { x: { ticks: { color: COLORS.text3, font: { size: 10 }, maxRotation: 50, minRotation: 40 }, grid: { display: false } }, y: { ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } } },
        },
      });
      const t = ob.list[0];
      $('originNote').innerHTML = `<div class="bn-line">共 ${ob.total} 筆有製令。<b>故障最集中的原始出廠批次：${t.month}（${t.count} 件 · ${(t.pct * 100).toFixed(0)}%）</b> → 該批的元件/製程瑕疵嫌疑最大，責任落點：${t.month} 當期的生產與來料。</div>`;
    } else {
      if (oc) oc.parentElement.style.display = 'none';
      $('originNote').innerHTML = `<div class="bn-line muted">本範圍無製令資料，無法做出廠批次分析。</div>`;
    }

    // ── Per-model risk table ──
    const body = $('batchBody');
    const shown = rows.filter(r => r.withOrder > 0 || r.dated > 0);
    const fmtBatch = (top, pct, batches) => {
      if (!top) return '<span class="muted">—</span>';
      const cls = pct >= 0.4 ? 'bad' : pct >= 0.25 ? 'warn' : '';
      const bar = batches.slice(0, 5).map(b => `<span class="bb-seg" title="${b.month}: ${b.count}">${b.month.slice(2)}·${b.count}</span>`).join('');
      return `<span class="pct ${cls}">${top.month} · ${(pct * 100).toFixed(0)}%</span><div class="batch-bar">${bar}</div>`;
    };
    const flagCls = { '出廠批次集中': 'bc', '製造批次集中': 'rb', '全新早夭': 'ef', '整新後即壞': 'rf' };
    body.innerHTML = shown.map((r, i) => {
      const flagTags = r.flags.map(fl => `<span class="batch-flag ${flagCls[fl] || 'bc'}">${fl}</span>`).join(' ') || '<span class="muted">—</span>';
      const condBar = (r.brandNew || r.refurb)
        ? `<span class="cond-new">全新${r.brandNew}</span> / <span class="cond-ref">整新${r.refurb}</span>${r.unknownCond ? `<span class="muted"> /未知${r.unknownCond}</span>` : ''}`
        : `<span class="muted">未知 ${r.total}</span>`;
      const earlyCell = `${r.earlyNew ? `<span class="pct bad">全新${r.earlyNew}</span>` : ''}${r.earlyRefurb ? ` <span class="pct warn">整新${r.earlyRefurb}</span>` : ''}${r.earlyMfgOnly ? ` <span class="muted" title="缺製令無法判定">?${r.earlyMfgOnly}</span>` : ''}` || '<span class="muted">—</span>';
      return `
        <tr${r.flags.length ? ' class="row-flag"' : ''}>
          <td class="num muted">${i + 1}</td>
          <td><span class="strong">${escapeHtml(r.model)}</span><div class="muted" style="font-size:10.5px">${escapeHtml(r.category)}</div></td>
          <td class="num" style="text-align:right;font-weight:700">${r.total}</td>
          <td style="font-size:11px">${condBar}</td>
          <td>${fmtBatch(r.topOrigin, r.topOriginPct, r.originBatches)}</td>
          <td>${fmtBatch(r.topMfg, r.topMfgPct, r.mfgBatches)}</td>
          <td style="text-align:right;font-size:11px">${earlyCell}</td>
          <td>${flagTags}</td>
        </tr>`;
    }).join('');

    const noData = rows.filter(r => r.withOrder === 0 && r.dated === 0).map(r => r.model);
    $('batchNote').innerHTML = `
      <div class="bn-line"><span class="batch-flag bc">出廠批次集中</span> 單一製令出廠年月佔該機種「有製令」筆數 ≥ 40% → 該<b>原始批次</b>元件/製程瑕疵，責任：當期生產 + 來料/IQC。</div>
      <div class="bn-line"><span class="batch-flag rb">製造批次集中</span> 單一製造日期年月佔「有製造日期」≥ 40% → 該批集中故障；<b>需製令才能區分是出廠批還是整新梯次</b>。</div>
      <div class="bn-line"><span class="batch-flag ef">全新早夭</span> 全新品（製造=製令年月）且出廠月=檢修月 → 新品出廠即壞，責任：研發/製造（OQC 出廠檢驗）。</div>
      <div class="bn-line"><span class="batch-flag rf">整新後即壞</span> 整新品（製造≠製令年月）且整新月=檢修月 → 整新後立即故障，責任：整新製程/檢驗。</div>
      <div class="bn-line muted">「早夭」欄的 <b>?N</b> 代表有製造日期但缺製令，製造當月即故障 N 件 — 補上製令後即可判定屬全新早夭或整新後即壞。</div>
      ${noData.length ? `<div class="bn-line muted">無製令也無製造日期（無法批次分析）：${noData.join('、')}　— 請提醒登錄單位補齊。</div>` : ''}
    `;
  }

  function renderParts() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const pareto = RepairAnalyzer.partPareto(records);
    const total = pareto.reduce((s, p) => s + p.count, 0);
    $('partsMeta').textContent = `${pareto.length} 種零件 · 共 ${total.toLocaleString()} 件`;

    // ── Component-category root cause (故障零件大類) ──
    renderComponentCategory(f);

    // Chart: top 20
    const top = pareto.slice(0, 20);
    const ctx = $('paretoChart').getContext('2d');
    state.charts.pareto = new Chart(ctx, {
      data: {
        labels: top.map(p => p.name.length > 24 ? p.name.substring(0, 24) + '…' : p.name),
        datasets: [
          {
            type: 'bar',
            label: '件數',
            data: top.map(p => p.count),
            backgroundColor: COLORS.accent + 'cc',
            borderColor: COLORS.accent,
            borderWidth: 0,
            borderRadius: 3,
            yAxisID: 'y',
            order: 2,
          },
          {
            type: 'line',
            label: '累計 %',
            data: top.map(p => p.cumPct * 100),
            borderColor: COLORS.warn,
            backgroundColor: COLORS.warn + '20',
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: COLORS.warn,
            borderWidth: 2,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        plugins: { legend: { position: 'top', labels: { color: COLORS.text2, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: COLORS.text3, font: { size: 10 }, maxRotation: 50, minRotation: 40 }, grid: { display: false } },
          y: { ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } },
          y1: { position: 'right', min: 0, max: 100, ticks: { color: COLORS.text3, callback: v => v + '%' }, grid: { display: false } },
        },
      },
    });

    // Table — 較上月：最新月 vs 上一月（同篩選條件）件數環比
    const partCurMk = state.selectedMonths.slice().sort().pop();
    const partPrevMk = prevMonthOf(partCurMk);
    let curPartMap = null, prevPartMap = null;
    if (partPrevMk) {
      const pf = { category: f.category, model: f.model };
      curPartMap = Object.fromEntries(RepairAnalyzer.partPareto(RepairAnalyzer.getRecords(state.db, { ...pf, months: [partCurMk] })).map(p => [p.name, p.count]));
      prevPartMap = Object.fromEntries(RepairAnalyzer.partPareto(RepairAnalyzer.getRecords(state.db, { ...pf, months: [partPrevMk] })).map(p => [p.name, p.count]));
    }
    const allMonthCount = Object.keys(state.db.months).length || 1;
    const tbody = $('paretoBody');
    tbody.innerHTML = pareto.slice(0, 200).map((p, i) => {
      const monthlyAvg = p.count / allMonthCount;
      const suggestQty = Math.max(1, Math.ceil(monthlyAvg * 2));
      let momCell = '<span class="muted">—</span>';
      if (prevPartMap) {
        const c = curPartMap[p.name] || 0, pv = prevPartMap[p.name];
        if (pv == null && c > 0) momCell = `<span class="mom-up" title="上月無此零件用量">NEW</span>`;
        else if (pv != null) momCell = momBadge(c, pv) || '<span class="mom-flat">— 持平</span>';
      }
      return `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td>${pdbLabel(p.name)} ${pdbTag(p.name)}</td>
        <td>
          <span class="tag">${p.models.length} 機種</span>
          <div class="muted" style="font-size:10.5px;font-family:var(--mono);margin-top:3px">${p.models.slice(0, 4).join(', ')}${p.models.length > 4 ? '…' : ''}</div>
        </td>
        <td class="num" style="text-align:right;font-weight:700">${p.count}</td>
        <td class="num" style="text-align:right;font-size:11.5px" title="本月 vs 上月用量">${momCell}</td>
        <td>
          <div class="pwrap">
            <div class="ptrack"><div style="width:${(p.pct * 100).toFixed(1)}%"></div></div>
            <div class="pnum">${(p.pct * 100).toFixed(1)}% / ${(p.cumPct * 100).toFixed(0)}%</div>
          </div>
        </td>
        <td class="num" style="text-align:right">
          <span style="color:var(--warn);font-weight:700">${suggestQty}</span>
          <div class="muted" style="font-size:10px">月均 ${monthlyAvg.toFixed(1)}</div>
        </td>
        <td><button class="btn sm" onclick="App.openPartFaultDrawer('${escapeAttr(p.name)}')">詳情</button></td>
      </tr>`;
    }).join('');
  }

  // ─────────────── Cross-model matrix ───────────────
  function renderCross() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const cross = RepairAnalyzer.crossModelParts(records, 2);
    state.currentCross = cross;
    $('crossMeta').textContent = `${cross.length} 個跨機種零件`;

    if (!cross.length) {
      $('crossMatrix').innerHTML = `<div class="empty"><div class="empty-ico">◌</div><div class="empty-t">未發現跨機種共用零件</div></div>`;
      return;
    }
    // Collect all models present
    const modelSet = new Set();
    cross.forEach(p => p.models.forEach(m => modelSet.add(m)));
    const models = Array.from(modelSet).sort();
    state.currentCrossModels = models;

    // Sort by total count descending (highest = most abnormal → first)
    const sorted = cross.slice().sort((a, b) => b.count - a.count).slice(0, 50);

    // Color scale based on max count in matrix
    const maxCount = Math.max(...sorted.flatMap(p => Object.values(p.perModel)));
    const maxTotal = sorted[0]?.count || 1;

    // Header: 零件名稱 | 合計 | model1 | model2 | ...
    const head = `<tr>
      <th style="min-width:130px">零件名稱</th>
      <th style="color:var(--text);min-width:64px">合計</th>
      ${models.map(m => `<th title="${escapeAttr(m)}">${m}</th>`).join('')}
    </tr>`;

    const body = sorted.map(p => {
      const totalIntensity = Math.min(0.85, 0.18 + (p.count / maxTotal) * 0.65);
      const totalColor = p.count >= 20 ? COLORS.critical : p.count >= 8 ? COLORS.warn : COLORS.accent;
      const totalCell = `<td style="cursor:pointer" onclick="App.openMatrixPartDrawer('${escapeAttr(p.name)}')" title="點擊查看明細">
        <span class="matrix-cell" style="background:${totalColor}${Math.round(totalIntensity * 255).toString(16).padStart(2,'0')}">${p.count}</span>
      </td>`;
      const cells = models.map(m => {
        const v = p.perModel[m];
        if (!v) return `<td class="empty">·</td>`;
        const intensity = Math.min(0.9, 0.15 + (v / maxCount) * 0.6);
        const color = v >= 10 ? COLORS.critical : v >= 5 ? COLORS.warn : COLORS.accent;
        return `<td onclick="App.openMatrixPartDrawer('${escapeAttr(p.name)}')"><span class="matrix-cell" style="background:${color}${Math.round(intensity * 255).toString(16).padStart(2,'0')}">${v}</span></td>`;
      }).join('');
      return `<tr>
        <th scope="row" title="${escapeAttr(p.name)}" onclick="App.openMatrixPartDrawer('${escapeAttr(p.name)}')">${pdbLabel(p.name)}<span class="spec">${p.models.length} 機種</span></th>
        ${totalCell}
        ${cells}
      </tr>`;
    }).join('');

    $('crossMatrix').innerHTML = `<table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // Export cross-model matrix to Excel
  function exportCrossMatrix() {
    const cross = state.currentCross || [];
    const models = state.currentCrossModels || [];
    if (!cross.length) {
      alert('目前無跨機種零件可匯出');
      return;
    }

    // Build worksheet data: header row, then per-part rows
    // Skip 0 values — leave cells blank for readability
    const aoa = [
      ['零件名稱', '影響機種數', ...models, '合計'],
      ...cross.map(p => [
        p.name,
        p.models.length,
        ...models.map(m => p.perModel[m] || ''),
        p.count,
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Set column widths
    ws['!cols'] = [
      { wch: 32 }, { wch: 10 },
      ...models.map(() => ({ wch: 10 })),
      { wch: 8 },
    ];
    // Bold header row
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = { font: { bold: true } };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '跨機種零件矩陣');

    // Build filename with current date
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const monthsLabel = state.selectedMonths.slice().sort().map(fmt.monthLabel).join('-').replace(/\//g, '');
    const filename = `跨機種零件矩陣_${monthsLabel || dateStr}.xlsx`;

    XLSX.writeFile(wb, filename);
  }

  // ─────────────── Trend ───────────────
  function renderTrend() {
    const f = currentFilter();
    const allMonths = Object.keys(state.db.months).sort();
    if (allMonths.length < 2) {
      $('trendMeta').textContent = '需要至少 2 個月份的資料';
      ['trendCountChart','trendRateChart','partTrendChart'].forEach(id => {
        const c = $(id).getContext('2d');
        c.clearRect(0, 0, $(id).width, $(id).height);
      });
      return;
    }

    // Filter only by category/model (not by selected months — trend always shows all)
    const filterForTrend = { category: f.category, model: f.model };
    const trend = RepairAnalyzer.monthlyTrend(state.db, filterForTrend);
    $('trendMeta').textContent = `${allMonths.length} 個月 · ${state.selectedCategory === '全部' ? '全分類' : state.selectedCategory}`;

    const labels = trend.map(t => fmt.monthLabel(t.month));

    // Chart 1: count vs scrap
    state.charts.trendCount = new Chart($('trendCountChart').getContext('2d'), {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: '維修件數', data: trend.map(t => t.count), backgroundColor: COLORS.accent + 'cc', borderRadius: 6, borderWidth: 0 },
          { type: 'bar', label: '報廢件數', data: trend.map(t => t.scrap), backgroundColor: COLORS.critical + 'cc', borderRadius: 6, borderWidth: 0 },
        ],
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { position: 'top', labels: { color: COLORS.text2 } },
          zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } },
        },
        scales: {
          x: { ticks: { color: COLORS.text3 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } },
        },
      },
    });

    // Chart 2: fault rate
    state.charts.trendRate = new Chart($('trendRateChart').getContext('2d'), {
      data: {
        labels,
        datasets: [
          {
            type: 'line', label: '故障率 (%)',
            data: trend.map(t => t.faultPct),
            borderColor: COLORS.warn, backgroundColor: COLORS.warn + '30',
            fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: COLORS.warn, borderWidth: 2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { position: 'top', labels: { color: COLORS.text2 } },
          zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } },
        },
        scales: {
          x: { ticks: { color: COLORS.text3 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: COLORS.text3, callback: v => v + '%' }, grid: { color: COLORS.border } },
        },
      },
    });

    // Chart 3: top parts trend
    // Get top 6 parts from all months combined
    const allRecs = RepairAnalyzer.getRecords(state.db, filterForTrend);
    const topParts = RepairAnalyzer.partPareto(allRecs).slice(0, 6);
    const datasets = topParts.map((p, i) => {
      const trend = RepairAnalyzer.partTrend(state.db, p.name, filterForTrend);
      return {
        label: p.name.length > 24 ? p.name.substring(0, 24) + '…' : p.name,
        data: trend.map(t => t.count),
        borderColor: PALETTE[i],
        backgroundColor: PALETTE[i] + '20',
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: PALETTE[i],
        borderWidth: 2,
        fill: false,
      };
    });
    state.charts.partTrend = new Chart($('partTrendChart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: COLORS.text2, boxWidth: 12, font: { size: 11 } } },
          zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } },
        },
        scales: {
          x: { ticks: { color: COLORS.text3 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } },
        },
      },
    });

    // MoM (Month-over-Month) summary table
    const momEl = $('trendMomTable');
    if (momEl && trend.length >= 2) {
      const rows = trend.map((t, i) => {
        if (i === 0) return null;
        const prev = trend[i - 1];
        const cntDelta = t.count - prev.count;
        const rateDelta = (t.faultPct - prev.faultPct).toFixed(2);
        const scrapDelta = t.scrap - prev.scrap;
        const cntCls = cntDelta > 0 ? 'mom-up' : cntDelta < 0 ? 'mom-dn' : '';
        const rateCls = parseFloat(rateDelta) > 0 ? 'mom-up' : parseFloat(rateDelta) < 0 ? 'mom-dn' : '';
        const scrapCls = scrapDelta > 0 ? 'mom-up' : scrapDelta < 0 ? 'mom-dn' : '';
        const fmt_delta = (n, unit='') => n === 0 ? `<span class="muted">—</span>` : `<span class="${n > 0 ? 'mom-up' : 'mom-dn'}">${n > 0 ? '▲' : '▼'}${Math.abs(n)}${unit}</span>`;
        return `<tr>
          <td>${fmt.monthLabel(t.month)}</td>
          <td class="right">${t.count}</td>
          <td class="right">${fmt_delta(cntDelta)}</td>
          <td class="right">${t.faultPct.toFixed(2)}%</td>
          <td class="right">${fmt_delta(parseFloat(rateDelta), '%')}</td>
          <td class="right">${t.scrap}</td>
          <td class="right">${fmt_delta(scrapDelta)}</td>
        </tr>`;
      }).filter(Boolean).reverse().join('');
      momEl.innerHTML = `
        <div class="card">
          <div class="card-h"><div class="card-t">月環比變化（最新月份在前）</div></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr>
              <th>月份</th><th class="right">維修件數</th><th class="right">環比</th>
              <th class="right">故障率</th><th class="right">環比</th>
              <th class="right">報廢件數</th><th class="right">環比</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>`;
    } else if (momEl) {
      momEl.innerHTML = '';
    }
  }

  // ─────────────── Reason ───────────────
  function renderReason() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const { reasons, contents } = RepairAnalyzer.reasonBreakdown(records);
    $('reasonMeta').textContent = `${records.length.toLocaleString()} 筆 · ${reasons.length} 種大類 · ${contents.length} 種內容`;

    const top10c = contents.slice(0, 10);

    state.charts.reason = new Chart($('reasonChart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: reasons.map(r => r.name),
        datasets: [{
          data: reasons.map(r => r.count),
          backgroundColor: reasons.map((_, i) => PALETTE[i]),
          borderColor: COLORS.bg,
          borderWidth: 2,
        }],
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        cutout: '60%',
        plugins: { legend: { position: 'right', labels: { color: COLORS.text2, font: { size: 12 }, padding: 10 } } },
      },
    });

    state.charts.content = new Chart($('contentChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: top10c.map(c => c.name),
        datasets: [{
          label: '件數',
          data: top10c.map(c => c.count),
          backgroundColor: COLORS.warn + 'cc',
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false, responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } },
          y: { ticks: { color: COLORS.text2, font: { size: 11 } }, grid: { display: false } },
        },
      },
    });

    // Fault taxonomy MoM comparison
    const taxonomy = RepairAnalyzer.FAULT_TAXONOMY;
    const taxKeys = Object.keys(taxonomy);

    const curCounts = {};
    for (const r of records) {
      const text = `${r.content || ''} ${r.reason || ''}`;
      const cat = RepairAnalyzer.classifyFault(text);
      curCounts[cat] = (curCounts[cat] || 0) + 1;
    }

    const sortedSel = state.selectedMonths.slice().sort();
    const curMk = sortedSel[sortedSel.length - 1];
    const prevMk = sortedSel.length > 1 ? sortedSel[sortedSel.length - 2] : null;

    let prevCounts = {};
    if (prevMk) {
      const pf = currentFilter();
      const prevRecs = RepairAnalyzer.getRecords(state.db, { ...pf, months: [prevMk] });
      for (const r of prevRecs) {
        const text = `${r.content || ''} ${r.reason || ''}`;
        const cat = RepairAnalyzer.classifyFault(text);
        prevCounts[cat] = (prevCounts[cat] || 0) + 1;
      }
    }

    const taxAllKeys = [...taxKeys, '其他/未分類'].filter(k => curCounts[k] || prevCounts[k]);
    const reasonTaxSection = $('reasonTaxSection');
    if (reasonTaxSection && taxAllKeys.length) {
      const ctx = $('reasonTaxChart');
      if (ctx) {
        const datasets = [
          { label: fmt.monthLabel(curMk) || '本期', data: taxAllKeys.map(k => curCounts[k] || 0),
            backgroundColor: taxAllKeys.map(k => (taxonomy[k]?.color || '#94a2b6') + 'cc'), borderRadius:4 },
        ];
        if (prevMk) {
          datasets.push({
            label: fmt.monthLabel(prevMk) + '（前期）',
            data: taxAllKeys.map(k => prevCounts[k] || 0),
            backgroundColor: taxAllKeys.map(k => (taxonomy[k]?.color || '#94a2b6') + '55'), borderRadius:4,
          });
        }
        state.charts.reasonTax = new Chart(ctx, {
          type:'bar',
          data: { labels: taxAllKeys.map(k => k.replace('/','/ ')), datasets },
          options: {
            maintainAspectRatio:false, responsive:true,
            plugins:{ legend:{ position:'top', labels:{ color:COLORS.text2, font:{size:11} } } },
            scales:{
              x:{ ticks:{ color:COLORS.text3 }, grid:{ display:false } },
              y:{ beginAtZero:true, ticks:{ color:COLORS.text3 }, grid:{ color:COLORS.border } },
            },
          },
        });
      }
    }
  }

  // ─────────────── Scrap + Repeated ───────────────
  function renderScrap() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const scrap = RepairAnalyzer.scrapList(records);
    const repeats = RepairAnalyzer.repeatedSerials(records);
    const crossMonth = RepairAnalyzer.crossMonthSerials(state.db, { category: f.category, model: f.model });
    const totalScrap = scrap.reduce((s, m) => s + m.count, 0);
    $('scrapMeta').textContent = `報廢 ${totalScrap} 件 · 跨月重修 ${crossMonth.length} 台 · 本期重修 ${repeats.length} 台`;

    // CROSS-MONTH section (full-width, top priority)
    $('crossMonthSection').innerHTML = crossMonth.length === 0
      ? `<div class="empty"><div class="empty-ico">✓</div><div class="empty-t">尚未發現同序號跨月份維修紀錄</div></div>`
      : crossMonth.slice(0, 50).map(r => {
          const severity = r.monthCount >= 3 ? 'critical' : 'warn';
          const sevColor = severity === 'critical' ? 'var(--critical)' : 'var(--warn)';
          const monthsBadges = r.monthsSpan.map(m => `<span class="tag" style="background:${sevColor === 'var(--critical)' ? 'var(--critical-soft)' : 'var(--warn-soft)'};color:${sevColor};border-color:transparent;font-weight:700">${fmt.monthLabel(m)}</span>`).join('');
          // Aggregate parts
          const allParts = r.visits.flatMap(v => v.parts);
          const partCounts = {};
          allParts.forEach(p => partCounts[p] = (partCounts[p] || 0) + 1);
          const topParts = Object.entries(partCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
          // Visit timeline
          const visits = r.visits.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
          return `
            <div class="card" style="margin-bottom:10px;padding:18px 20px;border-left:3px solid ${sevColor}">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--text)">${r.model} <span style="color:var(--text3)">#${r.serial}</span></span>
                  <span class="tag cat" style="--c:${CAT_COLOR[r.category] || COLORS.text3}">${r.category}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${monthsBadges}
                  <span style="font-family:var(--mono);font-size:18px;font-weight:700;color:${sevColor}">${r.visitCount}<span style="font-size:11px;color:var(--text3);margin-left:3px">次</span></span>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text2);font-family:var(--mono);margin-bottom:10px">
                ${visits.map(v => `
                  <div style="display:flex;gap:10px;align-items:center">
                    <span style="color:var(--text3);min-width:90px">${v.date || '—'}</span>
                    <span style="color:${v.isScrap ? 'var(--critical)' : 'var(--text2)'}">${escapeHtml(v.content || v.reason || '—')}</span>
                    ${v.parts.length ? `<span style="color:var(--text3)">→ ${v.parts.slice(0, 2).join(', ')}</span>` : ''}
                  </div>
                `).join('')}
              </div>
              ${topParts.length > 0 ? `
                <div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border)">
                  <span style="font-size:11px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;font-weight:600;margin-right:4px;padding-top:3px">常更換</span>
                  ${topParts.map(([p, c]) => `<span class="tag">${escapeHtml(p)} <span class="muted">×${c}</span></span>`).join('')}
                </div>` : ''}
            </div>
          `;
        }).join('');

    $('scrapList').innerHTML = scrap.length === 0
      ? `<div class="empty"><div class="empty-t">無報廢紀錄</div></div>`
      : scrap.map(s => `
          <div class="card" style="margin-bottom:10px;padding:16px 18px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:baseline;gap:8px">
                <span style="font-family:var(--mono);font-size:15px;font-weight:700">${s.model}</span>
                <span class="tag cat" style="--c:${CAT_COLOR[s.category] || COLORS.text3}">${s.category}</span>
              </div>
              <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--critical)">${s.count} <span style="font-size:11px;color:var(--text3)">件</span></div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--text2)">
              ${s.topReasons.map(([r, c]) => `<span class="tag">${escapeHtml(r)} <span class="muted">×${c}</span></span>`).join('')}
            </div>
          </div>
      `).join('');

    $('repeatList').innerHTML = repeats.length === 0
      ? `<div class="empty"><div class="empty-t">無重複維修紀錄</div></div>`
      : repeats.slice(0, 30).map(r => `
          <div class="card" style="margin-bottom:10px;padding:16px 18px;border-left:3px solid var(--warn)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div style="font-family:var(--mono);font-size:14px;font-weight:700">${r.model} <span style="color:var(--text3)">#${r.serial}</span></div>
              <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--warn)">${r.count} <span style="font-size:11px;color:var(--text3)">次</span></div>
            </div>
            <div style="font-size:12px;color:var(--text3);font-family:var(--mono);margin-bottom:6px">${r.firstDate} → ${r.lastDate}</div>
            ${r.uniqueParts.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${r.uniqueParts.map(p => `<span class="tag">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
          </div>
      `).join('');
  }

  // ─────────────── Detail table ───────────────
  function searchDetail(q) {
    state.detailSearch = (q || '').trim();
    renderDetail();
  }

  function renderDetail() {
    const f = currentFilter();
    const allRecords = RepairAnalyzer.getRecords(state.db, f);
    const sq = (state.detailSearch || '').toLowerCase();
    const records = sq
      ? allRecords.filter(r =>
          (r.serial || '').toLowerCase().includes(sq) ||
          (r.model || '').toLowerCase().includes(sq) ||
          (r.modelDisplay || '').toLowerCase().includes(sq) ||
          (r.reason || '').toLowerCase().includes(sq) ||
          (r.content || '').toLowerCase().includes(sq) ||
          (r.part1 || '').toLowerCase().includes(sq) ||
          (r.part2 || '').toLowerCase().includes(sq) ||
          (r.part3 || '').toLowerCase().includes(sq))
      : allRecords;
    $('detailMeta').textContent = sq
      ? `搜尋「${sq}」：${records.length} 筆 / 共 ${allRecords.length.toLocaleString()} 筆`
      : `${allRecords.length.toLocaleString()} 筆`;
    const rows = records.slice(0, 500);
    $('detailBody').innerHTML = rows.map(r => `
      <tr>
        <td class="num muted">${fmt.monthLabel(r._monthKey)}</td>
        <td class="num muted">${r.date || '—'}</td>
        <td><span style="font-family:var(--mono);font-weight:600">${r.model}</span></td>
        <td class="num">${r.serial ? `<span style="cursor:pointer;color:var(--accent)" onclick="App.openSerialTimelineDrawer('${escapeAttr(r.serial)}')">${r.serial}</span>` : '—'}</td>
        <td>${r.isScrap ? `<span style="color:var(--critical);font-weight:600">${escapeHtml(r.reason || '報廢')}</span>` : escapeHtml(r.reason || '—')}</td>
        <td>${escapeHtml(r.content || '—')}</td>
        <td>
          ${[[r.part1, r.qty1], [r.part2, r.qty2], [r.part3, r.qty3]].filter(([p]) => p).map(([p, q]) => `<span class="tag">${pdbLabel(p)} <span class="muted">×${q}</span></span>`).join(' ')}
        </td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="empty">無紀錄</td></tr>`;
    if (records.length > 500) {
      $('detailBody').innerHTML += `<tr><td colspan="7" style="text-align:center;color:var(--text3);font-size:12px;padding:14px">顯示前 500 筆 · 共 ${records.length.toLocaleString()} 筆 · 請使用篩選器縮小範圍</td></tr>`;
    }
  }

  function openSerialTimelineDrawer(serial) {
    if (!serial) return;
    const allMonthKeys = Object.keys(state.db.months).sort();
    const visits = [];
    for (const mk of allMonthKeys) {
      const recs = state.db.months[mk]?.records || [];
      for (const r of recs) {
        if ((r.serial || '') === serial) {
          visits.push({ ...r, _monthKey: mk });
        }
      }
    }
    visits.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
    const severity = visits.length >= 3 ? 'warn' : 'info';
    const scrapVisits = visits.filter(v => v.isScrap);
    const months = [...new Set(visits.map(v => v._monthKey))];
    const firstDate = visits[0]?.date || visits[0]?._monthKey || '—';
    const lastDate = visits[visits.length - 1]?.date || visits[visits.length - 1]?._monthKey || '—';
    const timelineHtml = visits.map(v => {
      const parts = [[v.part1, v.qty1],[v.part2, v.qty2],[v.part3, v.qty3]].filter(([p])=>p);
      const partsHtml = parts.length ? parts.map(([p, q]) => `<span class="tag">${escapeHtml(p)}${q ? ` ×${q}` : ''}</span>`).join(' ') : '';
      const scrapBadge = v.isScrap ? `<span style="font-size:10px;color:var(--critical);padding:1px 6px;border:1px solid var(--critical);border-radius:6px;margin-left:4px;font-weight:700">報廢</span>` : '';
      return `<div class="dd-row" style="border-left:3px solid ${v.isScrap ? 'var(--critical)' : 'var(--accent)'};">
        <div>
          <div style="font-size:12px;color:var(--text3)">${fmt.monthLabel(v._monthKey)} · ${v.date || '—'}</div>
          <div><span style="font-weight:600">${escapeHtml(v.model || '—')}</span>${scrapBadge}</div>
          <div style="font-size:12px;color:var(--text2)">${escapeHtml(v.reason || '—')} ${v.content ? '· ' + escapeHtml(v.content) : ''}</div>
          ${partsHtml ? `<div style="margin-top:4px">${partsHtml}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    const summaryHtml = `<div style="margin-top:14px;padding:10px 12px;background:var(--bg2);border-radius:8px;font-size:12px;color:var(--text2)">
      首次：${escapeHtml(firstDate)} · 最後：${escapeHtml(lastDate)} · 跨月：${months.length} 個月
    </div>`;
    openDrawer({
      severity,
      icon: '⇄',
      overline: '序號追蹤',
      title: `#${escapeHtml(serial)} 維修歷程（${visits.length} 次）`,
      bodyHtml: visits.length ? timelineHtml + summaryHtml : `<div class="empty">無此序號記錄</div>`,
    });
  }

  // ─────────────── Utils ───────────────
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  // ─────────────── Drawer (drill-down) ───────────────
  function isDrawerOpen() {
    const d = $('drawer');
    return !!(d && d.classList.contains('open'));
  }
  // 實際關閉抽屜的 DOM 動作（不碰瀏覽歷史）
  function domCloseDrawer() {
    $('drawerMask').classList.remove('open');
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function openDrawer({ severity = 'info', icon = 'i', overline, title, bodyHtml, variant = '' }) {
    const drawer = $('drawer');
    drawer.classList.remove('model-profile');
    if (variant) drawer.classList.add(variant);
    $('drawerIco').textContent = icon;
    $('drawerIco').className = 'drawer-ico ' + severity;
    $('drawerT').textContent = overline || '';
    $('drawerS').textContent = title || '';
    $('drawerBody').innerHTML = bodyHtml;
    $('drawerMask').classList.add('open');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    $('drawerBody').scrollTop = 0;
  }
  function closeDrawer() {
    domCloseDrawer();
    if (history.state && history.state.__drawer) {
      history.replaceState({ __page: state.currentPage }, '');
    }
  }
  // 手機/瀏覽器返回鍵：
  //  1) 抽屜開著 → 只關抽屜，停在原頁
  //  2) 否則依歷史狀態回到前一個頁面，而不是離開 App
  window.addEventListener('popstate', (e) => {
    if (isDrawerOpen()) { domCloseDrawer(); return; }
    const st = e.state;
    if (st && st.__page && st.__page !== state.currentPage) {
      switchPageDom(st.__page);
    }
  });

  // ── Drawer: KPI ──
  function openKpiDrawer(kind) {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const denom = RepairAnalyzer.getDenominators(state.db, f);
    const ranks = RepairAnalyzer.modelRank(records, denom, state.db, state.selectedMonths);
    const allMonths = Object.keys(state.db.months).sort();

    if (kind === 'total') {
      // Distribution across models
      const sorted = ranks.slice().sort((a, b) => b.count - a.count);
      const max = sorted[0]?.count || 1;
      const totalCount = sorted.reduce((s, r) => s + r.count, 0);

      // Monthly trend for all selected models
      const trend = allMonths.map(mk => {
        const m = state.db.months[mk];
        if (!m) return { month: mk, count: 0 };
        const recs = m.records.filter(r => {
          if (f.category && f.category !== '全部' && r.category !== f.category) return false;
          if (f.model && f.model !== '全部' && r.model !== f.model) return false;
          return true;
        });
        return { month: mk, count: recs.length };
      });

      openDrawer({
        severity: 'info', icon: '∑',
        overline: '總維修件數 · 分布',
        title: `共 ${totalCount.toLocaleString()} 件 · ${sorted.length} 個機種`,
        bodyHtml: `
          ${historyMonthsBlock(trend, '月份分布')}
          <div class="drawer-sec">
            <div class="drawer-sec-t"><span class="strong">各機種維修數</span> <span class="count-tag">${sorted.length} 筆</span></div>
            ${distList(sorted.slice(0, 30).map(r => ({
              name: r.model,
              category: r.category,
              count: r.count,
              denom: r.denom,
              faultRate: r.faultRate,
              barPct: r.count / max * 100,
            })))}
          </div>
        `
      });
    } else if (kind === 'models') {
      // Just list of models
      const sorted = ranks.slice().sort((a, b) => b.count - a.count);
      const max = sorted[0]?.count || 1;
      openDrawer({
        severity: 'info', icon: '#',
        overline: '受檢機種',
        title: `${ranks.length} 個機種出現於本期`,
        bodyHtml: `
          <div class="drawer-sec">
            ${distList(sorted.map(r => ({
              name: r.model, category: r.category, count: r.count,
              denom: r.denom, faultRate: r.faultRate, barPct: r.count / max * 100,
            })))}
          </div>
        `
      });
    } else if (kind === 'scrap') {
      // Scrap by model
      const scrap = RepairAnalyzer.scrapList(records);
      const totalScrap = scrap.reduce((s, m) => s + m.count, 0);
      const max = scrap[0]?.count || 1;
      openDrawer({
        severity: 'critical', icon: '✕',
        overline: '報廢件數 · 分布',
        title: `共 ${totalScrap} 件報廢 · ${scrap.length} 個機種`,
        bodyHtml: `
          <div class="drawer-banner critical">
            報廢 = 該機台無法修復。建議檢視 <strong>常出現的報廢原因</strong> 是否為設計缺陷、料件停產或人為損壞。
          </div>
          <div class="drawer-sec">
            <div class="drawer-sec-t"><span class="strong">各機種報廢數</span></div>
            ${scrap.length === 0 ? '<div class="empty"><div class="empty-t">無報廢紀錄</div></div>' :
              scrap.map(s => `
                <div class="dd-row" style="border-left:3px solid var(--critical)">
                  <div class="dd-row-model">
                    <span class="name">${escapeHtml(s.model)}</span>
                    <span class="tag cat" style="--c:${CAT_COLOR[s.category] || COLORS.text3}">${s.category}</span>
                  </div>
                  <div class="dd-row-bar-wrap">
                    <div class="dd-row-bar"><div style="width:${(s.count / max * 100).toFixed(0)}%;background:var(--critical)"></div></div>
                    <div class="dd-row-bar-label">${s.topReasons.slice(0, 2).map(([r, c]) => `${escapeHtml(r)} ×${c}`).join('  ·  ')}</div>
                  </div>
                  <div class="dd-row-stat">
                    <div class="v" style="color:var(--critical)">${s.count}</div>
                    <div class="p">件</div>
                  </div>
                </div>
              `).join('')}
          </div>
        `
      });
    } else if (kind === 'repeated') {
      const reps = RepairAnalyzer.repeatedSerials(records);
      const crossMonth = RepairAnalyzer.crossMonthSerials(state.db, { category: f.category, model: f.model });
      openDrawer({
        severity: 'warn', icon: '♺',
        overline: '重複維修機台',
        title: `本期 ${reps.length} 台 · 跨月 ${crossMonth.length} 台`,
        bodyHtml: `
          <div class="drawer-banner warn">
            <strong>重複維修</strong> 表示同一序號機台多次回廠。可能為：治標未治本、零件批次不良、客戶使用問題、設計缺陷。建議追查根因，避免重複損耗。
          </div>
          ${crossMonth.length > 0 ? `
            <div class="drawer-sec">
              <div class="drawer-sec-t"><span class="strong">跨月份重修</span> <span class="count-tag">${crossMonth.length} 台 · 高優先</span></div>
              ${crossMonth.slice(0, 20).map(r => repeatedRow(r, true)).join('')}
            </div>` : ''}
          <div class="drawer-sec">
            <div class="drawer-sec-t"><span class="strong">本期重修</span> <span class="count-tag">${reps.length} 台</span></div>
            ${reps.length === 0 ? '<div class="empty"><div class="empty-t">無紀錄</div></div>' :
              reps.slice(0, 30).map(r => `
                <div class="dd-row" style="border-left:3px solid var(--warn);cursor:pointer" onclick="App.openSerialDrawer('${escapeAttr(r.model)}','${escapeAttr(r.serial)}')">
                  <div class="dd-row-model">
                    <span class="name">${escapeHtml(r.model)} <span style="color:var(--text3)">#${escapeHtml(r.serial)}</span></span>
                  </div>
                  <div class="dd-row-bar-wrap">
                    <div class="dd-row-bar-label">${r.uniqueParts.slice(0, 3).map(escapeHtml).join('  ·  ')}</div>
                  </div>
                  <div class="dd-row-stat">
                    <div class="v" style="color:var(--warn)">${r.count}</div>
                    <div class="p">次</div>
                  </div>
                </div>
              `).join('')}
          </div>
        `
      });
    }
  }

  // Distribution list (re-used by drawers)
  function distList(items) {
    return `<div class="dd-list">${items.map(it => {
      const pct = it.faultRate;
      const pCls = pct == null ? '' : pct >= 0.1 ? 'bad' : pct >= 0.05 ? 'warn' : 'good';
      return `
        <div class="dd-row" style="cursor:pointer" onclick="App.openModelDrawer('${escapeAttr(it.name)}')">
          <div class="dd-row-model">
            <span class="name">${escapeHtml(it.name)}</span>
            ${it.category ? `<span class="tag cat" style="--c:${CAT_COLOR[it.category] || COLORS.text3}">${it.category}</span>` : ''}
          </div>
          <div class="dd-row-bar-wrap">
            <div class="dd-row-bar"><div style="width:${Math.max(2, it.barPct).toFixed(0)}%"></div></div>
            <div class="dd-row-bar-label">本期：${it.count} 件 / 整新數 ${it.denom || '—'}</div>
          </div>
          <div class="dd-row-stat">
            <div class="v">${it.count}</div>
            <div class="p ${pCls}">${pct == null ? '—' : (pct * 100).toFixed(1) + '%'}</div>
            ${it.denom ? `<div class="p" style="font-size:10.5px;color:var(--text3);margin-top:1px">／${it.denom} 台</div>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // Repeated serial row (used in drawer)
  function repeatedRow(r, isCrossMonth) {
    const sevColor = isCrossMonth && r.monthCount >= 3 ? 'critical' : 'warn';
    return `
      <div class="dd-row" style="border-left:3px solid var(--${sevColor});cursor:pointer;grid-template-columns:1fr auto" onclick="App.openSerialDrawer('${escapeAttr(r.model)}','${escapeAttr(r.serial)}')">
        <div>
          <div class="dd-row-model" style="margin-bottom:6px">
            <span class="name">${escapeHtml(r.model)} <span style="color:var(--text3)">#${escapeHtml(r.serial)}</span></span>
            ${r.category ? `<span class="tag cat" style="--c:${CAT_COLOR[r.category] || COLORS.text3}">${r.category}</span>` : ''}
          </div>
          <div style="font-family:var(--mono);font-size:11.5px;color:var(--text3)">
            ${r.monthsSpan.map(m => fmt.monthLabel(m)).join(' → ')}
          </div>
        </div>
        <div class="dd-row-stat">
          <div class="v" style="color:var(--${sevColor})">${r.visitCount}</div>
          <div class="p">次</div>
        </div>
      </div>`;
  }

  // History months card grid (re-used)
  function historyMonthsBlock(trend, label) {
    if (!trend || trend.length < 2) return '';
    const sortedMonths = state.selectedMonths.slice().sort();
    const curMonth = sortedMonths[sortedMonths.length - 1];
    return `
      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">${label}</span></div>
        <div class="dh-grid">
          ${trend.map((t, i) => {
            const isCurrent = t.month === curMonth;
            const prev = i > 0 ? trend[i - 1].count : null;
            const delta = prev != null ? t.count - prev : null;
            return `
              <div class="dh-month-card ${isCurrent ? 'current' : ''}">
                <div class="m">${fmt.monthLabel(t.month)}</div>
                <div class="v">${t.count}</div>
                ${t.denom ? `<div class="d">/ ${t.denom}</div>` : ''}
                ${t.faultRate != null ? `<div class="p ${t.faultRate >= 0.1 ? 'bad' : t.faultRate >= 0.05 ? 'warn' : 'good'}">${(t.faultRate * 100).toFixed(1)}%</div>` : ''}
                ${delta != null && delta !== 0 ? `<div class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲ +' : '▼ '}${delta}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ── Drawer: anomaly ──
  function openAnomalyDrawer(idx) {
    const anoms = state.currentAnomalies || [];
    const a = anoms[idx];
    if (!a) return;

    const sevLabel = { critical: '嚴重', warn: '注意', info: '資訊' };

    // Build context section based on drillDown type
    let contextHtml = '';
    if (a.drillDown?.kind === 'part') {
      contextHtml = partDrillContent(a.drillDown.partNorm);
    } else if (a.drillDown?.kind === 'model') {
      contextHtml = modelDrillContent(a.drillDown.model);
    } else if (a.drillDown?.kind === 'serial') {
      contextHtml = serialDrillContent(a.drillDown.model, a.drillDown.serial);
    }

    openDrawer({
      severity: a.severity, icon: a.icon,
      overline: `${a.title} · ${sevLabel[a.severity]}`,
      title: a.subject,
      bodyHtml: `
        <div class="drawer-banner ${a.severity}">
          ${escapeHtml(a.message)}
        </div>
        ${contextHtml}
      `
    });
  }

  // ── Drill content: part ──
  function partDrillContent(partNorm) {
    const f = currentFilter();
    const allMonths = Object.keys(state.db.months).sort();
    const sortedMonths = state.selectedMonths.slice().sort();
    const curMonth = sortedMonths[sortedMonths.length - 1];

    const history = RepairAnalyzer.partHistoryDetailed(state.db, partNorm, { category: f.category, model: f.model });

    // Distribution in current month
    const cur = history.find(h => h.month === curMonth) || { perModel: {}, denoms: {} };
    const dist = Object.entries(cur.perModel).map(([model, count]) => ({
      model, count,
      denom: cur.denoms[model] || 0,
      pct: cur.denoms[model] ? count / cur.denoms[model] : null,
    })).sort((a, b) => b.count - a.count);

    const maxDist = dist[0]?.count || 1;

    // Total across all months
    const totalCount = history.reduce((s, h) => s + h.count, 0);

    return `
      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">本月各機種分布</span> <span class="count-tag">${dist.length} 個機種 · 共 ${cur.count || 0} 件</span></div>
        ${dist.length === 0 ? '<div class="empty"><div class="empty-t">本月無此零件紀錄</div></div>' :
          `<div class="dd-list">${dist.map(d => {
            const cat = RepairParser.getCategory(d.model);
            const pCls = d.pct == null ? '' : d.pct >= 0.05 ? 'bad' : d.pct >= 0.02 ? 'warn' : 'good';
            return `
              <div class="dd-row" style="cursor:pointer" onclick="App.openModelDrawer('${escapeAttr(d.model)}')">
                <div class="dd-row-model">
                  <span class="name">${escapeHtml(d.model)}</span>
                  <span class="tag cat" style="--c:${CAT_COLOR[cat] || COLORS.text3}">${cat}</span>
                </div>
                <div class="dd-row-bar-wrap">
                  <div class="dd-row-bar"><div style="width:${(d.count / maxDist * 100).toFixed(0)}%"></div></div>
                  <div class="dd-row-bar-label">${d.count} 件 / 整新數 ${d.denom || '—'}</div>
                </div>
                <div class="dd-row-stat">
                  <div class="v">${d.count}</div>
                  <div class="p ${pCls}">${d.pct == null ? '—' : (d.pct * 100).toFixed(1) + '%'}</div>
                </div>
              </div>
            `;
          }).join('')}</div>`}
      </div>

      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">歷史月份走勢</span> <span class="count-tag">累計 ${totalCount} 件</span></div>
        <div class="dh-grid">
          ${history.map((h, i) => {
            const isCurrent = h.month === curMonth;
            const prev = i > 0 ? history[i - 1].count : null;
            const delta = prev != null ? h.count - prev : null;
            return `
              <div class="dh-month-card ${isCurrent ? 'current' : ''}">
                <div class="m">${fmt.monthLabel(h.month)}</div>
                <div class="v">${h.count}</div>
                <div class="d">${h.models.length} 機種</div>
                ${delta != null && delta !== 0 ? `<div class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲ +' : '▼ '}${delta}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ── Drill content: model ──
  function modelDrillContent(modelName, focusMonth) {
    const history = RepairAnalyzer.modelHistory(state.db, modelName);
    const modelRecords = RepairAnalyzer.getRecords(state.db, { model: modelName });
    const { reasons, contents } = RepairAnalyzer.reasonBreakdown(modelRecords);
    const recentRecords = modelRecords.slice()
      .sort((a, b) => (b.date || b._monthKey || '').localeCompare(a.date || a._monthKey || ''))
      .slice(0, 12);
    const sortedMonths = state.selectedMonths.slice().sort();
    const isAll = focusMonth === '__all__';
    const curMonth = isAll ? '__all__' : (focusMonth || sortedMonths[sortedMonths.length - 1]);
    const cur = history.find(h => h.month === curMonth) || { count: 0, denom: 0, topParts: [] };

    // Aggregate: total over all months
    const totalCount = history.reduce((s, h) => s + h.count, 0);
    const totalDenom = history.reduce((s, h) => s + (h.denom || 0), 0);
    const totalScrap = history.reduce((s, h) => s + (h.scrap || 0), 0);
    const totalRate = totalDenom ? totalCount / totalDenom : null;

    // Cumulative top parts: 從完整記錄聚合（不能用每月 top-5 相加，會漏掉長尾零件且數字偏低）
    const allTopParts = RepairAnalyzer.aggregateParts(modelRecords);

    // Parts shown depend on focus: single month vs cumulative（單月也用完整記錄，不受 top-5 截斷）
    const shownParts = isAll
      ? allTopParts
      : RepairAnalyzer.aggregateParts(modelRecords.filter(r => r._monthKey === curMonth));
    const partsTitle = isAll ? '累計最常更換零件' : `${fmt.monthLabel(curMonth)} 最常更換零件`;
    const max = shownParts[0]?.count || 1;
    const reasonMax = Math.max(reasons[0]?.count || 0, contents[0]?.count || 0, 1);
    const reasonList = (title, rows) => `
      <div class="model-fault-card">
        <div class="model-fault-title">${title}</div>
        ${rows.length ? `
          <div class="barlist">
            ${rows.slice(0, 6).map(r => `
              <div class="barlist-row model-fault-row">
                <div class="barlist-name">${escapeHtml(r.name)}</div>
                <div class="barlist-track"><div style="width:${(r.count / reasonMax * 100).toFixed(0)}%"></div></div>
                <div class="barlist-n">${r.count}</div>
              </div>`).join('')}
          </div>
        ` : '<div class="empty mini">目前沒有分類資料</div>'}
      </div>`;
    const recordParts = (r) => [r.part1Norm, r.part2Norm, r.part3Norm]
      .filter(Boolean)
      .map(p => `<button class="model-record-part" onclick="event.stopPropagation();App.openPartDrawer('${escapeAttr(p)}')">${escapeHtml(pdbLabel(p))}</button>`)
      .join('');

    // Month navigation tabs (allow switching within drawer)
    const allMonths = Object.keys(state.db.months).sort();
    const curIdx = allMonths.indexOf(curMonth);
    const prevMonth = curIdx > 0 ? allMonths[curIdx - 1] : null;
    const nextMonth = curIdx < allMonths.length - 1 ? allMonths[curIdx + 1] : null;

    const monthNav = allMonths.length >= 2 ? `
      <div class="drawer-month-nav">
        <button class="dmn-arrow" ${prevMonth ? `onclick="App.openModelDrawer('${escapeAttr(modelName)}','${prevMonth}')"` : 'disabled'}>← 上一月</button>
        <div class="dmn-tabs">
          ${allMonths.map(mk => `
            <button class="dmn-tab ${mk === curMonth ? 'active' : ''}" onclick="App.openModelDrawer('${escapeAttr(modelName)}','${mk}')">
              ${fmt.monthLabel(mk)}
            </button>
          `).join('')}
        </div>
        <button class="dmn-arrow" ${nextMonth ? `onclick="App.openModelDrawer('${escapeAttr(modelName)}','${nextMonth}')"` : 'disabled'}>下一月 →</button>
      </div>
    ` : '';

    return `
      ${monthNav}
      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">月份故障率比較</span></div>
        <div class="dh-grid">
          ${history.map((h, i) => {
            const isCurrent = !isAll && h.month === curMonth;
            const prev = i > 0 ? history[i - 1].faultRate : null;
            const delta = prev != null && h.faultRate != null ? (h.faultRate - prev) * 100 : null;
            const pCls = h.faultRate == null ? '' : h.faultRate >= 0.1 ? 'bad' : h.faultRate >= 0.05 ? 'warn' : 'good';
            return `
              <div class="dh-month-card ${isCurrent ? 'current' : ''}" style="cursor:pointer" onclick="App.openModelDrawer('${escapeAttr(modelName)}','${h.month}')">
                <div class="m">${fmt.monthLabel(h.month)}</div>
                <div class="v">${h.count}</div>
                <div class="d">/ ${h.denom || '—'}</div>
                ${h.faultRate != null ? `<div class="p ${pCls}">${(h.faultRate * 100).toFixed(1)}%</div>` : '<div class="p">—</div>'}
                ${delta != null && Math.abs(delta) >= 0.1 ? `<div class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲ +' : '▼ '}${Math.abs(delta).toFixed(1)}%</div>` : ''}
              </div>
            `;
          }).join('')}
          <div class="dh-month-card dh-cumulative ${isAll ? 'current' : ''}" style="cursor:pointer" onclick="App.openModelDrawer('${escapeAttr(modelName)}','__all__')">
            <div class="m" style="${isAll ? '' : 'color:var(--text2)'}">累計</div>
            <div class="v">${totalCount}</div>
            <div class="d">/ ${totalDenom || '—'}</div>
            ${totalRate != null ? `<div class="p ${totalRate >= 0.1 ? 'bad' : totalRate >= 0.05 ? 'warn' : 'good'}">${(totalRate * 100).toFixed(1)}%</div>` : ''}
            <div class="delta" style="background:var(--surface2);color:var(--text3)">報廢 ${totalScrap}</div>
          </div>
        </div>
      </div>

      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">故障原因落點</span> <span class="count-tag">${modelRecords.length} 筆</span></div>
        <div class="model-fault-grid">
          ${reasonList('故障原因', reasons)}
          ${reasonList('故障內容', contents)}
        </div>
      </div>

      ${shownParts.length > 0 ? `
        <div class="drawer-sec">
          <div class="drawer-sec-t"><span class="strong">${partsTitle}</span> <span class="count-tag">${shownParts.length} 種</span></div>
          <div class="barlist">
            ${shownParts.map(p => `
              <div class="barlist-row" style="cursor:pointer" onclick="App.openPartDrawer('${escapeAttr(p.name)}')">
                <div class="barlist-name">${pdbLabel(p.name)}</div>
                <div class="barlist-track"><div style="width:${(p.count / max * 100).toFixed(0)}%"></div></div>
                <div class="barlist-n">${p.count}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">最近維修紀錄</span> <span class="count-tag">${recentRecords.length} / ${modelRecords.length} 筆</span></div>
        <div class="model-record-list">
          ${recentRecords.length ? recentRecords.map(r => `
            <div class="model-record-row" onclick="App.openSerialDrawer('${escapeAttr(r.model)}','${escapeAttr(r.serial || '')}')">
              <div class="model-record-meta">
                <span>${escapeHtml(r.date || fmt.monthLabel(r._monthKey) || '—')}</span>
                ${r.serial ? `<span>#${escapeHtml(r.serial)}</span>` : ''}
                ${r.isScrap ? '<span class="model-record-scrap">報廢</span>' : ''}
              </div>
              <div class="model-record-main">${escapeHtml(r.content || r.reason || '未填故障內容')}</div>
              ${recordParts(r) ? `<div class="model-record-parts">${recordParts(r)}</div>` : ''}
            </div>
          `).join('') : '<div class="empty"><div class="empty-t">目前這個型號在已匯入月份沒有維修紀錄</div></div>'}
          ${modelRecords.length > recentRecords.length ? `<div class="model-record-more">還有 ${modelRecords.length - recentRecords.length} 筆，請用上方月份卡切換查看。</div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Drill content: serial ──
  function serialDrillContent(model, serial) {
    const allRecords = RepairAnalyzer.getRecords(state.db, {});
    const visits = allRecords.filter(r => r.model === model && r.serial === serial)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Group by month
    const byMonth = {};
    for (const v of visits) {
      const mk = v._monthKey;
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(v);
    }
    const monthKeys = Object.keys(byMonth).sort();

    // Common parts
    const partCounts = {};
    for (const v of visits) {
      [v.part1Norm, v.part2Norm, v.part3Norm].forEach(p => {
        if (p) partCounts[p] = (partCounts[p] || 0) + 1;
      });
    }
    const sortedParts = Object.entries(partCounts).sort((a, b) => b[1] - a[1]);

    return `
      <div class="drawer-sec">
        <div class="drawer-sec-t"><span class="strong">維修時間軸</span> <span class="count-tag">${visits.length} 次 · ${monthKeys.length} 個月</span></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${visits.map((v, i) => `
            <div class="dd-row" style="grid-template-columns:120px 1fr auto">
              <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">
                <div style="color:var(--text);font-weight:700">${v.date || '—'}</div>
                <div style="font-size:10.5px;margin-top:2px">${fmt.monthLabel(v._monthKey)}</div>
              </div>
              <div>
                <div style="font-size:13px;color:${v.isScrap ? 'var(--critical)' : 'var(--text)'};font-weight:${v.isScrap ? 700 : 500};margin-bottom:4px">
                  ${escapeHtml(v.content || v.reason || '—')}${v.isScrap ? ' <span style="font-size:10px;color:var(--critical);padding:1px 6px;border:1px solid var(--critical);border-radius:6px;margin-left:4px;font-weight:700">報廢</span>' : ''}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--text3);font-family:var(--mono)">
                  ${[v.part1, v.part2, v.part3].filter(Boolean).map(p => `<span class="tag">${escapeHtml(p)}</span>`).join('')}
                </div>
              </div>
              <div style="font-family:var(--mono);font-size:11px;color:var(--text-mute);align-self:start">#${i + 1}</div>
            </div>
          `).join('')}
        </div>
      </div>

      ${sortedParts.length > 0 ? `
        <div class="drawer-sec">
          <div class="drawer-sec-t"><span class="strong">頻繁更換零件</span> <span class="count-tag">${sortedParts.length} 種</span></div>
          <div class="barlist">
            ${sortedParts.slice(0, 8).map(([p, c]) => `
              <div class="barlist-row" style="cursor:pointer" onclick="App.openPartDrawer('${escapeAttr(p)}')">
                <div class="barlist-name">${pdbLabel(p)}</div>
                <div class="barlist-track"><div style="width:${(c / sortedParts[0][1] * 100).toFixed(0)}%;background:var(--warn)"></div></div>
                <div class="barlist-n">${c}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
    `;
  }

  // ═══════════════ 角色視角下鑽 ═══════════════
  // 同一個實體（機種／零件），不同角色點進去最關心的「下一步」不同。
  // 依當前 state.analysisRole 在抽屜頂端加一塊「XX 視角關注」面板：
  // 給該角色最在意的數字、一句解讀、以及帶往對應分頁/抽屜的行動按鈕。
  const FW_LENS_KWS = ['韌體','異常關機','無回應','當機','重啟','重開','升級','OTA','firmware','update','版本','軟體','APP','閃退','連線異常','連不上','死機','系統異常','無反應'];
  const HW_LENS_KWS = ['焊','虛焊','破裂','變形','短路','斷裂','接觸不良','氧化','腐蝕','電容','電阻','電源','脫落','鬆動','冷焊','假焊','元件'];
  const isWarrantyIn = (r) => (r.warranty || '').includes('保固') || (r.warranty || '').toLowerCase() === 'y' || (r.warrantyType || '').includes('保固');
  const matchKw = (r, kws) => { const t = `${r.content || ''} ${r.reason || ''} ${r.reasonRaw || ''}`; return kws.some(k => t.includes(k)); };

  function rateCls(rate) { return rate == null ? '' : rate >= 0.1 ? 'bad' : rate >= 0.05 ? 'warn' : 'good'; }
  function pctStr(x) { return x == null ? '—' : (x * 100).toFixed(1) + '%'; }
  function lensMoney(n) { return 'NT$ ' + Math.round(n || 0).toLocaleString('en'); }

  function lensPanel(role, { chips = [], insight = '', actions = [] }) {
    const ri = ANALYSIS_ROLES[role] || ANALYSIS_ROLES.all;
    return `
      <div class="lens" style="--lc:${ri.color}">
        <div class="lens-h">
          <span class="lens-ico">${ri.icon}</span>
          <span class="lens-role">${ri.label}視角・最關注</span>
        </div>
        ${chips.length ? `<div class="lens-chips">${chips.map(c => `
          <div class="lens-chip ${c.cls || ''}"><div class="lc-v">${c.value}</div><div class="lc-l">${c.label}</div></div>`).join('')}</div>` : ''}
        ${insight ? `<div class="lens-insight">${insight}</div>` : ''}
        ${actions.length ? `<div class="lens-actions">${actions.map(a => `<button class="lens-btn" onclick="${a.onclick}">${a.label} →</button>`).join('')}</div>` : ''}
      </div>`;
  }

  // 計算某機種的跨角色指標
  function modelMetrics(modelName) {
    const recs = RepairAnalyzer.getRecords(state.db, { model: modelName });
    const allRecs = RepairAnalyzer.getRecords(state.db, {});
    const history = RepairAnalyzer.modelHistory(state.db, modelName);
    const count = recs.length;
    const scrap = recs.filter(r => r.isScrap).length;
    const totalDenom = history.reduce((s, h) => s + (h.denom || 0), 0);
    const rate = totalDenom ? count / totalDenom : null;
    const share = allRecs.length ? count / allRecs.length : 0;
    const withCount = history.filter(h => h.count > 0);
    const last = withCount[withCount.length - 1];
    const prev = withCount[withCount.length - 2];
    const momCount = (last && prev) ? last.count - prev.count : null;
    const momRate = (last && prev && last.faultRate != null && prev.faultRate != null) ? (last.faultRate - prev.faultRate) * 100 : null;
    const topParts = RepairAnalyzer.aggregateParts(recs);
    const serialMap = {};
    for (const r of recs) { if (r.serial) serialMap[r.serial] = (serialMap[r.serial] || 0) + 1; }
    const repeated = Object.entries(serialMap).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
    const warrantyIn = recs.filter(isWarrantyIn).length;
    const fwHits = recs.filter(r => matchKw(r, FW_LENS_KWS)).length;
    const hwHits = recs.filter(r => matchKw(r, HW_LENS_KWS)).length;
    const cfg = loadCostCfg();
    const cost = RepairAnalyzer.costAnalysis(recs, cfg);
    // 故障原因集中度
    const reasonMap = {};
    for (const r of recs) { const k = r.content || r.reason; if (k) reasonMap[k] = (reasonMap[k] || 0) + 1; }
    const topReason = Object.entries(reasonMap).sort((a, b) => b[1] - a[1])[0] || null;
    return { modelName, recs, count, scrap, scrapRate: count ? scrap / count : 0, rate, share, momCount, momRate, topParts, repeated, warrantyIn, fwHits, hwHits, cost, topReason, lastMonth: last ? last.month : null };
  }

  function modelLens(modelName) {
    const role = state.analysisRole || 'all';
    if (role === 'all') return '';
    const M = modelMetrics(modelName);
    if (!M.count) return '';
    const esc = escapeAttr(modelName);
    const momTxt = (d, unit, inv) => d == null ? '持平' : `${d > 0 ? '▲+' : '▼'}${Math.abs(d).toFixed(unit === '%' ? 1 : 0)}${unit}`;
    const momCls = (d, goodWhenDown = true) => d == null || d === 0 ? '' : (d > 0) === goodWhenDown ? 'bad' : 'good';
    const partsAct = M.topParts.length ? [{ label: `查最耗零件「${M.topParts[0].name.slice(0,10)}」`, onclick: `App.openPartDrawer('${escapeAttr(M.topParts[0].name)}')` }] : [];

    let cfg;
    switch (role) {
      case 'ceo': cfg = {
        chips: [
          { label: '佔總維修比重', value: pctStr(M.share), cls: M.share >= 0.15 ? 'bad' : M.share >= 0.08 ? 'warn' : '' },
          { label: '故障率', value: pctStr(M.rate), cls: rateCls(M.rate) },
          { label: '報廢損失估算', value: M.cost.configured ? lensMoney(M.cost.scrapCost) : '未設單價', cls: M.cost.scrapCost > 0 ? 'bad' : '' },
          { label: '月趨勢', value: momTxt(M.momRate, '%'), cls: momCls(M.momRate) },
        ],
        insight: M.share >= 0.1 ? `此機種佔整體維修 ${pctStr(M.share)}，是資源與品牌曝險的重點，建議要求生產/品檢提出改善時程。` : `佔整體維修 ${pctStr(M.share)}，屬一般範圍；持續觀察月趨勢即可。`,
        actions: [{ label: '看品質成本', onclick: `App.switchPage('cost')` }, { label: '看月趨勢', onclick: `App.switchPage('trend')` }],
      }; break;
      case 'finance': cfg = {
        chips: [
          { label: '報廢件數', value: M.scrap, cls: M.scrap > 0 ? 'bad' : '' },
          { label: '報廢成本', value: M.cost.configured ? lensMoney(M.cost.scrapCost) : '未設單價', cls: M.cost.scrapCost > 0 ? 'bad' : '' },
          { label: '工時成本', value: M.cost.configured ? lensMoney(M.cost.laborCost) : '—' },
          { label: 'COPQ 合計', value: M.cost.configured ? lensMoney(M.cost.totalCost) : '—', cls: 'bad' },
        ],
        insight: M.cost.configured ? `此機種品質成本約 ${lensMoney(M.cost.totalCost)}（報廢 ${lensMoney(M.cost.scrapCost)} + 工時 ${lensMoney(M.cost.laborCost)}）。若改善可回收此金額，為 ROI 評估基準。` : `尚未設定單價，無法估算金額。請至成本量化頁填入機種/類別單價。`,
        actions: [{ label: '設定/查看成本', onclick: `App.switchPage('cost')` }],
      }; break;
      case 'procure': cfg = {
        chips: [
          { label: '耗用零件種類', value: M.topParts.length },
          { label: '最高用量零件', value: M.topParts[0] ? M.topParts[0].count + ' 件' : '—', cls: 'warn' },
          { label: '月趨勢', value: momTxt(M.momCount, '件'), cls: momCls(M.momCount) },
        ],
        insight: M.topParts.length ? `備料優先序：${M.topParts.slice(0,3).map(p=>`${p.name}(${p.count})`).join('、')}。若月趨勢上升，建議提高安全庫存。` : '本機種無明顯零件集中。',
        actions: [...partsAct, { label: '看零件 Pareto', onclick: `App.switchPage('parts')` }],
      }; break;
      case 'prod': cfg = {
        chips: [
          { label: '故障率', value: pctStr(M.rate), cls: rateCls(M.rate) },
          { label: '報廢率', value: pctStr(M.scrapRate), cls: M.scrapRate >= 0.3 ? 'bad' : M.scrapRate >= 0.1 ? 'warn' : '' },
          { label: '月趨勢', value: momTxt(M.momRate, '%'), cls: momCls(M.momRate) },
          { label: '主故障', value: M.topReason ? `${M.topReason[0].slice(0,8)} ×${M.topReason[1]}` : '—' },
        ],
        insight: (M.rate != null && M.rate >= 0.05) ? `故障率 ${pctStr(M.rate)} 偏高，建議比對製造批次找出是否集中於特定批號。` : `故障率在可接受範圍；留意報廢率與主故障模式是否上升。`,
        actions: [{ label: '看製造批次', onclick: `App.switchPage('batch')` }, { label: '看品質/SPC', onclick: `App.switchPage('quality')` }],
      }; break;
      case 'qa': cfg = {
        chips: [
          { label: '重複維修台數', value: M.repeated.length, cls: M.repeated.length > 0 ? 'bad' : '' },
          { label: '保固期內', value: M.warrantyIn, cls: M.warrantyIn > 0 ? 'warn' : '' },
          { label: '報廢率', value: pctStr(M.scrapRate), cls: M.scrapRate >= 0.3 ? 'bad' : '' },
        ],
        insight: M.repeated.length > 0 ? `有 ${M.repeated.length} 台重複進廠（最高 #${M.repeated[0][0]} ×${M.repeated[0][1]}），是品質未閉環指標，建議開立 CAPA。` : `無重複維修，品質閉環狀況良好。`,
        actions: [
          ...(M.repeated.length ? [{ label: `查重複序號 #${M.repeated[0][0]}`, onclick: `App.openSerialDrawer('${esc}','${escapeAttr(M.repeated[0][0])}')` }] : []),
          { label: '開立/查 CAPA', onclick: `App.switchPage('capa')` },
        ],
      }; break;
      case 'cs': cfg = {
        chips: [
          { label: '保固曝險', value: M.warrantyIn, cls: M.warrantyIn > 0 ? 'warn' : '' },
          { label: '重複進廠台數', value: M.repeated.length, cls: M.repeated.length > 0 ? 'bad' : '' },
          { label: '報廢件數', value: M.scrap },
        ],
        insight: M.warrantyIn > 0 || M.repeated.length > 0 ? `${M.warrantyIn} 件保固期內、${M.repeated.length} 台重複進廠，屬客訴高風險，建議主動聯繫客戶說明處理進度。` : `客訴風險低。`,
        actions: [{ label: '看維修明細', onclick: `App.switchPage('detail')` }],
      }; break;
      case 'repair': cfg = {
        chips: [
          { label: '維修件數', value: M.count },
          { label: '主力備料', value: M.topParts[0] ? M.topParts[0].name.slice(0,10) : '—', cls: 'warn' },
          { label: '報廢率', value: pctStr(M.scrapRate), cls: M.scrapRate >= 0.3 ? 'bad' : '' },
          { label: '主故障', value: M.topReason ? `×${M.topReason[1]}` : '—' },
        ],
        insight: M.topReason ? `最常見故障：「${M.topReason[0]}」(${M.topReason[1]} 件)。主力備料為 ${M.topParts.slice(0,3).map(p=>p.name).join('、') || '—'}。` : '無集中故障模式。',
        actions: [...partsAct, { label: '看故障原因', onclick: `App.switchPage('reason')` }],
      }; break;
      case 'hw': cfg = {
        chips: [
          { label: '疑似硬體故障', value: M.hwHits, cls: M.hwHits > 0 ? 'warn' : '' },
          { label: '報廢率', value: pctStr(M.scrapRate), cls: M.scrapRate >= 0.3 ? 'bad' : '' },
          { label: '關鍵零件', value: M.topParts[0] ? M.topParts[0].name.slice(0,10) : '—' },
        ],
        insight: M.hwHits > 0 ? `${M.hwHits} 件含硬體關鍵字（焊接/破裂/短路等），若集中於同一零件，為 ECO 設計變更候選。` : `未見明顯硬體缺陷關鍵字。`,
        actions: [...partsAct, { label: '看風險/根因', onclick: `App.switchPage('risk')` }],
      }; break;
      case 'fw': cfg = {
        chips: [
          { label: '疑似韌體故障', value: M.fwHits, cls: M.fwHits > 0 ? 'warn' : '' },
          { label: '佔此機種比', value: M.count ? pctStr(M.fwHits / M.count) : '—' },
          { label: '主故障描述', value: M.topReason ? M.topReason[0].slice(0,10) : '—' },
        ],
        insight: M.fwHits > 0 ? `${M.fwHits} 件含韌體/軟體關鍵字（當機/重啟/連線等），建議比對在役韌體版本是否一致，評估 OTA 修正。` : `未見明顯韌體相關故障。`,
        actions: [{ label: '看故障原因', onclick: `App.switchPage('reason')` }],
      }; break;
      case 'logistics': cfg = {
        chips: [
          { label: '報廢件數', value: M.scrap, cls: M.scrap > 0 ? 'bad' : '' },
          { label: '報廢率', value: pctStr(M.scrapRate), cls: M.scrapRate >= 0.3 ? 'bad' : '' },
          { label: '重工台數', value: M.repeated.length },
          { label: '月趨勢', value: momTxt(M.momCount, '件'), cls: momCls(M.momCount) },
        ],
        insight: `報廢 ${M.scrap} 件直接影響可出貨數；重複進廠 ${M.repeated.length} 台佔用週轉。`,
        actions: [{ label: '看報廢/重修', onclick: `App.switchPage('scrap')` }],
      }; break;
      case 'sales': cfg = {
        chips: [
          { label: '品質燈號', value: M.rate == null ? '—' : M.rate >= 0.1 ? '🔴 紅' : M.rate >= 0.05 ? '🟡 黃' : '🟢 綠', cls: rateCls(M.rate) },
          { label: '故障率', value: pctStr(M.rate), cls: rateCls(M.rate) },
          { label: '月趨勢', value: momTxt(M.momRate, '%'), cls: momCls(M.momRate) },
        ],
        insight: M.rate != null && M.rate < 0.05 ? `品質燈號綠，可作為推廣亮點。` : `故障率偏高，銷售時需留意客戶信心，避免主推。`,
        actions: [{ label: '看月趨勢', onclick: `App.switchPage('trend')` }],
      }; break;
      case 'factory': cfg = {
        chips: [
          { label: '維修件數', value: M.count },
          { label: '佔總維修', value: pctStr(M.share) },
          { label: '重複進廠', value: M.repeated.length, cls: M.repeated.length > 5 ? 'warn' : '' },
          { label: '月趨勢', value: momTxt(M.momCount, '件'), cls: momCls(M.momCount) },
        ],
        insight: `此機種佔總維修 ${pctStr(M.share)}；重複進廠 ${M.repeated.length} 台影響產能週轉，需跨部門協調品檢與維修。`,
        actions: [{ label: '看異常偵測', onclick: `App.switchPage('alerts')` }],
      }; break;
      default: return '';
    }
    return lensPanel(role, cfg);
  }

  // 計算某零件的跨角色指標
  function partMetrics(partNorm) {
    const allRecs = RepairAnalyzer.getRecords(state.db, {});
    const recs = allRecs.filter(r => r.part1Norm === partNorm || r.part2Norm === partNorm || r.part3Norm === partNorm);
    const qty = recs.reduce((s, r) => {
      let q = 0;
      if (r.part1Norm === partNorm) q += (r.qty1 || 0);
      if (r.part2Norm === partNorm) q += (r.qty2 || 0);
      if (r.part3Norm === partNorm) q += (r.qty3 || 0);
      return s + (q || 1);
    }, 0);
    const models = {};
    for (const r of recs) models[r.model] = (models[r.model] || 0) + 1;
    const modelArr = Object.entries(models).map(([m, c]) => ({ model: m, count: c })).sort((a, b) => b.count - a.count);
    const scrapLinked = recs.filter(r => r.isScrap).length;
    // 月趨勢
    const trend = RepairAnalyzer.partTrend(state.db, partNorm, {});
    const withC = trend.filter(t => t.count > 0);
    const last = withC[withC.length - 1], prev = withC[withC.length - 2];
    const momQty = (last && prev) ? last.count - prev.count : null;
    const fwHits = recs.filter(r => matchKw(r, FW_LENS_KWS)).length;
    const hwHits = recs.filter(r => matchKw(r, HW_LENS_KWS)).length;
    return { partNorm, recs, qty, modelArr, scrapLinked, momQty, fwHits, hwHits, models: modelArr.length };
  }

  function partLens(partNorm) {
    const role = state.analysisRole || 'all';
    if (role === 'all') return '';
    const P = partMetrics(partNorm);
    if (!P.recs.length) return '';
    const momTxt = (d) => d == null ? '持平' : `${d > 0 ? '▲+' : '▼'}${Math.abs(d)}件`;
    const momCls = (d) => d == null || d === 0 ? '' : d > 0 ? 'bad' : 'good';
    const topModelAct = P.modelArr.length ? [{ label: `查最大用量機種 ${P.modelArr[0].model}`, onclick: `App.openModelDrawer('${escapeAttr(P.modelArr[0].model)}')` }] : [];

    let cfg;
    switch (role) {
      case 'procure': cfg = {
        chips: [
          { label: '總用量', value: P.qty + ' 件', cls: 'warn' },
          { label: '涉及機種', value: P.models },
          { label: '月趨勢', value: momTxt(P.momQty), cls: momCls(P.momQty) },
        ],
        insight: `此零件用於 ${P.models} 個機種，總用量 ${P.qty} 件${P.momQty > 0 ? `，且較上月增加 ${P.momQty} 件，建議提高安全庫存與供應商備貨` : '。'}`,
        actions: [...topModelAct, { label: '看零件 Pareto', onclick: `App.switchPage('parts')` }],
      }; break;
      case 'hw': cfg = {
        chips: [
          { label: '跨機種數', value: P.models, cls: P.models >= 3 ? 'bad' : '' },
          { label: '疑似硬體故障', value: P.hwHits, cls: P.hwHits > 0 ? 'warn' : '' },
          { label: '關聯報廢', value: P.scrapLinked, cls: P.scrapLinked > 0 ? 'bad' : '' },
        ],
        insight: P.models >= 3 ? `此零件橫跨 ${P.models} 個機種出現，若為共用料，可能是系統性元件可靠性/設計問題，建議列入 ECO 評估。` : `集中於少數機種，較可能為個別機種設計或製程問題。`,
        actions: [...topModelAct, { label: '看風險/根因', onclick: `App.switchPage('risk')` }],
      }; break;
      case 'repair': cfg = {
        chips: [
          { label: '使用筆數', value: P.recs.length },
          { label: '涉及機種', value: P.models },
          { label: '關聯報廢', value: P.scrapLinked },
        ],
        insight: `此零件出現在 ${P.recs.length} 筆維修、${P.models} 個機種。點下方看依故障部位分類的詳細記錄。`,
        actions: [{ label: '看故障記錄分類', onclick: `App.openPartFaultDrawer('${escapeAttr(partNorm)}')` }, ...topModelAct],
      }; break;
      case 'finance': cfg = {
        chips: [
          { label: '總用量', value: P.qty + ' 件' },
          { label: '關聯報廢', value: P.scrapLinked, cls: P.scrapLinked > 0 ? 'bad' : '' },
        ],
        insight: `此零件用量 ${P.qty} 件、關聯 ${P.scrapLinked} 件報廢。零件單價 × 用量即為直接物料成本，可於成本頁納入估算。`,
        actions: [{ label: '看品質成本', onclick: `App.switchPage('cost')` }],
      }; break;
      case 'qa': cfg = {
        chips: [
          { label: '涉及機種', value: P.models },
          { label: '關聯報廢', value: P.scrapLinked, cls: P.scrapLinked > 0 ? 'bad' : '' },
          { label: '月趨勢', value: momTxt(P.momQty), cls: momCls(P.momQty) },
        ],
        insight: P.scrapLinked > 0 ? `此零件關聯 ${P.scrapLinked} 件報廢，若用量暴增需確認來料批次品質。` : `關聯報廢低。`,
        actions: [{ label: '看製造批次', onclick: `App.switchPage('batch')` }],
      }; break;
      case 'fw': cfg = {
        chips: [
          { label: '疑似韌體相關', value: P.fwHits, cls: P.fwHits > 0 ? 'warn' : '' },
          { label: '涉及機種', value: P.models },
        ],
        insight: P.fwHits > 0 ? `${P.fwHits} 筆使用此零件的記錄含韌體關鍵字，需確認是否為軟硬體交互問題。` : `此零件與韌體關聯不明顯。`,
        actions: [{ label: '看故障原因', onclick: `App.switchPage('reason')` }],
      }; break;
      default: cfg = {
        chips: [
          { label: '總用量', value: P.qty + ' 件' },
          { label: '涉及機種', value: P.models },
          { label: '月趨勢', value: momTxt(P.momQty), cls: momCls(P.momQty) },
        ],
        insight: `此零件用於 ${P.models} 個機種，總用量 ${P.qty} 件。`,
        actions: [...topModelAct, { label: '看零件 Pareto', onclick: `App.switchPage('parts')` }],
      };
    }
    return lensPanel(role, cfg);
  }

  function openMatrixPartDrawer(partName) {
    // Use no month filter so we see ALL months in DB
    const f = currentFilter();
    const noMonthFilter = { category: f.category, model: f.model };
    const history = RepairAnalyzer.partHistoryDetailed(state.db, partName, noMonthFilter)
      .filter(h => h.count > 0)
      .sort((a, b) => b.month.localeCompare(a.month));

    const totalModels = new Set(history.flatMap(h => Object.keys(h.perModel)));
    const totalCount = history.reduce((s, h) => s + h.count, 0);

    const monthSections = history.map(h => {
      const modelRows = Object.entries(h.perModel)
        .sort((a, b) => b[1] - a[1])
        .map(([m, cnt]) => `
          <div class="dd-row" style="cursor:pointer" onclick="App.openPartModelDrawer('${escapeAttr(partName)}','${escapeAttr(m)}','${h.month}')">
            <div class="dd-row-model">
              <span class="name">${escapeHtml(m)}</span>
              ${(() => { const cat = RepairParser ? RepairParser.getCategory(m) : ''; return cat ? `<span class="tag cat" style="--c:${CAT_COLOR[cat]||COLORS.text3}">${cat}</span>` : ''; })()}
            </div>
            <div class="dd-row-bar-wrap">
              <div class="dd-row-bar"><div style="width:${Math.max(4, Math.round(cnt / (Object.values(h.perModel)[0] || 1) * 100))}%"></div></div>
              <div class="dd-row-bar-label">整新數 ${h.denoms[m] || '—'}</div>
            </div>
            <div class="dd-row-stat">
              <div class="v">${cnt}</div>
              <div class="p">${h.denoms[m] ? ((cnt / h.denoms[m]) * 100).toFixed(1) + '%' : '—'}</div>
            </div>
          </div>`).join('');
      return `
        <div class="drawer-sec">
          <div class="drawer-sec-t">
            <span class="strong">${fmt.monthLabel(h.month)}</span>
            <span class="count-tag">${Object.keys(h.perModel).length} 機種 · ${h.count} 件</span>
          </div>
          ${modelRows}
        </div>`;
    }).join('');

    openDrawer({
      severity: 'info', icon: '⊞',
      overline: '跨機種矩陣 · 零件分析',
      title: partName,
      bodyHtml: `
        <div class="drawer-banner info">
          跨 <strong>${totalModels.size}</strong> 機種 · 歷史共 <strong>${totalCount}</strong> 件 · 點擊機種可查明細
        </div>
        ${monthSections || '<div class="empty"><div class="empty-t">無記錄</div></div>'}
      `
    });
  }

  function openPartModelDrawer(partName, model, fixedMonth) {
    const f = currentFilter();
    // Get records from all months in DB (matrix is not month-filtered)
    const allMonthRecords = [];
    for (const [mk, mdata] of Object.entries(state.db.months)) {
      if (!mdata) continue;
      for (const r of mdata.records) {
        if (f.category && f.category !== '全部' && r.category !== f.category) continue;
        allMonthRecords.push({ ...r, month: mk });
      }
    }
    const recs = allMonthRecords.filter(r =>
      (r.part1Norm === partName || r.part2Norm === partName || r.part3Norm === partName ||
       r.part1 === partName || r.part2 === partName || r.part3 === partName) &&
      RepairAnalyzer.normalizeModel(r.model) === RepairAnalyzer.normalizeModel(model) &&
      (!fixedMonth || r.month === fixedMonth)
    );
    const monthLabel = fixedMonth ? fmt.monthLabel(fixedMonth) : '全部月份';
    openDrawer({
      severity: 'info', icon: '⊞',
      overline: `${model} · ${monthLabel}`,
      title: partName,
      bodyHtml: `
        <div class="drawer-banner info">
          <strong>${model}</strong> × <strong>${partName}</strong>　共 <strong>${recs.length}</strong> 件
        </div>
        <div class="drawer-sec">
          <div class="drawer-sec-t"><span class="strong">維修明細</span> <span class="count-tag">${recs.length} 筆</span></div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${recs.length === 0 ? '<div class="empty"><div class="empty-t">無記錄</div></div>' :
              recs.slice(0, 30).map(r => `
              <div style="padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px;cursor:pointer" onclick="App.openSerialDrawer('${escapeAttr(r.model)}','${escapeAttr(r.serial || '')}')">
                <div style="display:flex;gap:10px;justify-content:space-between;margin-bottom:3px">
                  <span style="font-family:var(--mono);color:var(--text3)">${r.date || fmt.monthLabel(r.month)} · ${escapeHtml(r.model)}</span>
                  ${r.serial ? `<span style="font-family:var(--mono);color:var(--text3)">#${escapeHtml(r.serial)}</span>` : ''}
                </div>
                <div style="color:${r.isScrap ? 'var(--critical)' : 'var(--text)'}">${escapeHtml(r.content || r.reason || '—')}</div>
              </div>
            `).join('')}
            ${recs.length > 30 ? `<div style="text-align:center;color:var(--text3);font-size:11px;padding:4px">…還有 ${recs.length - 30} 筆</div>` : ''}
          </div>
        </div>
      `
    });
  }

  function openPartDrawer(partNorm) {
    const pdbInfo = pdbInfoOf(partNorm);
    openDrawer({
      severity: 'info', icon: '▤',
      overline: '零件深入分析' + (pdbInfo ? ` · ${pdbInfo.group}` : ''),
      title: (pdbInfo && pdbInfo.name && pdbInfo.name !== partNorm) ? `${pdbInfo.name}（${partNorm}）` : partNorm,
      bodyHtml: partLens(partNorm) + partDrillContent(partNorm),
    });
  }
  function openPartFaultDrawer(partNorm) {
    const f = currentFilter();
    const allRecords = RepairAnalyzer.getRecords(state.db, f);
    const partRecords = allRecords.filter(r =>
      r.part1Norm === partNorm || r.part2Norm === partNorm || r.part3Norm === partNorm
    );
    const byTaxonomy = {};
    for (const r of partRecords) {
      const text = `${r.content || ''} ${r.reason || ''}`;
      const cat = RepairAnalyzer.classifyFault(text);
      if (!byTaxonomy[cat]) byTaxonomy[cat] = [];
      byTaxonomy[cat].push(r);
    }
    const sortedCats = Object.entries(byTaxonomy).sort((a,b) => b[1].length - a[1].length);
    openDrawer({
      severity: 'info', icon: '▤',
      overline: '零件故障記錄詳情',
      title: partNorm,
      bodyHtml: `
        <div class="drawer-banner info">
          共 <strong>${partRecords.length}</strong> 筆記錄使用此零件 · 依故障部位分類
        </div>
        ${sortedCats.map(([cat, recs]) => `
          <div class="drawer-sec">
            <div class="drawer-sec-t"><span class="strong">${cat}</span> <span class="count-tag">${recs.length} 筆</span></div>
            <div style="display:flex;flex-direction:column;gap:4px">
              ${recs.slice(0, 15).map(r => `
                <div style="padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px">
                  <div style="display:flex;gap:10px;justify-content:space-between;margin-bottom:3px">
                    <span style="font-family:var(--mono);color:var(--text3)">${r.date || '—'} · ${r.model}</span>
                    ${r.serial ? `<span style="font-family:var(--mono);color:var(--text3)">#${escapeHtml(r.serial)}</span>` : ''}
                  </div>
                  <div style="color:${r.isScrap ? 'var(--critical)' : 'var(--text)'}">${escapeHtml(r.content || r.reason || '—')}</div>
                </div>
              `).join('')}
              ${recs.length > 15 ? `<div style="text-align:center;color:var(--text3);font-size:11px;padding:4px">…還有 ${recs.length - 15} 筆</div>` : ''}
            </div>
          </div>
        `).join('')}
        ${partRecords.length === 0 ? '<div class="empty"><div class="empty-t">無記錄</div></div>' : ''}
      `
    });
  }
  function openModelDrawer(model, focusMonth) {
    const cat = RepairParser.getCategory(model);
    const subtitle = focusMonth ? ` · ${fmt.monthLabel(focusMonth)}` : '';
    openDrawer({
      severity: 'info', icon: '#',
      overline: `只看這個型號 · ${cat}${subtitle}`,
      title: `${model} 型號分析`,
      bodyHtml: modelLens(model) + modelDrillContent(model, focusMonth),
      variant: 'model-profile',
    });
  }
  function openSerialDrawer(model, serial) {
    openDrawer({
      severity: 'warn', icon: '♺',
      overline: '機台維修歷史',
      title: `${model} #${serial}`,
      bodyHtml: serialDrillContent(model, serial),
    });
  }

  // ═══════════════ Quality metrics + SPC ═══════════════
  function renderQuality() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const denom = RepairAnalyzer.getDenominators(state.db, f);
    const q = RepairAnalyzer.qualityMetrics(records, denom, state.db, state.selectedMonths);

    $('qualityMeta').textContent = `基數（整新數）${fmt.int(q.base)} · 維修 ${fmt.int(q.total)}`;

    const dppmClass = q.dppm == null ? '' : q.dppm >= 50000 ? 'k-red' : q.dppm >= 10000 ? 'k-warn' : 'k-info';
    const fpyClass = q.fpy == null ? '' : q.fpy >= 95 ? 'k-info' : q.fpy >= 90 ? 'k-warn' : 'k-red';
    const reworkClass = q.reworkRate >= 10 ? 'k-red' : q.reworkRate >= 5 ? 'k-warn' : 'k-info';

    $('qualityKpi').innerHTML = `
      <div class="kpi ${dppmClass}">
        <div class="kpi-h"><div class="kpi-l">DPPM</div><div class="kpi-ico">‰</div></div>
        <div class="kpi-v">${q.dppm == null ? '—' : fmt.int(q.dppm)}</div>
        <div class="kpi-d"><span class="muted">每百萬基數缺陷數 · 維修觸發</span></div>
      </div>
      <div class="kpi k-red">
        <div class="kpi-h"><div class="kpi-l">報廢 DPPM</div><div class="kpi-ico">✕</div></div>
        <div class="kpi-v">${q.scrapDppm == null ? '—' : fmt.int(q.scrapDppm)}</div>
        <div class="kpi-d"><span class="muted">每百萬基數報廢數</span></div>
      </div>
      <div class="kpi ${fpyClass}">
        <div class="kpi-h"><div class="kpi-l">FPY 直通率</div><div class="kpi-ico">✓</div></div>
        <div class="kpi-v">${q.fpy == null ? '—' : fmt.pct(q.fpy)}</div>
        <div class="kpi-d"><span class="muted">未進維修比例（代理值）</span></div>
      </div>
      <div class="kpi ${reworkClass}">
        <div class="kpi-h"><div class="kpi-l">重工率</div><div class="kpi-ico">♺</div></div>
        <div class="kpi-v">${fmt.pct(q.reworkRate)}</div>
        <div class="kpi-d"><span class="muted">${q.reworkUnits} / ${q.uniqueUnits} 台重複進廠</span></div>
      </div>
    `;

    // SPC chart
    const spc = RepairAnalyzer.spcAnalysis(state.db, { category: f.category, model: f.model });
    const note = $('spcNote');
    if (!spc.ready) {
      note.innerHTML = `<span class="muted">${spc.reason}</span>`;
      if (state.charts.spc) { state.charts.spc.destroy(); state.charts.spc = null; }
      return;
    }
    const spcConfColor = { ready: 'var(--ok)', trial: 'var(--warn)', exploratory: 'var(--critical)' }[spc.confidence];
    note.innerHTML = `<span style="color:${spcConfColor};font-weight:600">【${spc.confidenceLabel}】</span>　`
      + `中心線 CL = <strong>${spc.mean.toFixed(2)}%</strong> · UCL(3σ) = <strong style="color:var(--critical)">${spc.ucl.toFixed(2)}%</strong> · σ = ${spc.sigma.toFixed(2)}`
      + (spc.outCount > 0 ? ` · <strong style="color:var(--critical)">${spc.outCount} 個月超出管制界限 ⚠</strong>` : ` · <span style="color:var(--ok)">製程穩定</span>`);

    const labels = spc.points.map(p => fmt.monthLabel(p.month));
    const data = spc.points.map(p => +p.faultPct.toFixed(2));
    const ptColors = spc.points.map(p => p.status === 'out' ? COLORS.critical : p.status === 'warn' ? COLORS.warn : COLORS.accent);
    const ctx = $('spcChart');
    if (ctx) {
      state.charts.spc = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '故障率%', data, borderColor: COLORS.accent, backgroundColor: 'transparent',
              pointBackgroundColor: ptColors, pointRadius: 6, pointHoverRadius: 8, tension: .2, borderWidth: 2 },
            { label: 'UCL', data: labels.map(() => +spc.ucl.toFixed(2)), borderColor: COLORS.critical,
              borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
            { label: 'CL', data: labels.map(() => +spc.mean.toFixed(2)), borderColor: COLORS.text3,
              borderDash: [3, 3], pointRadius: 0, borderWidth: 1 },
            { label: 'LCL', data: labels.map(() => +spc.lcl.toFixed(2)), borderColor: COLORS.ok,
              borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            // C3: annotation — mark latest month
            annotation: {
              annotations: labels.length ? {
                latestLine: {
                  type: 'line', xMin: labels.length - 1, xMax: labels.length - 1,
                  borderColor: COLORS.accent + '88', borderWidth: 1.5, borderDash: [4, 4],
                  label: { display: true, content: '最新月', position: 'start', color: COLORS.accent, font: { size: 11 } },
                },
                avgLine: {
                  type: 'line', yMin: spc.mean, yMax: spc.mean,
                  borderColor: COLORS.text3 + 'aa', borderWidth: 1, borderDash: [2, 4],
                  label: { display: true, content: `平均 ${spc.mean.toFixed(1)}%`, position: 'end', color: COLORS.text3, font: { size: 10 } },
                },
              } : {},
            },
          },
          scales: { y: { beginAtZero: true, title: { display: true, text: '故障率 %' } } } },
      });
    }

    // B6: Data quality heatmap
    renderDQHeatmap();
  }

  // B6: DQ heatmap — missing data rate per month × field
  function renderDQHeatmap() {
    const dqEl = document.getElementById('dqHeatmap');
    if (!dqEl || !state.db) return;
    const fields = [
      { key: 'date', label: '日期' }, { key: 'model', label: '機種' },
      { key: 'serial', label: '序號' }, { key: 'reason', label: '故障原因' },
      { key: 'content', label: '故障內容' }, { key: 'part', label: '零件記錄' },
    ];
    const monthKeys = Object.keys(state.db.months).sort().slice(-12);
    if (!monthKeys.length) { dqEl.innerHTML = ''; return; }

    const data = monthKeys.map(mk => {
      const m = state.db.months[mk];
      const total = m.records.length;
      if (!total) return { month: mk, rates: {}, total: 0 };
      const rates = {};
      rates.date    = m.records.filter(r => r.date).length / total;
      rates.model   = m.records.filter(r => r.model && r.model !== '未知').length / total;
      rates.serial  = m.records.filter(r => r.serial).length / total;
      rates.reason  = m.records.filter(r => r.reason && r.reason !== '未知').length / total;
      rates.content = m.records.filter(r => r.content).length / total;
      rates.part    = m.records.filter(r => r.parts && r.parts.length > 0).length / total;
      return { month: mk, rates, total };
    });

    const cell = (rate) => {
      const pct = Math.round((rate || 0) * 100);
      const bg = pct >= 95 ? '#22c55e' : pct >= 80 ? '#f59e0b' : pct >= 50 ? '#f97316' : '#ef4444';
      const fg = pct >= 80 ? '#fff' : '#fff';
      return `<td title="${pct}% 填寫率" style="padding:5px 8px;text-align:center;background:${bg}${Math.round((rate||0)*0.7*255).toString(16).padStart(2,'0')};color:${fg};font-family:var(--mono);font-size:12px;border-radius:4px">${pct}%</td>`;
    };

    dqEl.innerHTML = `
      <div class="card-h" style="margin-bottom:10px"><div class="card-t">資料品質熱圖（近 12 個月欄位填寫率）</div></div>
      <div style="overflow-x:auto">
      <table style="border-collapse:separate;border-spacing:4px;width:100%;min-width:420px">
        <thead><tr>
          <th style="padding:4px 8px;text-align:left;font-size:12px;color:var(--text3)">月份</th>
          ${fields.map(f => `<th style="padding:4px 8px;text-align:center;font-size:12px;color:var(--text3)">${f.label}</th>`).join('')}
          <th style="padding:4px 8px;text-align:right;font-size:12px;color:var(--text3)">筆數</th>
        </tr></thead>
        <tbody>
          ${data.map(d => `<tr>
            <td style="padding:5px 8px;font-family:var(--mono);font-size:12px;white-space:nowrap;color:var(--text2)">${fmt.monthLabel(d.month)}</td>
            ${fields.map(f => cell(d.rates[f.key])).join('')}
            <td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--text3)">${d.total}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text3)">
        <span style="background:#22c55e66;padding:2px 6px;border-radius:3px;margin-right:6px">≥95%</span>
        <span style="background:#f59e0b66;padding:2px 6px;border-radius:3px;margin-right:6px">80–94%</span>
        <span style="background:#f9731666;padding:2px 6px;border-radius:3px;margin-right:6px">50–79%</span>
        <span style="background:#ef444466;padding:2px 6px;border-radius:3px">＜50%</span>
      </div>
    `;
  }

  // ═══════════════ Risk: FMEA + root cause + forecast ═══════════════
  function renderRisk() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    $('riskMeta').textContent = `${fmt.int(records.length)} 筆記錄`;

    // Forecast
    const fc = RepairAnalyzer.forecastNextMonth(state.db, { category: f.category, model: f.model });
    if (fc.ready) {
      const dirIco = fc.trendDir === 'up' ? '↗' : fc.trendDir === 'down' ? '↘' : '→';
      const dirColor = fc.trendDir === 'up' ? 'var(--critical)' : fc.trendDir === 'down' ? 'var(--ok)' : 'var(--text2)';
      $('forecastCard').innerHTML = `
        <div class="card-h"><div class="card-t">下月維修量${fc.confidence === 'estimate' ? '短期估算' : '預測'}</div></div>
        ${fc.confidence === 'estimate' ? `<div class="data-notice warn" style="margin-bottom:10px"><span class="dn-ico">⚠</span><div>${escapeHtml(fc.confidenceLabel)}</div></div>` : ''}
        <div class="forecast-row">
          <div class="forecast-main">
            <div class="forecast-v" style="color:${dirColor}">${dirIco} ${fc.forecast}</div>
            <div class="forecast-l">${fc.confidence === 'estimate' ? '估算' : '預估'}件數（線性回歸 + 3月移動平均）</div>
          </div>
          <div class="forecast-detail">
            <div><span class="muted">上月實際</span> <strong>${fc.lastCount}</strong></div>
            <div><span class="muted">趨勢斜率</span> <strong>${fc.slope.toFixed(1)}/月</strong></div>
            <div><span class="muted">預估變化</span> <strong style="color:${dirColor}">${fc.deltaPct >= 0 ? '+' : ''}${fc.deltaPct.toFixed(0)}%</strong></div>
          </div>
        </div>
      `;
      $('forecastCard').style.display = '';
    } else {
      $('forecastCard').style.display = 'none';
    }

    // FMEA
    const fmea = RepairAnalyzer.fmeaAnalysis(records, state.db);
    const fmeaOv = loadFmeaOverrides();
    $('fmeaTable').innerHTML = fmea.length === 0
      ? '<div class="empty"><div class="empty-t">無資料</div></div>'
      : `<div class="tbl-wrap"><table class="tbl fmea-tbl">
          <thead><tr>
            <th>故障部位</th><th class="right">件數</th>
            <th class="right" title="嚴重度 1-10（可點擊編輯）">S ✎</th>
            <th class="right" title="發生度 1-10（可點擊編輯）">O ✎</th>
            <th class="right" title="偵測度 1-10（可點擊編輯）">D ✎</th>
            <th class="right">RPN</th><th>風險等級</th>
          </tr></thead>
          <tbody>
          ${fmea.map(m => {
            const ov = fmeaOv[m.part] || {};
            const s = ov.s ?? m.severity;
            const o = ov.o ?? m.occurrence;
            const d = ov.d ?? m.detection;
            const rpn = s * o * d;
            const hasOverride = ov.s != null || ov.o != null || ov.d != null;
            const level = rpn >= 200 ? 'critical' : rpn >= 100 ? 'high' : rpn >= 50 ? 'medium' : 'low';
            return `
            <tr class="fmea-row" data-part="${escapeAttr(m.part)}">
              <td><span class="fmea-dot" style="background:${m.color}"></span>${m.part}
                <span class="fmea-manual-tag" style="display:${hasOverride?'inline':'none'}">人工調整</span>
              </td>
              <td class="right">${m.count}${m.scrap > 0 ? ` <span class="muted">(${m.scrap}廢)</span>` : ''}</td>
              <td class="right fmea-edit-cell"><input type="number" class="fmea-inp fi-s" min="1" max="10" value="${s}" title="嚴重度（1-10）" onchange="App.saveFmeaOverride('${escapeAttr(m.part)}','s',this.value)"></td>
              <td class="right fmea-edit-cell"><input type="number" class="fmea-inp fi-o" min="1" max="10" value="${o}" title="發生度（1-10）" onchange="App.saveFmeaOverride('${escapeAttr(m.part)}','o',this.value)"></td>
              <td class="right fmea-edit-cell"><input type="number" class="fmea-inp fi-d" min="1" max="10" value="${d}" title="偵測度（1-10）" onchange="App.saveFmeaOverride('${escapeAttr(m.part)}','d',this.value)"></td>
              <td class="right fmea-rpn-cell"><strong>${rpn}</strong></td>
              <td><span class="risk-badge ${level}">${({critical:'極高',high:'高',medium:'中',low:'低'})[level]}</span></td>
            </tr>`;
          }).join('')}
          </tbody></table></div>
          <div class="fmea-legend">S 嚴重度 × O 發生度 × D 偵測度 = RPN 風險優先數 · RPN≥200 極高 · ≥100 高 · ≥50 中 · <button class="btn sm" onclick="App.resetFmeaOverrides()" style="margin-left:8px">重置手動調整</button> <button class="btn sm" onclick="App.exportFmeaUnclassified()" style="margin-left:8px">⤓ 匯出未分類零件</button></div>`;

    // HW: 元件料號頻次 Pareto（硬體研發視角 — 直接統計換件料號）
    const hwPartEl = $('hwPartPareto');
    if (hwPartEl) {
      const pnoMap = {};
      for (const r of records) {
        for (const p of [r.part1, r.part2, r.part3].filter(Boolean)) {
          const key = p.trim().toUpperCase();
          if (!pnoMap[key]) pnoMap[key] = { count:0, scrap:0, models: new Set() };
          pnoMap[key].count++;
          if (r.isScrap) pnoMap[key].scrap++;
          if (r.model) pnoMap[key].models.add(r.model);
        }
      }
      const sorted = Object.entries(pnoMap).sort((a,b)=>b[1].count-a[1].count).slice(0,20);
      if (sorted.length) {
        const maxC = sorted[0][1].count;
        hwPartEl.innerHTML = `
          <div class="section-title">元件料號頻次分析（硬體研發視角）</div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>#</th><th>料號</th><th class="right">使用次數</th><th class="right">報廢次數</th><th class="right">報廢率</th><th>涉及機種</th></tr></thead>
            <tbody>
            ${sorted.map(([pno,d],i)=>{
              const scrapPct = d.count ? (d.scrap/d.count*100).toFixed(0) : 0;
              const scrapCls = d.scrap/Math.max(d.count,1) >= 0.3 ? 'color:var(--critical);font-weight:700' : '';
              return `<tr>
                <td class="num muted">${i+1}</td>
                <td style="font-family:var(--mono);font-weight:600">${escapeHtml(pno)}</td>
                <td class="right">${d.count}
                  <div style="height:4px;background:var(--accent);border-radius:2px;margin-top:3px;width:${(d.count/maxC*100).toFixed(0)}%"></div>
                </td>
                <td class="right" style="${scrapCls}">${d.scrap}</td>
                <td class="right" style="${scrapCls}">${scrapPct}%</td>
                <td style="font-size:11px;color:var(--text2)">${[...d.models].slice(0,3).join(', ')}${d.models.size>3?'…':''}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table></div>`;
      } else {
        hwPartEl.innerHTML = '';
      }
    }

    // Root cause tree
    const tree = RepairAnalyzer.rootCauseTree(records);
    const maxCount = Math.max(...tree.map(t => t.count), 1);
    $('rootCauseTree').innerHTML = tree.length === 0
      ? '<div class="empty"><div class="empty-t">無資料</div></div>'
      : tree.map(t => `
        <div class="rct-node">
          <div class="rct-head">
            <span class="rct-dot" style="background:${t.color}"></span>
            <span class="rct-part">${t.part}</span>
            <span class="rct-bar"><span style="width:${(t.count / maxCount * 100).toFixed(0)}%;background:${t.color}"></span></span>
            <span class="rct-count">${t.count} 件</span>
            ${t.scrap > 0 ? `<span class="rct-scrap">${t.scrap} 報廢 (${t.scrapRate.toFixed(0)}%)</span>` : ''}
          </div>
          <div class="rct-modes">
            ${t.topModes.map(m => `<span class="rct-mode">${escapeHtml(m.mode)} <em>${m.count}</em></span>`).join('')}
          </div>
        </div>`).join('');

    // Data quality coverage panel
    renderDataQualityPanel(records);
  }

  // 把型號稽核結果渲染成 HTML（共用於總覽橫幅與資料品質頁）
  function modelAuditHTML(audit, opts) {
    opts = opts || {};
    const { merged, suspicious } = audit;
    if (!suspicious.length && !merged.length) return '';
    const confLabel = { high: '高度疑似', medium: '可能', low: '低度可能' };
    const confCls   = { high: 'mq-bad', medium: 'mq-warn', low: 'mq-info' };
    let html = '';
    if (suspicious.length) {
      html += `
        <div class="mq-block mq-block-warn">
          <div class="mq-h">⚠ 型號名稱需人工確認（${suspicious.length} 組）</div>
          <div class="mq-note">以下名稱高度相似，系統<b>無法自動判斷</b>是否為同一型號。請填寫人員回原始報表確認並統一寫法——若是同型號請改成一致名稱，若確為不同型號則無需處理。</div>
          <div class="mq-list">
            ${suspicious.map(s => `
              <div class="mq-pair ${confCls[s.confidence]}">
                <div class="mq-pair-keys">
                  <span class="mq-key">${escapeHtml(s.a.key)}</span>
                  <span class="mq-vs">↔</span>
                  <span class="mq-key">${escapeHtml(s.b.key)}</span>
                  <span class="mq-conf">${confLabel[s.confidence]}</span>
                </div>
                <div class="mq-reason">${escapeHtml(s.reason)}</div>
                <div class="mq-meta">
                  <span>${escapeHtml(s.a.key)}：${s.a.count} 件（${s.a.months.map(fmt.monthLabel).join('、') || '僅分母'}）${s.a.known ? '<b class="mq-known">✓生產品名</b>' : '<b class="mq-unknown">⚠不在生產品名</b>'}</span>
                  <span>${escapeHtml(s.b.key)}：${s.b.count} 件（${s.b.months.map(fmt.monthLabel).join('、') || '僅分母'}）${s.b.known ? '<b class="mq-known">✓生產品名</b>' : '<b class="mq-unknown">⚠不在生產品名</b>'}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>`;
    }
    if (merged.length && !opts.warnOnly) {
      html += `
        <div class="mq-block mq-block-ok">
          <div class="mq-h">✓ 已自動合併的型號寫法（${merged.length} 個）</div>
          <div class="mq-note">下列型號的大小寫、連字號/底線/空格差異已視為同一型號自動合併，無需處理。</div>
          <div class="mq-merged">
            ${merged.map(m => `
              <div class="mq-merged-row">
                <span class="mq-key">${escapeHtml(m.key)}</span>
                <span class="mq-arrow">←</span>
                <span class="mq-variants">${m.variants.map(v => `<code>${escapeHtml(v.raw)}</code>`).join(' ')}</span>
              </div>`).join('')}
          </div>
        </div>`;
    }
    return html;
  }

  function renderModelAuditBanner() {
    const el = $('modelAuditBanner');
    if (!el) return;
    if (!state.db || !Object.keys(state.db.months || {}).length) { el.innerHTML = ''; return; }
    const audit = RepairAnalyzer.auditModels(state.db);
    if (!audit.suspicious.length) { el.innerHTML = ''; return; }
    // 總覽只顯示需要處理的警示（不顯示已自動合併的清單）
    el.innerHTML = modelAuditHTML(audit, { warnOnly: true });
  }

  function renderDataQualityPanel(records) {
    const dqEl = $('dataQualityPanel');
    if (!dqEl) return;
    const total = records.length;
    if (total === 0) { dqEl.innerHTML = ''; return; }

    // 型號名稱稽核（完整：警示 + 已合併）
    const audit = RepairAnalyzer.auditModels(state.db);
    const auditHtml = modelAuditHTML(audit, { warnOnly: false });

    const hasOrder = records.filter(r => r.orderMonth).length;
    const hasMfgDate = records.filter(r => r.mfg).length;
    const hasBoth = records.filter(r => r.orderMonth && r.mfg).length;
    const invalidOrder = records.filter(r => r.batch && !r.orderMonth).length;
    const hasPart = records.filter(r => r.part1 || r.part2 || r.part3).length;
    const unclassifiedParts = records.filter(r => {
      const parts = [r.part1, r.part2, r.part3].filter(Boolean);
      return parts.length > 0 && parts.every(p => RepairAnalyzer.classifyFault(p) === '其他/未分類');
    }).length;
    const allMonths = Object.keys(state.db.months).sort();
    const costCfg = loadCostCfg();
    const capaList = loadCapa();
    const copqEnabled = costCfg && (costCfg.scrapDefault > 0 || Object.keys(costCfg.models || {}).length > 0);

    const pct = n => total > 0 ? (n / total * 100).toFixed(1) + '%' : '—';
    const statusCls = (n, warn, bad) => n >= bad ? 'dq-bad' : n >= warn ? 'dq-warn' : 'dq-ok';

    dqEl.innerHTML = `
      ${auditHtml ? `<div class="section-title">型號名稱稽核</div>${auditHtml}` : ''}
      <div class="section-title">資料品質覆蓋率</div>
      <div class="dq-grid">
        <div class="dq-item">
          <div class="dq-label">總記錄筆數</div>
          <div class="dq-val">${total.toLocaleString()}</div>
          <div class="dq-sub">${allMonths.length} 個月</div>
        </div>
        <div class="dq-item ${statusCls(100 - hasOrder/total*100, 30, 70)}">
          <div class="dq-label">製令覆蓋率</div>
          <div class="dq-val">${pct(hasOrder)}</div>
          <div class="dq-sub">${hasOrder} / ${total} 筆具備製令</div>
        </div>
        <div class="dq-item ${statusCls(100 - hasMfgDate/total*100, 30, 70)}">
          <div class="dq-label">製造日期覆蓋率</div>
          <div class="dq-val">${pct(hasMfgDate)}</div>
          <div class="dq-sub">${hasMfgDate} / ${total} 筆具備製造日期（整新日期）</div>
        </div>
        <div class="dq-item ${hasBoth === 0 ? 'dq-bad' : 'dq-ok'}">
          <div class="dq-label">全新/整新判定率</div>
          <div class="dq-val">${pct(hasBoth)}</div>
          <div class="dq-sub">${hasBoth > 0 ? `${hasBoth} 筆可判定` : '⚠ 補齊後自動啟用'}</div>
        </div>
        <div class="dq-item ${invalidOrder > 0 ? 'dq-warn' : 'dq-ok'}">
          <div class="dq-label">無效製令筆數</div>
          <div class="dq-val">${invalidOrder}</div>
          <div class="dq-sub">${invalidOrder > 0 ? '格式不符，無法解析' : '無異常'}</div>
        </div>
        <div class="dq-item ${statusCls(hasPart < total * 0.7 ? 50 : unclassifiedParts/Math.max(hasPart,1)*100, 20, 40)}">
          <div class="dq-label">故障部位未分類率</div>
          <div class="dq-val">${hasPart > 0 ? pct(unclassifiedParts) : '—'}</div>
          <div class="dq-sub">${unclassifiedParts} 筆落入「其他/未分類」</div>
        </div>
        <div class="dq-item ${copqEnabled ? 'dq-ok' : 'dq-bad'}">
          <div class="dq-label">COPQ 成本設定</div>
          <div class="dq-val">${copqEnabled ? '已啟用' : '未設定'}</div>
          <div class="dq-sub">${copqEnabled ? '品質成本計算中' : '點右上角⚙設定單價'}</div>
        </div>
        <div class="dq-item ${capaList.length > 0 ? 'dq-ok' : 'dq-warn'}">
          <div class="dq-label">CAPA 使用狀態</div>
          <div class="dq-val">${capaList.length > 0 ? capaList.length + ' 項' : '尚未建立'}</div>
          <div class="dq-sub">${capaList.filter(c=>c.status!=='closed').length} 項進行中</div>
        </div>
      </div>`;
  }

  // ═══════════════ CAPA store + render ═══════════════
  const CAPA_KEY = 'titan_capa_v1';
  function loadCapa() {
    try { return JSON.parse(localStorage.getItem(CAPA_KEY) || '[]'); } catch { return []; }
  }
  function saveCapa(list) { localStorage.setItem(CAPA_KEY, JSON.stringify(list)); }

  function renderCapa() {
    const list = loadCapa();
    const open = list.filter(c => c.status !== 'closed').length;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = list.filter(c => c.due && c.status !== 'closed' && c.due < today).length;
    const closed = list.filter(c => c.status === 'closed').length;
    const overdueRate = open > 0 ? Math.round(overdue / list.filter(c => c.status !== 'closed').length * 100) : 0;
    $('capaMeta').textContent = `${list.length} 項 · ${open} 進行中 · ${overdue} 逾期`;
    const badge = $('capaBadge');
    if (badge) { if (open > 0) { badge.textContent = open; badge.style.display = ''; } else badge.style.display = 'none'; }

    const capaKpiRow = $('capaKpiRow');
    if (capaKpiRow && list.length > 0) {
      capaKpiRow.innerHTML = `
        <div class="capa-kpi-grid">
          <div class="capa-kpi-item"><div class="capa-kpi-v">${list.length}</div><div class="capa-kpi-l">總計</div></div>
          <div class="capa-kpi-item" style="--cc:var(--warn)"><div class="capa-kpi-v" style="color:var(--warn)">${open}</div><div class="capa-kpi-l">進行中</div></div>
          <div class="capa-kpi-item" style="--cc:var(--critical)"><div class="capa-kpi-v" style="color:${overdue>0?'var(--critical)':'var(--ok)'}">${overdue}</div><div class="capa-kpi-l">逾期 (${overdueRate}%)</div></div>
          <div class="capa-kpi-item" style="--cc:var(--ok)"><div class="capa-kpi-v" style="color:var(--ok)">${closed}</div><div class="capa-kpi-l">已結案</div></div>
        </div>`;
    } else if (capaKpiRow) {
      capaKpiRow.innerHTML = '';
    }

    if (!list.length) {
      $('capaList').innerHTML = `<div class="empty"><div class="empty-ico">✓</div><div class="empty-t">尚無 CAPA 項目</div><div class="empty-d">點右上角「+ 新增 CAPA」建立矯正預防措施</div></div>`;
      return;
    }
    const statusMap = { open: { t: '待處理', c: 'var(--critical)' }, progress: { t: '進行中', c: 'var(--warn)' }, verify: { t: '驗證中', c: 'var(--info)' }, closed: { t: '已結案', c: 'var(--ok)' } };
    $('capaList').innerHTML = `<div class="capa-grid">${list.map((c, i) => {
      const st = statusMap[c.status] || statusMap.open;
      const overdue = c.due && c.status !== 'closed' && c.due < today;
      return `
        <div class="capa-card ${overdue ? 'overdue' : ''}">
          <div class="capa-top">
            <span class="capa-id">#${c.id}</span>
            <span class="capa-status" style="--sc:${st.c}">${st.t}</span>
          </div>
          <div class="capa-title">${escapeHtml(c.problem)}</div>
          <div class="capa-meta">
            <span>👤 ${escapeHtml(c.owner || '—')}</span>
            <span class="${overdue ? 'capa-overdue' : ''}">📅 ${c.due || '—'}${overdue ? ' 逾期' : ''}</span>
          </div>
          ${c.action ? `<div class="capa-action">${escapeHtml(c.action)}</div>` : ''}
          ${c.linkRma ? `<div class="capa-link">🔗 關聯 RMA: ${escapeHtml(c.linkRma)}</div>` : ''}
          <div class="capa-btns">
            <select class="capa-sel" onchange="App.setCapaStatus('${c.id}',this.value)">
              ${Object.entries(statusMap).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${v.t}</option>`).join('')}
            </select>
            <button class="btn danger sm" onclick="App.deleteCapa('${c.id}')">刪除</button>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  function openCapaForm(prefill) {
    // prefill: { problem, action, severity } — 來自 findings 一鍵建立
    const p = prefill || {};
    const defaultDue = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    openDrawer({
      severity: p.severity === 'critical' ? 'critical' : 'warn',
      icon: '✓', overline: 'CAPA', title: '新增矯正預防措施',
      bodyHtml: `
        <div class="cc-grid">
          <div class="cc-row" style="grid-column:1/-1"><label>問題描述 <span style="color:var(--critical)">*</span></label>
            <textarea id="capa_problem" class="ls-input" rows="3" style="resize:vertical">${escapeHtml(p.problem || '')}</textarea></div>
          <div class="cc-row" style="grid-column:1/-1"><label>矯正措施 / 行動計畫</label>
            <textarea id="capa_action" class="ls-input" rows="3" style="resize:vertical">${escapeHtml(p.action || '')}</textarea></div>
          <div class="cc-row"><label>負責人</label><input id="capa_owner" class="ls-input" placeholder="姓名或部門"></div>
          <div class="cc-row"><label>截止日</label><input id="capa_due" type="date" class="ls-input" value="${defaultDue}"></div>
          <div class="cc-row" style="grid-column:1/-1"><label>嚴重度</label>
            <select id="capa_sev" class="ls-input">
              <option value="critical" ${(p.severity==='critical')?'selected':''}>嚴重 — 立即處理</option>
              <option value="warn" ${(!p.severity||p.severity==='warn')?'selected':''}>警示 — 本期內處理</option>
              <option value="info">追蹤 — 持續監控</option>
            </select></div>
          <div class="cc-row" style="grid-column:1/-1"><label>關聯 RMA 單號（選填）</label>
            <input id="capa_rma" class="ls-input" placeholder="例 RMA-20260401-001"></div>
        </div>
        <div style="margin-top:20px;display:flex;gap:10px">
          <button class="btn primary" onclick="App.saveCapaForm()">建立 CAPA</button>
          <button class="btn" onclick="App.closeDrawer()">取消</button>
        </div>`,
    });
  }

  function saveCapaForm() {
    const problem = document.getElementById('capa_problem')?.value?.trim();
    if (!problem) { alert('問題描述為必填'); return; }
    const id = 'C' + Date.now().toString().slice(-6);
    const list = loadCapa();
    list.unshift({
      id,
      problem,
      action: document.getElementById('capa_action')?.value?.trim() || '',
      owner: document.getElementById('capa_owner')?.value?.trim() || '',
      due: document.getElementById('capa_due')?.value || '',
      severity: document.getElementById('capa_sev')?.value || 'warn',
      linkRma: document.getElementById('capa_rma')?.value?.trim() || '',
      status: 'open',
      created: new Date().toISOString(),
    });
    saveCapa(list);
    closeDrawer();
    switchPage('capa');
    updateSummaryBadge();
  }
  function setCapaStatus(id, status) {
    const list = loadCapa();
    const c = list.find(x => x.id === id);
    if (c) { c.status = status; saveCapa(list); renderCapa(); }
  }
  function deleteCapa(id) {
    if (!confirm('確定刪除此 CAPA 項目？')) return;
    saveCapa(loadCapa().filter(x => x.id !== id));
    renderCapa();
  }

  // ═══════════════ Cost analysis + config ═══════════════
  const COST_KEY = 'titan_cost_cfg_v1';
  const FMEA_OVERRIDES_KEY = 'titan_fmea_overrides_v1';
  function loadFmeaOverrides() {
    try { return JSON.parse(localStorage.getItem(FMEA_OVERRIDES_KEY) || '{}'); } catch { return {}; }
  }
  function saveFmeaOverride(part, field, value) {
    const ov = loadFmeaOverrides();
    if (!ov[part]) ov[part] = {};
    const n = Math.min(10, Math.max(1, parseInt(value, 10)));
    if (isNaN(n)) return;
    ov[part][field] = n;
    localStorage.setItem(FMEA_OVERRIDES_KEY, JSON.stringify(ov));
    // Recalculate RPN in the table row
    const row = document.querySelector(`.fmea-row[data-part="${CSS.escape(part)}"]`);
    if (row) {
      const sVal = parseInt(row.querySelector('.fi-s')?.value || 0);
      const oVal = parseInt(row.querySelector('.fi-o')?.value || 0);
      const dVal = parseInt(row.querySelector('.fi-d')?.value || 0);
      const rpn = sVal * oVal * dVal;
      const rpnCell = row.querySelector('.fmea-rpn-cell');
      if (rpnCell) rpnCell.innerHTML = `<strong>${rpn}</strong>`;
      const level = rpn >= 200 ? 'critical' : rpn >= 100 ? 'high' : rpn >= 50 ? 'medium' : 'low';
      const badge = row.querySelector('.risk-badge');
      if (badge) { badge.className = `risk-badge ${level}`; badge.textContent = ({critical:'極高',high:'高',medium:'中',low:'低'})[level]; }
      // Mark as manually adjusted
      const manualTag = row.querySelector('.fmea-manual-tag');
      if (manualTag) manualTag.style.display = 'inline';
    }
  }
  function resetFmeaOverrides() {
    if (!confirm('確定重置所有 FMEA 手動調整？')) return;
    localStorage.removeItem(FMEA_OVERRIDES_KEY);
    if (state.currentPage === 'risk') renderRisk();
  }
  function loadCostCfg() {
    try { return JSON.parse(localStorage.getItem(COST_KEY) || 'null') || { categories: {}, models: {}, laborPerRepair: 0, scrapDefault: 0 }; }
    catch { return { categories: {}, models: {}, laborPerRepair: 0, scrapDefault: 0 }; }
  }
  function saveCostCfg(cfg) { localStorage.setItem(COST_KEY, JSON.stringify(cfg)); }

  function renderCost() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const cfg = loadCostCfg();
    const cost = RepairAnalyzer.costAnalysis(records, cfg);
    $('costMeta').textContent = cost.configured ? `${fmt.int(records.length)} 筆記錄` : '尚未設定單價';

    if (!cost.configured) {
      const scrapN = records.filter(r => r.isScrap).length;
      $('costContent').innerHTML = `
        <div class="onboard-steps">
          <div class="ob-step ob-active"><span class="ob-num">1</span><span>填入概略單價</span></div>
          <div class="ob-step"><span class="ob-num">2</span><span>點「立即估算」</span></div>
          <div class="ob-step"><span class="ob-num">3</span><span>看到本期 COPQ 金額</span></div>
        </div>
        <div class="card sec">
          <div class="card-h"><div class="card-t">⚡ 快速估算模式（5 分鐘上線）</div></div>
          <div class="card-sub" style="margin:4px 0 14px">先填三個概略單價即可立刻看到本期品質成本(COPQ)估算，不需逐類別細設。日後可再用右上角「⚙ 單價設定」精算。</div>
          <div class="cc-grid">
            <div class="cc-row"><label>每台維修成本 (NT$)</label><input type="number" class="ls-input" id="qe_labor" placeholder="例 300"></div>
            <div class="cc-row"><label>每台報廢損失 (NT$)</label><input type="number" class="ls-input" id="qe_scrap" placeholder="例 2500"></div>
            <div class="cc-row"><label>單次物流成本 (NT$，選填)</label><input type="number" class="ls-input" id="qe_logi" placeholder="例 150"></div>
          </div>
          <div style="margin-top:16px"><button class="btn primary" onclick="App.quickEstimateCost()">立即估算並啟用</button>
            <span class="muted" style="font-size:12px;margin-left:10px">本期 ${fmt.int(records.length)} 件維修、${scrapN} 件報廢</span></div>
          <div id="qeResult" style="margin-top:16px"></div>
        </div>
        <div class="empty sm"><div class="empty-d">或點右上角「⚙ 單價設定」做各類別/機種精細單價設定</div></div>`;
      return;
    }

    const fmtMoney = (n) => 'NT$ ' + Math.round(n).toLocaleString('en');

    // Monthly COPQ trend (all months)
    const allMonthKeys = Object.keys(state.db.months).sort();
    const costByMonth = allMonthKeys.map(mk => {
      const recs = RepairAnalyzer.getRecords(state.db, { months: [mk] });
      const c = RepairAnalyzer.costAnalysis(recs, cfg);
      return { month: mk, scrap: c.scrapCost, labor: c.laborCost, total: c.totalCost };
    });
    const hasTrend = costByMonth.length >= 2;

    $('costContent').innerHTML = `
      ${cfg.estimated ? `<div class="data-notice" style="margin-bottom:14px"><span class="dn-ico">⚡</span><div><strong>估算模式</strong>：以單一概略單價推估，僅供量級參考。如需各類別/機種精算，請點右上角「⚙ 單價設定」。</div></div>` : ''}
      <div class="kpi-grid">
        <div class="kpi k-red">
          <div class="kpi-h"><div class="kpi-l">報廢成本${cfg.estimated ? ' (估)' : ''}</div><div class="kpi-ico">✕</div></div>
          <div class="kpi-v" style="font-size:34px">${fmtMoney(cost.scrapCost)}</div>
          <div class="kpi-d"><span class="muted">${cost.scrapCount} 件報廢 · 平均 ${fmtMoney(cost.avgScrapCost)}</span></div>
        </div>
        <div class="kpi k-warn">
          <div class="kpi-h"><div class="kpi-l">維修工時成本</div><div class="kpi-ico">⚙</div></div>
          <div class="kpi-v" style="font-size:34px">${fmtMoney(cost.laborCost)}</div>
          <div class="kpi-d"><span class="muted">${fmt.int(records.length)} 件 × 單件工時</span></div>
        </div>
        <div class="kpi k-blue">
          <div class="kpi-h"><div class="kpi-l">總損失 (COPQ)</div><div class="kpi-ico">∑</div></div>
          <div class="kpi-v" style="font-size:34px">${fmtMoney(cost.totalCost)}</div>
          <div class="kpi-d"><span class="muted">報廢 + 工時</span></div>
        </div>
      </div>
      ${hasTrend ? `
      <div class="card sec">
        <div class="card-h">
          <div class="card-t">COPQ 月度趨勢</div>
          <button class="btn sm" onclick="App.exportCostCsv()" style="margin-left:auto">⤓ 匯出 CSV</button>
        </div>
        <div class="chart-wrap"><canvas id="costTrendChart"></canvas></div>
      </div>` : ''}
      <div class="sec">
        <div class="sec-h">
          <span class="sec-t"><span class="strong">各類別成本分布</span></span>
          ${!hasTrend ? `<button class="btn sm" onclick="App.exportCostCsv()">⤓ 匯出 CSV</button>` : ''}
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>類別</th><th class="right">件數</th><th class="right">報廢數</th><th class="right">報廢成本</th><th class="right">工時成本</th><th class="right">合計</th></tr></thead>
          <tbody>${cost.byCategory.map(c => `
            <tr><td>${c.cat}</td><td class="right">${c.count}</td><td class="right">${c.scrap}</td>
            <td class="right">${fmtMoney(c.scrapCost)}</td><td class="right">${fmtMoney(c.laborCost)}</td>
            <td class="right"><strong>${fmtMoney(c.total)}</strong></td></tr>`).join('')}
          </tbody></table></div>
      </div>`;

    // Initialize cost trend chart after DOM update
    if (hasTrend) {
      const ctx = $('costTrendChart');
      if (ctx) {
        const labels = costByMonth.map(t => fmt.monthLabel(t.month));
        state.charts.costTrend = new Chart(ctx, {
          data: {
            labels,
            datasets: [
              { type:'bar', label:'報廢成本', data: costByMonth.map(t => Math.round(t.scrap)), backgroundColor: COLORS.critical+'cc', borderRadius:4 },
              { type:'bar', label:'工時成本', data: costByMonth.map(t => Math.round(t.labor)), backgroundColor: COLORS.warn+'cc', borderRadius:4 },
              { type:'line', label:'總損失', data: costByMonth.map(t => Math.round(t.total)),
                borderColor: COLORS.ok, backgroundColor:'transparent', tension:.3, pointRadius:4,
                pointBackgroundColor: COLORS.ok, borderWidth:2, yAxisID:'y' },
            ],
          },
          options: {
            maintainAspectRatio:false, responsive:true,
            plugins:{ legend:{ position:'top', labels:{ color:COLORS.text2 } } },
            scales:{
              x:{ stacked:true, ticks:{ color:COLORS.text3 }, grid:{ display:false } },
              y:{ stacked:true, beginAtZero:true, ticks:{ color:COLORS.text3, callback:v=>'NT$'+Math.round(v/1000)+'K' }, grid:{ color:COLORS.border } },
            },
          },
        });
      }
    }
  }

  function openCostConfig() {
    const cfg = loadCostCfg();
    const cats = ['監視器', '傳統保全', '無線保全', '車機系統', 'AED', '門禁', '其他'];
    const body = `
      <div class="cc-sec-t">各類別報廢單價 (NT$)</div>
      <div class="cc-grid">
        ${cats.map(c => `<div class="cc-row"><label>${c}</label><input type="number" class="ls-input" id="cc_${c}" value="${cfg.categories[c] || ''}" placeholder="0"></div>`).join('')}
      </div>
      <div class="cc-sec-t" style="margin-top:16px">通用設定</div>
      <div class="cc-grid">
        <div class="cc-row"><label>每件維修工時成本</label><input type="number" class="ls-input" id="cc_labor" value="${cfg.laborPerRepair || ''}" placeholder="0"></div>
        <div class="cc-row"><label>預設報廢單價（無對應時）</label><input type="number" class="ls-input" id="cc_default" value="${cfg.scrapDefault || ''}" placeholder="0"></div>
      </div>`;
    openDrawer({
      severity: 'info', icon: '$', overline: '成本設定', title: '單價設定',
      bodyHtml: body + `<div style="margin-top:20px"><button class="btn primary" onclick="App.saveCostConfig()">儲存設定</button> <span class="muted" style="font-size:12px;margin-left:8px">儲存後記得「☁ 發布到雲端」讓設定同步</span></div>`,
    });
  }
  function saveCostConfig() {
    const cats = ['監視器', '傳統保全', '無線保全', '車機系統', 'AED', '門禁', '其他'];
    const cfg = loadCostCfg();
    cfg.categories = {};
    for (const c of cats) {
      const v = parseFloat(document.getElementById('cc_' + c)?.value);
      if (!isNaN(v) && v > 0) cfg.categories[c] = v;
    }
    cfg.laborPerRepair = parseFloat(document.getElementById('cc_labor')?.value) || 0;
    cfg.scrapDefault = parseFloat(document.getElementById('cc_default')?.value) || 0;
    saveCostCfg(cfg);
    closeDrawer();
    if (state.currentPage === 'cost') renderCost();
  }

  function quickEstimateCost() {
    const labor = parseFloat(document.getElementById('qe_labor')?.value) || 0;
    const scrap = parseFloat(document.getElementById('qe_scrap')?.value) || 0;
    const logi = parseFloat(document.getElementById('qe_logi')?.value) || 0;
    if (scrap <= 0 && labor <= 0) {
      const r = $('qeResult'); if (r) r.innerHTML = `<div class="empty sm"><div class="empty-d">請至少填入「每台維修成本」或「每台報廢損失」</div></div>`;
      return;
    }
    const cfg = loadCostCfg();
    cfg.categories = {};
    cfg.models = {};
    cfg.laborPerRepair = labor + logi; // 物流併入單件成本，作為估算
    cfg.scrapDefault = scrap;
    cfg.estimated = true;
    saveCostCfg(cfg);
    if (state.currentPage === 'cost') renderCost();
    updateSummaryBadge();
  }

  function exportCostCsv() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const cfg = loadCostCfg();
    const allMonthKeys = Object.keys(state.db.months).sort();
    const rows = [['月份','維修件數','報廢件數','報廢成本(NT$)','工時成本(NT$)','總損失(NT$)']];
    for (const mk of allMonthKeys) {
      const recs = RepairAnalyzer.getRecords(state.db, { months: [mk] });
      const c = RepairAnalyzer.costAnalysis(recs, cfg);
      rows.push([fmt.monthLabel(mk), recs.length, c.scrapCount, Math.round(c.scrapCost), Math.round(c.laborCost), Math.round(c.totalCost)]);
    }
    rows.push([]);
    rows.push(['類別','件數','報廢數','報廢成本','工時成本','合計']);
    const cost = RepairAnalyzer.costAnalysis(records, cfg);
    for (const c of cost.byCategory) {
      rows.push([c.cat, c.count, c.scrap, Math.round(c.scrapCost), Math.round(c.laborCost), Math.round(c.total)]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `COPQ成本摘要_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportDetailCsv() {
    const f = currentFilter();
    const allRecords = RepairAnalyzer.getRecords(state.db, f);
    const sq = (state.detailSearch || '').toLowerCase();
    const records = sq
      ? allRecords.filter(r =>
          (r.serial || '').toLowerCase().includes(sq) ||
          (r.model || '').toLowerCase().includes(sq) ||
          (r.reason || '').toLowerCase().includes(sq) ||
          (r.content || '').toLowerCase().includes(sq) ||
          (r.part1 || '').toLowerCase().includes(sq) ||
          (r.part2 || '').toLowerCase().includes(sq) ||
          (r.part3 || '').toLowerCase().includes(sq))
      : allRecords;
    const rows = [['月份','日期','機種','序號','故障原因','故障內容','是否報廢','製令','製造日期','零件一','數量一','零件二','數量二','零件三','數量三']];
    for (const r of records) {
      rows.push([
        r._monthKey || '', r.date || '', r.modelDisplay || r.model || '', r.serial || '',
        r.reason || '', r.content || '', r.isScrap ? '是' : '否',
        r.batch || '', r.mfg || '',
        r.part1 || '', r.qty1 || '', r.part2 || '', r.qty2 || '', r.part3 || '', r.qty3 || '',
      ]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `維修明細${sq ? '_' + sq : ''}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportFmeaUnclassified() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const unclassified = records.filter(r => {
      const parts = [r.part1, r.part2, r.part3].filter(Boolean);
      return parts.length === 0 || parts.some(p => RepairAnalyzer.classifyFault(p) === '其他/未分類');
    });
    if (unclassified.length === 0) { alert('目前篩選範圍內無「其他/未分類」零件記錄'); return; }
    const rows = [['序號','月份','機種','故障描述1','故障描述2','故障描述3','維修說明']];
    for (const r of unclassified) {
      rows.push([r.serial || '', r._monthKey || '', r.modelDisplay || r.model || '', r.part1 || '', r.part2 || '', r.part3 || '', r.note || '']);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FMEA未分類零件_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────── 料件資料庫 (Parts Master DB) ───────────────
  // 主檔來自 data.json partsMaster（[品號,品名,規格,大類代碼]），
  // 本機編輯存 titan_partsmaster_edits_v1，發布後全員同步。
  const PDB_EDITS_KEY = 'titan_partsmaster_edits_v1';
  let pdbCache = null;       // merged rows
  let pdbGroupCache = null;  // partText(upper) -> group name

  function pdbCatName(code) {
    const m = (window.RepairParser && RepairParser.PART_CATEGORY) || {};
    return m[String(code)] || String(code || '—');
  }
  function pdbLoadEdits() {
    try { return JSON.parse(localStorage.getItem(PDB_EDITS_KEY) || '{"add":[],"mod":{},"del":[]}'); }
    catch(e) { return { add: [], mod: {}, del: [] }; }
  }
  function pdbSaveEdits(ed) { try { localStorage.setItem(PDB_EDITS_KEY, JSON.stringify(ed)); } catch(e) {} }
  function pdbRows() {
    if (pdbCache) return pdbCache;
    let base = [];
    try { base = JSON.parse(localStorage.getItem('titan_partsmaster_v1') || '[]'); } catch(e) {}
    const ed = pdbLoadEdits();
    const del = new Set(ed.del || []);
    const rows = [];
    for (const r of base) {
      const pno = String(r[0]).trim();
      if (del.has(pno)) continue;
      const m = ed.mod && ed.mod[pno];
      rows.push(m ? [pno, m[0], m[1], m[2]] : [pno, r[1], r[2], r[3]]);
    }
    for (const a of (ed.add || [])) rows.push(a);
    pdbCache = rows;
    return rows;
  }
  function pdbInvalidate() { pdbCache = null; pdbGroupCache = null; }

  // 模糊比對：維修記錄的零件文字 → 主檔資訊 {name:品名, group:群組}
  function pdbInfoOf(partText) {
    if (!partText) return null;
    if (!pdbGroupCache) {
      pdbGroupCache = new Map();
      const idx = { spec: new Map(), name: new Map() };
      for (const [pno, name, spec, cat] of pdbRows()) {
        const info = { name, group: pdbCatName(cat) };
        if (spec && spec.length >= 4) idx.spec.set(spec.toUpperCase(), info);
        if (name && name.length >= 3) idx.name.set(name.toUpperCase(), info);
      }
      pdbGroupCache.__idx = idx;
    }
    const key = String(partText).trim().toUpperCase();
    if (pdbGroupCache.has(key)) return pdbGroupCache.get(key);
    const idx = pdbGroupCache.__idx;
    let info = idx.spec.get(key) || idx.name.get(key) || null;
    if (!info) {
      // 規格包含於零件文字（如 "LT-0371-41 LED 3MM..." 內含主檔規格）
      for (const [spec, inf] of idx.spec) {
        if (spec.length >= 6 && (key.includes(spec) || spec.includes(key))) { info = inf; break; }
      }
    }
    pdbGroupCache.set(key, info);
    return info;
  }
  function pdbGroupOf(partText) {
    const info = pdbInfoOf(partText);
    return info ? info.group : null;
  }
  // 報表顯示用：零件名稱旁的類別小標籤
  function pdbTag(partText) {
    const g = pdbGroupOf(partText);
    return g ? `<span class="tag pdb-tag" title="料件群組（料件資料庫）">${escapeHtml(g)}</span>` : '';
  }
  // 報表顯示用：「品名（原文規格）」— 原文是純規格時換成人看得懂的品名
  function pdbLabel(partText) {
    const info = pdbInfoOf(partText);
    const raw = String(partText || '');
    if (!info || !info.name || info.name.trim().toUpperCase() === raw.trim().toUpperCase()) return escapeHtml(raw);
    return `${escapeHtml(info.name)} <span class="pdb-spec">(${escapeHtml(raw)})</span>`;
  }

  let pdbEditingPno = null;  // null=新增, 字串=編輯中品號
  function renderPartsdb() {
    const rows = pdbRows();
    $('partsdbMeta').textContent = `${rows.length.toLocaleString()} 筆料件`;
    // 群組下拉（含全部）
    const cats = [...new Set(rows.map(r => pdbCatName(r[3])))].sort();
    const sel = $('pdbCatSel');
    const cur = sel.value;
    sel.innerHTML = `<option value="">全部群組</option>` + cats.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    if (cur) sel.value = cur;
    const fsel = $('pdbFcat');
    if (fsel && !fsel.options.length) {
      const codes = Object.entries((window.RepairParser && RepairParser.PART_CATEGORY) || {});
      fsel.innerHTML = codes.map(([code, nm]) => `<option value="${code}">${code} · ${escapeHtml(nm)}</option>`).join('');
    }
    pdbSearchRender();
  }
  function pdbSearchRender() {
    const q = ($('pdbSearch').value || '').trim().toUpperCase();
    const cat = $('pdbCatSel').value;
    let rows = pdbRows();
    if (cat) rows = rows.filter(r => pdbCatName(r[3]) === cat);
    if (q) rows = rows.filter(r =>
      String(r[0]).toUpperCase().includes(q) ||
      String(r[1]).toUpperCase().includes(q) ||
      String(r[2]).toUpperCase().includes(q));
    const LIMIT = 300;
    $('pdbBody').innerHTML = rows.slice(0, LIMIT).map(r => `
      <tr>
        <td class="num">${escapeHtml(r[0])}</td>
        <td>${escapeHtml(r[1])}</td>
        <td class="muted">${escapeHtml(r[2])}</td>
        <td><span class="tag">${escapeHtml(pdbCatName(r[3]))}</span></td>
        <td>
          <button class="btn sm" onclick="App.pdbOpenEdit('${escapeAttr(r[0])}')">編輯</button>
          <button class="btn sm danger" onclick="App.pdbDelete('${escapeAttr(r[0])}')">刪</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">找不到符合的料件</td></tr>`;
    $('pdbMore').textContent = rows.length > LIMIT ? `僅顯示前 ${LIMIT} 筆（共 ${rows.length.toLocaleString()} 筆），請用搜尋縮小範圍` : '';
  }
  function pdbOpenEdit(pno) {
    pdbEditingPno = pno || null;
    $('pdbModalTitle').textContent = pno ? '編輯料件' : '新增料件';
    const r = pno ? pdbRows().find(x => x[0] === pno) : null;
    $('pdbFpno').value = r ? r[0] : '';
    $('pdbFpno').disabled = !!pno;
    $('pdbFname').value = r ? r[1] : '';
    $('pdbFspec').value = r ? r[2] : '';
    if (r) $('pdbFcat').value = String(r[3]);
    $('pdbModal').style.display = 'flex';
  }
  function pdbCloseEdit() { $('pdbModal').style.display = 'none'; pdbEditingPno = null; }
  function pdbSaveEdit() {
    const pno = $('pdbFpno').value.trim();
    const name = $('pdbFname').value.trim();
    const spec = $('pdbFspec').value.trim();
    const cat = $('pdbFcat').value;
    if (!pno || !name) { alert('品號與品名為必填'); return; }
    const ed = pdbLoadEdits();
    if (pdbEditingPno) {
      const inAdd = (ed.add || []).find(a => a[0] === pdbEditingPno);
      if (inAdd) { inAdd[1] = name; inAdd[2] = spec; inAdd[3] = cat; }
      else ed.mod[pdbEditingPno] = [name, spec, cat];
    } else {
      if (pdbRows().some(r => r[0] === pno)) { alert('品號已存在'); return; }
      ed.add = ed.add || []; ed.add.push([pno, name, spec, cat]);
      ed.del = (ed.del || []).filter(d => d !== pno);
    }
    pdbSaveEdits(ed); pdbInvalidate(); pdbCloseEdit(); renderPartsdb();
  }
  function pdbDelete(pno) {
    if (!confirm(`確定刪除料件 ${pno}？`)) return;
    const ed = pdbLoadEdits();
    ed.add = (ed.add || []).filter(a => a[0] !== pno);
    delete ed.mod[pno];
    if (!ed.del.includes(pno)) ed.del.push(pno);
    pdbSaveEdits(ed); pdbInvalidate(); renderPartsdb();
  }
  // 取得合併後主檔（發布用）
  function pdbMergedMaster() { return pdbRows(); }
  window.PartsDB = { groupOf: pdbGroupOf, infoOf: pdbInfoOf, tag: pdbTag, label: pdbLabel };

  // ─────────────── Init ───────────────
  // syncCloudPromise 讓登入流程等待雲端資料就緒，避免快速登入時讀到空 DB
  let syncCloudPromise = null;

  async function init() {
    syncCloudPromise = (async () => {
      const cloud = await syncCloud();
      await syncMonthlyWorkbook();
      return cloud;
    })();
    const cloud = await syncCloudPromise;
    state.cloudUsers = (cloud && cloud.users) ? cloud.users : null;
    setupUpload();
    state.db = RepairDB.load();
    renderUploadList();
    // Escape key closes drawer
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('drawer').classList.contains('open')) closeDrawer();
    });
    // Click anywhere in main content area collapses the subbar
    const contentEl = document.querySelector('.content');
    if (contentEl) {
      contentEl.addEventListener('click', e => {
        // Don't collapse if clicking inside the subbar itself
        if (e.target.closest('#subbar')) return;
        collapseSubbar();
        collapseSidebarMini();
      });
    }
    // Boot Auth — shows login screen or restores session.
    // Pass cloud-published users so accounts created on the admin device
    // are recognised on every other device after publish.
    try {
      await Auth.boot(state.cloudUsers);
    } catch(e) {
      console.error('[auth] boot failed:', e);
      await openDashboardDirect();
    }
  }
  document.addEventListener('DOMContentLoaded', init);

  function generateRoleReport() {
    const role = state.analysisRole;
    const roleInfo = ANALYSIS_ROLES[role] || ANALYSIS_ROLES.all;
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const denom = RepairAnalyzer.getDenominators(state.db, f);
    const kpis = RepairAnalyzer.computeKPIs(records, denom);
    const lastMonth = state.selectedMonths.slice().sort().pop();
    const anoms = RepairAnalyzer.detectAnomalies(state.db, lastMonth);
    const items = summaryForRole(role, records, kpis, anoms);
    RepairReport.generate(state.db, { role, roleInfo, items });
  }

  // ─── Auth is wired as window.Auth so it can be called from HTML onclick ───
  // (defined after App IIFE return at bottom of file)

  return {
    handleFiles, removeMonth, clearAll, confirmClear, exportData, importData,
    publishData,
    openDashboard, openDashboardDirect, openUpload, switchPage,
    toggleNav, closeNav,
    pdbSearch: pdbSearchRender, pdbOpenEdit, pdbCloseEdit, pdbSaveEdit, pdbDelete,
    setMonth, setMonthDirect, setCategory, setModel, quickModelSearch, quickModelSearchInput,
    setAnalysisRole,
    openCapaForm, saveCapaForm, setCapaStatus, deleteCapa,
    openCostConfig, saveCostConfig, quickEstimateCost,
    toggleRank, toggleRankRow,
    dismissAlertPulse, dismissCrossMonthPulse,
    generateReport: () => generateRoleReport(),
    generateRoleReport,
    exportReportExcel: () => { if (state.db) RepairReport.exportExcel(state.db); },
    toggleAlertCol,
    toggleRoleDropdown, closeRoleDropdown,
    toggleSubbar, toggleSidebarMini, showHelpModal,
    exportCrossMatrix,
    // Drawer
    openKpiDrawer, openAnomalyDrawer, openPartDrawer, openMatrixPartDrawer, openPartModelDrawer, openModelDrawer, openSerialDrawer, openSerialTimelineDrawer,
    closeDrawer,
    // New functions
    searchDetail,
    openPartFaultDrawer,
    saveFmeaOverride,
    resetFmeaOverrides,
    exportCostCsv,
    exportDetailCsv,
    exportFmeaUnclassified,
    // C4
    setCmpA: (v) => { state.compareMonthA = v; renderComparePanel(); },
    setCmpB: (v) => { state.compareMonthB = v; renderComparePanel(); },
    // Navigation helper for keyboard shortcuts
    navigate: (page) => { state.currentPage = page; renderAll(); },
  };
})();

// ════════════════════════════════════════════════════════════════════
// Auth — 帳號管理、登入、密碼管理
// ════════════════════════════════════════════════════════════════════
window.Auth = (function () {
  const USERS_KEY   = 'titan_users_v1';
  const SESSION_KEY = 'titan_session';
  const ADMIN_ID    = '031780';

  // Local helpers (Auth module is a separate IIFE from App, cannot share scope)
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  async function hashPwd(username, password) {
    const raw = username + ':' + password;
    // crypto.subtle requires secure context (HTTPS/localhost); fallback for file:// or older mobile
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback: deterministic hash for non-secure contexts (file://)
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
    return 'fb_' + (h >>> 0).toString(16).padStart(8, '0');
  }

  // ─── Users storage ───
  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || 'null') || {}; }
    catch { return {}; }
  }
  function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

  // Seed admin on very first run; merge cloud users without clobbering local passwords.
  async function initUsers(cloudUsers) {
    let users = loadUsers();

    // Always ensure all known employees exist locally
    const SEED_USERS = {
      '031780': { hash: '', isAdmin: true,  mustChange: false, name: '陳皇銘' },
      '773999': { hash: '', isAdmin: false, mustChange: false, name: '鄧金汀' },
      '690091': { hash: '', isAdmin: false, mustChange: false, name: '李榮貴' },
      '109004': { hash: '', isAdmin: false, mustChange: false, name: '廖裕淳' },
      '111003': { hash: '', isAdmin: false, mustChange: false, name: '曾慕棠' },
      '114001': { hash: '', isAdmin: false, mustChange: false, name: '楊永富' },
      '114002': { hash: '', isAdmin: false, mustChange: false, name: '葉燕玲' },
      '114004': { hash: '', isAdmin: false, mustChange: false, name: '林以臻' },
      '114005': { hash: '', isAdmin: false, mustChange: false, name: '徐啟芳' },
      '114007': { hash: '', isAdmin: false, mustChange: false, name: '柯智傑' },
      '114008': { hash: '', isAdmin: false, mustChange: false, name: '劉柏增' },
      '114011': { hash: '', isAdmin: false, mustChange: false, name: '徐瑞霞' },
      '114024': { hash: '', isAdmin: false, mustChange: false, name: '蔡宜佑' },
      '115005': { hash: '', isAdmin: false, mustChange: false, name: '劉書銘' },
      '068910': { hash: '', isAdmin: false, mustChange: false, name: '高世璋' },
    };
    for (const [uid, seed] of Object.entries(SEED_USERS)) {
      if (!users[uid]) users[uid] = { ...seed, localChanged: true };
      else if (seed.name && !users[uid].name) users[uid].name = seed.name;
    }

    // Merge cloud users
    if (cloudUsers) {
      for (const [uid, cu] of Object.entries(cloudUsers)) {
        if (!users[uid]) {
          // New user from cloud → add locally
          users[uid] = { ...cu };
        } else if (cu.forceReset && !users[uid].localChanged) {
          // Admin forced a reset and user hasn't changed password locally yet
          users[uid].hash = cu.hash;
          users[uid].mustChange = true;
          delete users[uid].forceReset;
        } else if (cu.forceReset && users[uid].localChanged) {
          // User already changed locally — still honour force reset, overwrite
          users[uid].hash = cu.hash;
          users[uid].mustChange = true;
          users[uid].localChanged = false;
          delete users[uid].forceReset;
        }
        // Copy isAdmin flag from cloud (admin promotion/demotion)
        if (uid !== ADMIN_ID) users[uid].isAdmin = cu.isAdmin || false;
      }
      // Remove users deleted by admin (not present in cloud), except admin itself
      for (const uid of Object.keys(users)) {
        if (uid === ADMIN_ID) continue;
        if (!cloudUsers[uid]) delete users[uid];
      }
    }

    saveUsers(users);
    return users;
  }

  // ─── Session ───
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(username, isAdmin) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username, isAdmin }));
  }
  function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  // ─── Login screen control ───
  function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('changePwScreen').style.display = 'none';
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPwd').value = '';
    document.getElementById('loginErr').textContent = '';
    setTimeout(() => document.getElementById('loginUser').focus(), 100);
  }

  function showChangePw(isForced) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('changePwScreen').style.display = 'flex';
    document.getElementById('changePwSub').textContent = isForced
      ? '首次登入，請設定您的專屬密碼'
      : '請輸入舊密碼與新密碼';
    document.getElementById('cpOld').value = '';
    document.getElementById('cpNew').value = '';
    document.getElementById('cpConfirm').value = '';
    document.getElementById('changePwErr').textContent = '';
    setTimeout(() => document.getElementById('cpOld').focus(), 100);
  }

  function hideAuthScreens() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('changePwScreen').style.display = 'none';
  }

  // Surname avatar: derive a stable hue from the uid, show the first char of the name
  function userAvatarHtml(uid, name) {
    const surname = name ? name.charAt(0) : uid.charAt(0);
    // Deterministic hue from uid string
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) & 0xFFFF;
    const hue = h % 360;
    const bg = `hsl(${hue},55%,52%)`;
    const fullLabel = name ? `${name}（${uid}）` : uid;
    return `<span class="user-avatar" style="background:${bg}" title="${fullLabel}">${surname}</span>`;
  }

  function showMainUI(session) {
    hideAuthScreens();
    const userEl = document.getElementById('modeBarUser');
    if (userEl) {
      const users = loadUsers();
      const name = (users[session.username] && users[session.username].name) || '';
      userEl.innerHTML = userAvatarHtml(session.username, name);
    }
    const adminBtn = document.getElementById('adminPanelBtn');
    if (adminBtn) adminBtn.style.display = session.isAdmin ? '' : 'none';
    // Trigger app restore (defined in index.html inline script)
    try {
      const boot = (typeof onAuthSuccess === 'function') ? onAuthSuccess() : null;
      if (boot && typeof boot.catch === 'function') boot.catch(() => window.App && App.openDashboardDirect && App.openDashboardDirect());
    } catch(e) {
      if (window.App && App.openDashboardDirect) App.openDashboardDirect();
    }
  }

  // ─── Auth actions ───
  // 無密碼模式：只需輸入帳號（工號）即可登入
  async function doLogin() {
    const username = document.getElementById('loginUser').value.trim();
    const errEl = document.getElementById('loginErr');
    errEl.textContent = '';

    if (!username) { errEl.textContent = '請輸入員工編號'; return; }

    // admin 帳號永遠允許
    const isAdmin = (username === ADMIN_ID);

    // 非 admin 帳號：從 users 清單確認是否存在
    if (!isAdmin) {
      const users = loadUsers();
      if (!users[username]) {
        errEl.textContent = '帳號不存在，請聯繫管理員';
        return;
      }
    }

    recordLogin(username);
    setSession(username, isAdmin);
    showMainUI({ username, isAdmin });
  }

  async function doChangePw() {
    const session = getSession();
    if (!session) { showLogin(); return; }

    const oldPwd    = document.getElementById('cpOld').value;
    const newPwd    = document.getElementById('cpNew').value;
    const confirm   = document.getElementById('cpConfirm').value;
    const errEl     = document.getElementById('changePwErr');
    errEl.textContent = '';

    if (!oldPwd || !newPwd || !confirm) { errEl.textContent = '請填寫所有欄位'; return; }
    if (newPwd.length < 6) { errEl.textContent = '新密碼至少 6 個字元'; return; }
    if (newPwd !== confirm) { errEl.textContent = '兩次新密碼不一致'; return; }

    const users = loadUsers();
    const u = users[session.username];
    if (!u) { showLogin(); return; }

    const oldHash = await hashPwd(session.username, oldPwd);
    if (oldHash !== u.hash) { errEl.textContent = '舊密碼錯誤'; return; }

    users[session.username].hash = await hashPwd(session.username, newPwd);
    users[session.username].mustChange = false;
    users[session.username].localChanged = true;
    saveUsers(users);

    showMainUI(session);
  }

  function logout() {
    if (!confirm('確定登出？')) return;
    clearSession();
    showLogin();
    // Hide main UI
    const modeBar = document.getElementById('modeBar');
    if (modeBar) modeBar.style.display = 'none';
    const dash = document.getElementById('dash');
    if (dash) dash.classList.remove('active');
    const rmaDash = document.getElementById('rmaDash');
    if (rmaDash) rmaDash.style.display = 'none';
    const uz = document.getElementById('uploadZone');
    if (uz) uz.style.display = 'none';
  }

  // ─── Admin panel ───
  const LOGIN_LOG_KEY = 'titan_login_log_v1';
  function recordLogin(username) {
    try {
      const users = loadUsers();
      const name = (users[username] && users[username].name) || '';
      const log = JSON.parse(localStorage.getItem(LOGIN_LOG_KEY) || '[]');
      log.push({ uid: username, name, ts: Date.now() });
      // Keep last 500 entries
      if (log.length > 500) log.splice(0, log.length - 500);
      localStorage.setItem(LOGIN_LOG_KEY, JSON.stringify(log));
    } catch (e) { /* ignore */ }
  }
  function getLoginLogs() {
    try { return JSON.parse(localStorage.getItem(LOGIN_LOG_KEY) || '[]'); }
    catch { return []; }
  }
  function clearLoginLogs() {
    if (!confirm('確定清除所有登入記錄？')) return;
    localStorage.removeItem(LOGIN_LOG_KEY);
    renderUserList();
  }

  function openAdminPanel() {
    const session = getSession();
    if (!session || !session.isAdmin) return;
    document.getElementById('adminPanel').style.display = 'flex';
    document.getElementById('newUserInput').value = '';
    document.getElementById('addUserErr').textContent = '';
    renderUserList();
  }

  function closeAdminPanel() {
    document.getElementById('adminPanel').style.display = 'none';
  }

  function renderUserList() {
    const users = loadUsers();
    const logs = getLoginLogs();
    // Build last-login map per uid
    const lastLogin = {};
    const loginCount = {};
    for (const entry of logs) {
      loginCount[entry.uid] = (loginCount[entry.uid] || 0) + 1;
      if (!lastLogin[entry.uid] || entry.ts > lastLogin[entry.uid]) lastLogin[entry.uid] = entry.ts;
    }
    const fmtTime = ts => {
      const d = new Date(ts);
      return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    const el = document.getElementById('userListEl');
    if (!el) return;
    const sorted = Object.entries(users).sort(([a],[b]) => a.localeCompare(b, undefined, { numeric: true }));
    const rows = sorted.map(([uid, u]) => `
      <div class="ap-user-row ${uid === ADMIN_ID ? 'is-admin' : ''}">
        <div class="ap-user-info">
          ${userAvatarHtml(uid, u.name || '')}
          <span class="ap-uid">${uid}</span>
          ${u.name ? `<span class="ap-name">${esc(u.name)}</span>` : ''}
          ${u.isAdmin ? '<span class="ap-tag admin">管理員</span>' : ''}
          ${u.mustChange ? '<span class="ap-tag must-change">待改密</span>' : ''}
          ${lastLogin[uid] ? `<span class="ap-last-login">最後登入 ${fmtTime(lastLogin[uid])} · ${loginCount[uid]}次</span>` : '<span class="ap-last-login muted">未登入</span>'}
        </div>
        <div class="ap-user-actions">
          ${uid !== ADMIN_ID ? `
            <button class="btn" onclick="Auth.resetUserPwd('${uid}')">重置密碼</button>
            <button class="btn danger" onclick="Auth.deleteUser('${uid}')">刪除</button>
          ` : '<span style="color:var(--text3);font-size:12px">主帳號</span>'}
        </div>
      </div>
    `).join('');
    el.innerHTML = rows || '<div style="color:var(--text3);font-size:13px">無帳號資料</div>';

    // Login log section
    const logEl = document.getElementById('loginLogEl');
    if (!logEl) return;
    const recent = [...logs].reverse().slice(0, 60);
    logEl.innerHTML = recent.length === 0
      ? '<div style="color:var(--text3);font-size:13px;padding:8px 0">尚無登入記錄</div>'
      : recent.map(e => `
          <div style="display:flex;gap:10px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span style="font-family:var(--mono);color:var(--text3);flex-shrink:0">${fmtTime(e.ts)}</span>
            <span style="font-family:var(--mono);font-weight:600;color:var(--text);flex-shrink:0">${esc(e.uid)}</span>
            ${e.name ? `<span style="color:var(--text2)">${esc(e.name)}</span>` : ''}
          </div>`).join('');
  }

  async function addUser() {
    const username = document.getElementById('newUserInput').value.trim();
    const name     = (document.getElementById('newNameInput') || {}).value?.trim() || '';
    const errEl    = document.getElementById('addUserErr');
    errEl.textContent = '';
    if (!username) { errEl.textContent = '請輸入員工編號'; return; }
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) { errEl.textContent = '帳號僅限英數字及 - _ .'; return; }
    const users = loadUsers();
    if (users[username]) { errEl.textContent = '帳號已存在'; return; }
    users[username] = {
      hash: await hashPwd(username, username),
      name,
      isAdmin: false,
      mustChange: false,
      localChanged: true,
    };
    saveUsers(users);
    document.getElementById('newUserInput').value = '';
    if (document.getElementById('newNameInput')) document.getElementById('newNameInput').value = '';
    renderUserList();
  }

  async function resetUserPwd(username) {
    if (!confirm(`重置「${username}」的密碼為帳號名稱？對方下次登入需重設密碼。`)) return;
    const users = loadUsers();
    if (!users[username]) return;
    users[username].hash = await hashPwd(username, username);
    users[username].mustChange = true;
    users[username].localChanged = false;
    users[username].forceReset = true;
    saveUsers(users);
    renderUserList();
    alert(`✓ 已重置「${username}」密碼。\n請記得按「☁ 發布到雲端」讓對方同步到新的帳號狀態。`);
  }

  function deleteUser(username) {
    if (username === ADMIN_ID) { alert('不能刪除主帳號'); return; }
    if (!confirm(`確定刪除帳號「${username}」？此操作無法復原。`)) return;
    const users = loadUsers();
    delete users[username];
    saveUsers(users);
    renderUserList();
  }

  // Export users for publishData (called by app.js)
  function exportUsers() {
    return loadUsers();
  }

  // Called from app.js syncCloud to merge cloud users
  async function mergeCloudUsers(cloudUsers) {
    await initUsers(cloudUsers || null);
  }

  // ─── Bootstrap ───
  async function boot(cloudUsers) {
    initKeyboardShortcuts(); // C2: keyboard shortcuts
    await initUsers(cloudUsers || null);
    const session = getSession();
    if (session) {
      const users = loadUsers();
      if (users[session.username]) {
        // Restore session — defer showMainUI so App.init() finishes first
        setTimeout(() => showMainUI(session), 0);
        return true;
      }
    }
    showLogin();
    return false;
  }

  // ═══════════════ B2: Filter SessionStorage Memory ═══════════════
  const FILTER_SESSION_KEY = 'titan_filter_v1';

  function saveFilterState() {
    try {
      sessionStorage.setItem(FILTER_SESSION_KEY, JSON.stringify({
        months: state.selectedMonths,
        category: state.selectedCategory,
        model: state.selectedModel,
        page: state.currentPage,
      }));
    } catch(e) {}
  }

  function restoreFilterState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(FILTER_SESSION_KEY) || 'null');
      if (!saved || !state.db) return false;
      const allMonths = Object.keys(state.db.months).sort();
      const validMonths = (saved.months || []).filter(m => allMonths.includes(m));
      state.selectedMonths = validMonths.length ? validMonths : allMonths.slice();

      const validCategories = new Set(['全部', ...Object.keys(RepairParser.CATEGORY_MAP || {}), '其他']);
      state.selectedCategory = validCategories.has(saved.category) ? saved.category : '全部';

      const recordsForMonths = RepairAnalyzer.getRecords(state.db, { months: state.selectedMonths });
      const validModels = new Set(recordsForMonths.map(r => r.model));
      if (saved.model && saved.model !== '全部') {
        const normSaved = RepairAnalyzer.normalizeModel ? RepairAnalyzer.normalizeModel(saved.model) : saved.model;
        state.selectedModel = validModels.has(normSaved) ? normSaved : '全部';
      } else {
        state.selectedModel = '全部';
      }

      if (saved.page && PAGE_NAME[saved.page] && saved.page !== 'summary') {
        state.currentPage = saved.page;
      }
      return true;
    } catch(e) { return false; }
  }

  // ═══════════════ B5: Push Notifications ═══════════════
  async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  function notifyNewAnomalies(anomalies) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const critical = (anomalies || []).filter(a => a.severity === 'critical');
    if (!critical.length) return;
    try {
      new Notification('TITAN-STAR 異常警示', {
        body: `偵測到 ${critical.length} 件嚴重異常，請立即查看`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%23161d28"/><text x="32" y="46" font-size="36" text-anchor="middle" fill="%2338bdf8">S</text></svg>',
        tag: 'titan-critical',
        requireInteraction: false,
      });
    } catch(e) {}
  }

  // ═══════════════ A5: Lazy Chart Init ═══════════════
  function lazyChart(canvasId, creator) {
    const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200) { creator(); return; }
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { obs.disconnect(); creator(); }
    }, { rootMargin: '150px' });
    obs.observe(canvas);
  }

  // ═══════════════ C2: Keyboard Shortcuts ═══════════════
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Skip if typing in input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      // Esc → close drawer / admin panel
      if (e.key === 'Escape') {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList.contains('open')) {
          App.closeDrawer ? App.closeDrawer() : (drawer.classList.remove('open'));
          return;
        }
        const ap = document.getElementById('adminPanel');
        if (ap && ap.style.display !== 'none') { App.closeAdminPanel(); return; }
      }

      // Alt+1..9 → switch pages
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const pages = ['summary','overview','alerts','parts','cross','trend','reason','quality','cost'];
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < pages.length && state.db) {
          e.preventDefault();
          App.navigate(pages[idx]);
        }
        return;
      }

      // / → focus search (if on detail page)
      if (e.key === '/' && state.currentPage === 'detail') {
        e.preventDefault();
        const s = document.getElementById('detailSearch');
        if (s) { s.focus(); s.select(); }
        return;
      }

      // Ctrl+E → export current page
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        const exportBtns = document.querySelectorAll('[onclick*="export"],[onclick*="Export"]');
        if (exportBtns.length) exportBtns[0].click();
        return;
      }
    });
  }

  return {
    boot, doLogin, doChangePw, logout,
    openAdminPanel, closeAdminPanel, addUser, resetUserPwd, deleteUser, clearLoginLogs,
    exportUsers, mergeCloudUsers,
    saveFilterState, restoreFilterState,
    requestNotificationPermission, notifyNewAnomalies,
    lazyChart,
  };
})();
