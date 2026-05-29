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
  };

  // ─────────────── State ───────────────
  const state = {
    db: { months: {} },
    selectedMonths: [],       // [] = all
    selectedCategory: '全部',
    selectedModel: '全部',
    currentPage: 'overview',
    analysisRole: 'all',
    charts: {},               // chart instance refs
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

  // ─────────────── Cloud sync (read-only shared data via repo data.json) ───────────────
  const CLOUD_URL = './data.json';
  const CLOUD_SEEN_KEY = 'repair_cloud_seen';

  // Fetch shared data.json; if it is newer than what this browser last saw,
  // load it into localStorage so every user auto-syncs the maintainer's publish.
  async function syncCloud() {
    try {
      const res = await fetch(CLOUD_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      const cloud = await res.json();
      if (!cloud || !cloud.months) return null;
      const monthCount = Object.keys(cloud.months).length;
      state.cloudMeta = {
        publishedAt: cloud.publishedAt || null,
        publishedBy: cloud.publishedBy || '',
        months: monthCount,
      };
      if (!monthCount || !cloud.publishedAt) return cloud;

      const seen = localStorage.getItem(CLOUD_SEEN_KEY);
      if (cloud.publishedAt !== seen) {
        // Cloud has a newer publish than this browser last loaded → adopt it.
        localStorage.setItem('repair_db_v2', JSON.stringify({ months: cloud.months }));
        localStorage.setItem(CLOUD_SEEN_KEY, cloud.publishedAt);
        state.cloudJustLoaded = true;
      }
      return cloud;
    } catch (e) {
      console.warn('Cloud sync skipped:', e.message);
      return null;
    }
  }

  // Maintainer action: produce a data.json to commit to the repo.
  function publishData() {
    try {
      const raw = localStorage.getItem('repair_db_v2');
      const db = raw ? JSON.parse(raw) : { months: {} };
      if (!Object.keys(db.months || {}).length) { alert('目前沒有資料可發布,請先上傳報表'); return; }
      const payload = {
        months: db.months,
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
    if (!m || !m.publishedAt) {
      return `<div class="uz-cloud-bar none">☁ 雲端尚無共用資料 — 上傳後按「發布到雲端」即可讓所有人同步</div>`;
    }
    const d = new Date(m.publishedAt);
    const ds = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `<div class="uz-cloud-bar ok">☁ 已連動雲端共用資料 · ${m.months} 個月份 · 發布於 ${ds}${state.cloudJustLoaded ? ' <strong>(已載入最新版)</strong>' : ''}</div>`;
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
          const scrapCount = m.records.filter(r => (r.faultCause || '').includes('報廢') || (r.faultCause || '').includes('600')).length;
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
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.months) throw new Error('不是有效的備份格式');
        localStorage.setItem('repair_db_v2', e.target.result);
        state.db = RepairDB.load();
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
    if (!confirm(`確定移除 ${fmt.monthLabel(mk)} 的資料？`)) return;
    RepairDB.removeMonth(mk);
    state.db = RepairDB.load();
    renderUploadList();
  }

  function clearAll() {
    if (!confirm('確定清除所有累積資料？此操作無法復原。')) return;
    state.db = RepairDB.clear();
    renderUploadList();
  }

  function confirmClear() {
    if (!confirm('確定清除所有累積資料？此操作無法復原。')) return;
    state.db = RepairDB.clear();
    openUpload();
  }

  // ─────────────── Page switching ───────────────
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
    $('dash').classList.remove('active');
    $('uploadZone').style.display = 'flex';
    state.db = RepairDB.load();
    renderUploadList();
  }

  function switchPage(name) {
    state.currentPage = name;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.snav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    $(`page${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
    // Dismiss badges when viewing related pages
    if (name === 'alerts') dismissAlertPulse();
    if (name === 'scrap') dismissCrossMonthPulse();
    renderPage();
    window.scrollTo(0, 0);
    const rankWrap = document.getElementById('rankWrap');
    if (rankWrap) rankWrap.scrollTop = 0;
  }

  // ─────────────── Filter chips ───────────────
  function renderFilters() {
    const months = Object.keys(state.db.months).sort();
    const all = state.selectedMonths.length === 0 || state.selectedMonths.length === months.length;

    // Month chips
    const mc = $('monthChips');
    mc.innerHTML = '<div class="sb-label">月份</div>'
      + `<button class="chip ${all ? 'active' : ''}" onclick="App.setMonth('__ALL__')">全部 <span class="num">${months.length}</span></button>`
      + months.map(mk => {
        const sel = !all && state.selectedMonths.includes(mk);
        const m = state.db.months[mk];
        return `<button class="chip ${sel ? 'active' : ''}" onclick="App.setMonth('${mk}')">${fmt.monthLabel(mk)} <span class="num">${m.records.length}</span></button>`;
      }).join('');

    // Category chips
    const records = RepairAnalyzer.getRecords(state.db, { months: state.selectedMonths });
    const catCounts = {};
    for (const r of records) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    const cats = ['全部', ...Object.keys(RepairParser.CATEGORY_MAP), '其他'].filter(c => c === '全部' || catCounts[c]);
    const cc = $('catChips');
    cc.innerHTML = '<div class="sb-label">大類</div>'
      + cats.map(c => {
        const sel = state.selectedCategory === c;
        const count = c === '全部' ? records.length : (catCounts[c] || 0);
        const color = c === '全部' ? COLORS.text3 : (CAT_COLOR[c] || COLORS.text3);
        return `<button class="chip cat-chip ${sel ? 'active' : ''}" style="--c:${color}" onclick="App.setCategory('${c}')">${c} <span class="num">${count}</span></button>`;
      }).join('');

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
  }

  function setCategory(c) {
    state.selectedCategory = c;
    state.selectedModel = '全部';
    renderAll();
  }

  function setModel(m) {
    state.selectedModel = m;
    renderAll();
  }

  // ─────────────── Render orchestration ───────────────
  function renderAll() {
    const months = Object.keys(state.db.months).sort();
    const denomTotal = Object.values(state.db.months).reduce((s, m) => s + Object.values(m.denominators || {}).reduce((a, b) => a + b, 0), 0);
    const recCount = Object.values(state.db.months).reduce((s, m) => s + m.records.length, 0);
    $('hdrSub').textContent = `${months.length} 個月 · ${recCount.toLocaleString()} 筆紀錄 · 整新數 ${denomTotal.toLocaleString()}`;

    renderFilters();
    renderAnalysisRoleBar();
    updateAlertBadge();
    renderPage();
  }

  function setAnalysisRole(role) {
    state.analysisRole = role;
    renderAnalysisRoleBar();
    if (state.currentPage === 'overview') renderPage();
  }

  function renderAnalysisRoleBar() {
    const bar = $('analysisRoleBar');
    if (!bar) return;
    const cur = state.analysisRole;
    bar.innerHTML = Object.entries(ANALYSIS_ROLES).map(([k, r]) => {
      const active = k === cur;
      return `<button class="ar-chip ${active ? 'active' : ''}" style="--rc:${r.color}"
        onclick="App.setAnalysisRole('${k}')" title="${r.desc}">
        <span class="ar-chip-ico">${r.icon}</span>
        <span class="ar-chip-t">${r.short}</span>
      </button>`;
    }).join('');
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
    };
    const roleAnoms = (roleAnomMap[role] || anoms).slice(0, 3);

    const insights = [];

    const addCard = (icon, color, title, body, tag) => {
      insights.push({ icon, color, title, body, tag });
    };

    switch (role) {
      case 'all':
        if (momText) addCard('↗','var(--accent)','月度比較',momText,'趨勢');
        if (kpis.scrapPct >= 5) addCard('✕','var(--critical)','報廢警示',`報廢率 <strong>${fmt.pct(kpis.scrapPct)}</strong>，已達警戒線（5%），建議立即調查主因機種`,'品質');
        if (repeatedList.length > 0) addCard('♺','var(--warn)','重複維修',`共 <strong>${repeatedList.length}</strong> 台機器在篩選期間維修 ≥2 次；最高：${repeatedList[0][0].split('|')[1]} ×${repeatedList[0][1]}`,'品質');
        if (crossSerial.length > 0) addCard('⇄','var(--info)','跨月重複',`<strong>${crossSerial.length}</strong> 台序號跨月出現，疑似長期未解決問題`,'追蹤');
        break;

      case 'ceo':
        addCard('◈','var(--info)','經營摘要',`累積維修 <strong>${fmt.int(kpis.totalRepairs)}</strong> 件 / 整新數 <strong>${fmt.int(kpis.denomTotal)}</strong>，整體故障率 <strong>${fmt.pct(kpis.denomPct)}</strong>`,'績效');
        if (kpis.scrapPct >= 3) addCard('✕','var(--critical)','財務風險',`報廢 <strong>${fmt.int(kpis.scrap)}</strong> 件（${fmt.pct(kpis.scrapPct)}），每件報廢代表直接物料損失，需主管評估報廢原因集中度`,'風險');
        if (crossSerial.length >= 5) addCard('⇄','var(--warn)','品牌曝險',`<strong>${crossSerial.length}</strong> 台機器跨月重複故障，若涉及保固條款，可能引發客訴升級`,'風險');
        if (anoms.filter(a=>a.severity==='critical').length > 0) addCard('!','var(--critical)','緊急異常',`本期偵測到 <strong>${anoms.filter(a=>a.severity==='critical').length}</strong> 項嚴重異常，需優先關注`,'決策');
        if (momText) addCard('↗','var(--accent)','月度動向',momText,'趨勢');
        break;

      case 'factory':
        addCard('⊙','var(--ok)','全廠概況',`${Object.entries(catCount).map(([c,n])=>`${c} ${n}件`).join(' · ')}`,'總覽');
        if (anoms.length > 0) addCard('!','var(--warn)','待協調事項',`本期偵測 <strong>${anoms.length}</strong> 項異常，涉及多部門需跨部門協調`,'調度');
        if (repeatedList.length > 5) addCard('♺','var(--warn)','積壓風險',`<strong>${repeatedList.length}</strong> 台機器重複進廠，佔用維修產能，建議與品檢確認根本原因`,'資源');
        if (momText) addCard('↗','var(--accent)','產量比較',momText,'趨勢');
        break;

      case 'procure':
        if (pareto.length > 0) addCard('◎','var(--warn)','採購觸發',`最高換件：<strong>${pareto[0].name}</strong> ×${pareto[0].count}，涉及 ${pareto[0].models.length} 機種；建議評估安全庫存`,'庫存');
        if (pareto.length > 2) addCard('▤','var(--info)','零件集中度',`前 3 大零件：${pareto.slice(0,3).map(p=>`${p.name}(${p.count})`).join('、')}，佔總用量 ${fmt.pct(pareto.slice(0,3).reduce((s,p)=>s+p.count,0)/Math.max(records.length,1)*100)}`,'分析');
        const multiModelParts = pareto.filter(p => p.models.length >= 3);
        if (multiModelParts.length > 0) addCard('⇄','var(--critical)','跨機種零件',`<strong>${multiModelParts[0].name}</strong> 跨 ${multiModelParts[0].models.length} 機種，若庫存不足將多線停修`,'風險');
        if (momText) addCard('↗','var(--accent)','用量趨勢',momText,'趨勢');
        break;

      case 'prod':
        if (topModel) addCard('⚙','var(--warn)','故障最多機種',`<strong>${topModel[0]}</strong> 維修量最高（${topModel[1]} 件），佔整體 ${fmt.pct(topModel[1]/Math.max(kpis.totalRepairs,1)*100)}`,'良率');
        addCard('◈','var(--info)','機種數量',`本期涉及 <strong>${kpis.models}</strong> 個機種，${Object.entries(catCount).map(([c,n])=>`${c} ${n}件`).join('、')}`,'生產');
        if (scrapRecs.length > 0) {
          const scrapByModel = {};
          for (const r of scrapRecs) scrapByModel[r.model] = (scrapByModel[r.model]||0)+1;
          const topScrapModel = Object.entries(scrapByModel).sort((a,b)=>b[1]-a[1])[0];
          addCard('✕','var(--critical)','報廢集中',`報廢最高機種：<strong>${topScrapModel[0]}</strong> ×${topScrapModel[1]}，建議確認製程 SOP`,'品質');
        }
        break;

      case 'qa':
        addCard('◇','var(--warn)','重複維修率',`同期重複進廠 <strong>${repeatedList.length}</strong> 台（${fmt.pct(repeatedList.length/Math.max(kpis.totalRepairs,1)*100)}），是品質未閉環的指標`,'CAPA');
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','跨月重複',`<strong>${crossSerial.length}</strong> 台跨月重複，強烈建議開立 CAPA 追蹤`,'CAPA');
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
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','高風險客戶',`<strong>${crossSerial.length}</strong> 台跨月重複故障，若持續未修好將導致客戶投訴升級`,'客訴');
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
        if (crossSerial.length > 0) addCard('⇄','var(--critical)','設計根因',`${crossSerial.length} 台跨月重複故障，若硬體設計問題未改版，將持續復發`,'ECO');
        if (scrapRecs.length > 0) addCard('✕','var(--warn)','元件可靠性',`報廢 ${scrapRecs.length} 件，建議確認主要報廢原因是否與特定元件批次相關`,'可靠度');
        if (topModel) addCard('⚙','var(--info)','高關注機種',`${topModel[0]} 維修量最高，若屬硬體問題需優先安排設計審查`,'審查');
        break;

      case 'fw':
        if (fwRecs.length > 0) addCard('▷','var(--warn)','韌體相關故障',`含韌體關鍵字 <strong>${fwRecs.length}</strong> 件（${fmt.pct(fwRecs.length/Math.max(kpis.totalRepairs,1)*100)}），建議確認版本分布`,'OTA');
        else addCard('▷','var(--ok)','韌體狀況','本期未偵測到明顯韌體相關故障關鍵字，韌體穩定度良好','OTA');
        if (crossSerial.length > 0) addCard('⇄','var(--info)','潛在韌體根因',`${crossSerial.length} 台跨月重複，若排除硬體因素，需確認韌體 OTA 是否成功落版`,'追蹤');
        addCard('♺','var(--info)','重複維修洞察',`重複進廠 ${repeatedList.length} 台，建議比對維修紀錄中的韌體版本欄位，排查特定版本集中問題`,'分析');
        break;
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
        ${insights.map(ins => `
          <div class="ri-card" style="--rc:${ins.color}">
            <div class="ri-card-top">
              <span class="ri-card-ico">${ins.icon}</span>
              <span class="ri-card-tag">${ins.tag}</span>
            </div>
            <div class="ri-card-title">${ins.title}</div>
            <div class="ri-card-body">${ins.body}</div>
          </div>
        `).join('')}
      </div>
      ${roleAnoms.length > 0 ? `
        <div class="ri-anoms-label">本視角相關異常警示</div>
        <div class="ri-anoms">
          ${roleAnoms.map(a => `
            <div class="ri-anom ${a.severity}">
              <span class="ri-anom-ico">${a.icon}</span>
              <span class="ri-anom-t">${a.title}</span>
              <span class="ri-anom-m">${escapeHtml(a.subject)}</span>
            </div>
          `).join('')}
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

  function renderPage() {
    // Destroy any existing charts on the page
    for (const k of Object.keys(state.charts)) {
      if (state.charts[k]) { state.charts[k].destroy(); state.charts[k] = null; }
    }
    switch (state.currentPage) {
      case 'overview': renderOverview(); break;
      case 'alerts':   renderAlerts(); break;
      case 'parts':    renderParts(); break;
      case 'cross':    renderCross(); break;
      case 'trend':    renderTrend(); break;
      case 'reason':   renderReason(); break;
      case 'scrap':    renderScrap(); break;
      case 'detail':   renderDetail(); break;
    }
  }

  // ─────────────── Overview ───────────────
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

    // KPIs (all clickable)
    const scrapClass = kpis.scrapPct >= 10 ? 'bad' : kpis.scrapPct >= 5 ? 'warn' : 'good';
    const denomClass = kpis.denomPct >= 5 ? 'bad' : kpis.denomPct >= 2 ? 'warn' : 'good';

    $('kpiGrid').innerHTML = `
      <div class="kpi k-blue" onclick="App.openKpiDrawer('total')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">總維修件數</div><div class="kpi-ico">∑</div></div>
        <div class="kpi-v">${fmt.int(kpis.totalRepairs)}</div>
        <div class="kpi-d">
          佔整新數 <span class="pct ${denomClass}">${fmt.pct(kpis.denomPct)}</span>
          <span class="muted">/ ${fmt.int(kpis.denomTotal)}</span>
        </div>
      </div>
      <div class="kpi k-info" onclick="App.openKpiDrawer('models')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">受檢機種</div><div class="kpi-ico">#</div></div>
        <div class="kpi-v">${fmt.int(kpis.models)}</div>
        <div class="kpi-d"><span class="muted">機種數 · ${state.selectedCategory === '全部' ? '全分類' : state.selectedCategory}</span></div>
      </div>
      <div class="kpi k-red" onclick="App.openKpiDrawer('scrap')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">報廢件數</div><div class="kpi-ico">✕</div></div>
        <div class="kpi-v">${fmt.int(kpis.scrap)}</div>
        <div class="kpi-d">
          報廢率 <span class="pct ${scrapClass}">${fmt.pct(kpis.scrapPct)}</span>
          <span class="muted">/ 總維修</span>
        </div>
      </div>
      <div class="kpi k-warn" onclick="App.openKpiDrawer('repeated')" role="button" tabindex="0">
        <div class="kpi-arrow">→</div>
        <div class="kpi-h"><div class="kpi-l">重複維修</div><div class="kpi-ico">♺</div></div>
        <div class="kpi-v">${fmt.int(kpis.repeatedSerials)}</div>
        <div class="kpi-d"><span class="muted">同序號 ≥ 2 次 · 治標未治本</span></div>
      </div>
    `;

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
    const ranks = RepairAnalyzer.modelRank(records, denom, state.db, state.selectedMonths);
    state.currentRanks = ranks;  // cache for click handlers
    const maxCount = Math.max(...ranks.map(r => r.count), 1);
    $('rankMeta').textContent = `${ranks.length} 個機種 · 依本期故障率排序`;

    const sortedMonths = state.selectedMonths.slice().sort();
    const curMonth = sortedMonths[sortedMonths.length - 1];
    // Reverse for display: newest month first
    const displayMonths = sortedMonths.slice().reverse();

    const monthCount = displayMonths.length;
    const showTotalCol = monthCount >= 2;

    const rows = ranks.map((r, i) => {
      const altCls = (i % 2 === 1) ? ' alt' : '';
      const noClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const hist = r.history || [];
      const histByMonth = Object.fromEntries(hist.map(h => [h.month, h]));

      // Build month cells
      const monthCells = displayMonths.map(mk => {
        const isCurrent = mk === curMonth;
        const h = histByMonth[mk];
        const clickAttr = `onclick="event.stopPropagation();App.openModelDrawer('${escapeAttr(r.model)}','${mk}')"`;
        if (!h || h.count === 0) {
          return `<td class="month-cell empty ${isCurrent ? 'current' : ''}" ${clickAttr} style="cursor:pointer">
            <div class="mc-pct empty">—</div>
          </td>`;
        }
        if (h.denom === 0 || h.faultRate == null) {
          return `<td class="month-cell no-denom ${isCurrent ? 'current' : ''}" ${clickAttr} style="cursor:pointer">
            <div class="mc-pct">${h.count}<span class="unit">件</span></div>
            <div class="mc-ratio"><span class="no-denom-mark" title="此機種此月份無整新數資料">無分母</span></div>
          </td>`;
        }
        const pCls = h.faultRate >= 0.1 ? 'bad' : h.faultRate >= 0.05 ? 'warn' : 'good';
        return `<td class="month-cell ${isCurrent ? 'current' : ''}" ${clickAttr} style="cursor:pointer">
          <div class="mc-pct ${pCls}">${(h.faultRate * 100).toFixed(1)}%</div>
          <div class="mc-ratio"><span class="num">${h.count}</span> <span class="denom">/ ${h.denom}</span></div>
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
                      <div class="barlist-name">${escapeHtml(p.name)}</div>
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
                <th class="month-col">
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
          ${escapeHtml(p.name)}
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
    $('alertsMeta').textContent = `${anoms.length} 筆警示 · 比對基準：${fmt.monthLabel(lastMonth)} · 點擊卡片深入分析`;

    if (!anoms.length) {
      $('anomGrid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">✓</div><div class="empty-t">未偵測到顯著異常 — 一切看起來正常</div></div>`;
      return;
    }
    const sevLabel = { critical: '嚴重', warn: '注意', info: '資訊' };
    $('anomGrid').innerHTML = anoms.map((a, i) => `
      <div class="anom-card ${a.severity}" onclick="App.openAnomalyDrawer(${i})">
        <div class="anom-h">
          <span class="anom-ico">${a.icon}</span>
          <span class="anom-t">${a.title}</span>
          <span class="anom-sev">${sevLabel[a.severity]}</span>
        </div>
        <div class="anom-s">${escapeHtml(a.subject)}</div>
        <div class="anom-m">${escapeHtml(a.message)}</div>
        <div class="anom-foot">
          <span class="anom-metric">${a.metric}</span>
          <span class="anom-metric-l">${a.metricLabel}</span>
        </div>
      </div>
    `).join('');
  }

  // ─────────────── Parts (Pareto) ───────────────
  function renderParts() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    const pareto = RepairAnalyzer.partPareto(records);
    const total = pareto.reduce((s, p) => s + p.count, 0);
    $('partsMeta').textContent = `${pareto.length} 種零件 · 共 ${total.toLocaleString()} 件`;

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

    // Table
    const tbody = $('paretoBody');
    tbody.innerHTML = pareto.slice(0, 200).map((p, i) => `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>
          <span class="tag">${p.models.length} 機種</span>
          <div class="muted" style="font-size:10.5px;font-family:var(--mono);margin-top:3px">${p.models.slice(0, 4).join(', ')}${p.models.length > 4 ? '…' : ''}</div>
        </td>
        <td class="num" style="text-align:right;font-weight:700">${p.count}</td>
        <td>
          <div class="pwrap">
            <div class="ptrack"><div style="width:${(p.pct * 100).toFixed(1)}%"></div></div>
            <div class="pnum">${(p.pct * 100).toFixed(1)}% / ${(p.cumPct * 100).toFixed(0)}%</div>
          </div>
        </td>
      </tr>
    `).join('');
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

    // Color scale based on max count in matrix
    const maxCount = Math.max(...cross.flatMap(p => Object.values(p.perModel)));

    const head = `<tr><th></th>${models.map(m => `<th>${m}</th>`).join('')}<th style="color:var(--text)">合計</th></tr>`;
    const body = cross.slice(0, 50).map(p => {
      const cells = models.map(m => {
        const v = p.perModel[m];
        if (!v) return `<td class="empty">·</td>`;
        const intensity = Math.min(0.9, 0.15 + (v / maxCount) * 0.6);
        const color = v >= 10 ? COLORS.critical : v >= 5 ? COLORS.warn : COLORS.accent;
        return `<td><span class="matrix-cell" style="background:${color}${Math.round(intensity * 255).toString(16).padStart(2,'0')};color:${COLORS.text}">${v}</span></td>`;
      }).join('');
      return `<tr>
        <th scope="row">${escapeHtml(p.name)}<span class="spec">${p.models.length} 機種</span></th>
        ${cells}
        <td><strong style="color:var(--text);font-family:var(--mono)">${p.count}</strong></td>
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
        plugins: { legend: { position: 'top', labels: { color: COLORS.text2 } } },
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
        plugins: { legend: { position: 'top', labels: { color: COLORS.text2 } } },
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
        plugins: { legend: { position: 'bottom', labels: { color: COLORS.text2, boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: COLORS.text3 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: COLORS.text3 }, grid: { color: COLORS.border } },
        },
      },
    });
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
  function renderDetail() {
    const f = currentFilter();
    const records = RepairAnalyzer.getRecords(state.db, f);
    $('detailMeta').textContent = `${records.length.toLocaleString()} 筆`;
    const rows = records.slice(0, 500);
    $('detailBody').innerHTML = rows.map(r => `
      <tr>
        <td class="num muted">${fmt.monthLabel(r._monthKey)}</td>
        <td class="num muted">${r.date || '—'}</td>
        <td><span style="font-family:var(--mono);font-weight:600">${r.model}</span></td>
        <td class="num">${r.serial || '—'}</td>
        <td>${r.isScrap ? `<span style="color:var(--critical);font-weight:600">${escapeHtml(r.reason || '報廢')}</span>` : escapeHtml(r.reason || '—')}</td>
        <td>${escapeHtml(r.content || '—')}</td>
        <td>
          ${[[r.part1, r.qty1], [r.part2, r.qty2], [r.part3, r.qty3]].filter(([p]) => p).map(([p, q]) => `<span class="tag">${escapeHtml(p)} <span class="muted">×${q}</span></span>`).join(' ')}
        </td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="empty">無紀錄</td></tr>`;
    if (records.length > 500) {
      $('detailBody').innerHTML += `<tr><td colspan="7" style="text-align:center;color:var(--text3);font-size:12px;padding:14px">顯示前 500 筆 · 共 ${records.length.toLocaleString()} 筆 · 請使用篩選器縮小範圍</td></tr>`;
    }
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
  function openDrawer({ severity = 'info', icon = 'i', overline, title, bodyHtml }) {
    $('drawerIco').textContent = icon;
    $('drawerIco').className = 'drawer-ico ' + severity;
    $('drawerT').textContent = overline || '';
    $('drawerS').textContent = title || '';
    $('drawerBody').innerHTML = bodyHtml;
    $('drawerMask').classList.add('open');
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    $('drawerMask').classList.remove('open');
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

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
    const sortedMonths = state.selectedMonths.slice().sort();
    const curMonth = focusMonth || sortedMonths[sortedMonths.length - 1];
    const cur = history.find(h => h.month === curMonth) || { count: 0, denom: 0, topParts: [] };

    // Aggregate: total over all months
    const totalCount = history.reduce((s, h) => s + h.count, 0);
    const totalDenom = history.reduce((s, h) => s + (h.denom || 0), 0);
    const totalScrap = history.reduce((s, h) => s + (h.scrap || 0), 0);
    const totalRate = totalDenom ? totalCount / totalDenom : null;

    // Top parts for focused month
    const max = cur.topParts[0]?.count || 1;

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
            const isCurrent = h.month === curMonth;
            const prev = i > 0 ? history[i - 1].faultRate : null;
            const delta = prev != null && h.faultRate != null ? (h.faultRate - prev) * 100 : null;
            const pCls = h.faultRate == null ? '' : h.faultRate >= 0.1 ? 'bad' : h.faultRate >= 0.05 ? 'warn' : 'good';
            return `
              <div class="dh-month-card ${isCurrent ? 'current' : ''}">
                <div class="m">${fmt.monthLabel(h.month)}</div>
                <div class="v">${h.count}</div>
                <div class="d">/ ${h.denom || '—'}</div>
                ${h.faultRate != null ? `<div class="p ${pCls}">${(h.faultRate * 100).toFixed(1)}%</div>` : '<div class="p">—</div>'}
                ${delta != null && Math.abs(delta) >= 0.1 ? `<div class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲ +' : '▼ '}${Math.abs(delta).toFixed(1)}%</div>` : ''}
              </div>
            `;
          }).join('')}
          <div class="dh-month-card" style="background:var(--surface3);border-color:var(--border2)">
            <div class="m" style="color:var(--text2)">累計</div>
            <div class="v">${totalCount}</div>
            <div class="d">/ ${totalDenom || '—'}</div>
            ${totalRate != null ? `<div class="p ${totalRate >= 0.1 ? 'bad' : totalRate >= 0.05 ? 'warn' : 'good'}">${(totalRate * 100).toFixed(1)}%</div>` : ''}
            <div class="delta" style="background:var(--surface2);color:var(--text3)">報廢 ${totalScrap}</div>
          </div>
        </div>
      </div>

      ${cur.topParts.length > 0 ? `
        <div class="drawer-sec">
          <div class="drawer-sec-t"><span class="strong">${fmt.monthLabel(curMonth)} 最常更換零件</span> <span class="count-tag">${cur.topParts.length} 種</span></div>
          <div class="barlist">
            ${cur.topParts.map(p => `
              <div class="barlist-row" style="cursor:pointer" onclick="App.openPartDrawer('${escapeAttr(p.name)}')">
                <div class="barlist-name">${escapeHtml(p.name)}</div>
                <div class="barlist-track"><div style="width:${(p.count / max * 100).toFixed(0)}%"></div></div>
                <div class="barlist-n">${p.count}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
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
                <div class="barlist-name">${escapeHtml(p)}</div>
                <div class="barlist-track"><div style="width:${(c / sortedParts[0][1] * 100).toFixed(0)}%;background:var(--warn)"></div></div>
                <div class="barlist-n">${c}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
    `;
  }

  function openPartDrawer(partNorm) {
    openDrawer({
      severity: 'info', icon: '▤',
      overline: '零件深入分析',
      title: partNorm,
      bodyHtml: partDrillContent(partNorm),
    });
  }
  function openModelDrawer(model, focusMonth) {
    const cat = RepairParser.getCategory(model);
    const subtitle = focusMonth ? ` · ${fmt.monthLabel(focusMonth)}` : '';
    openDrawer({
      severity: 'info', icon: '#',
      overline: `機種深入分析 · ${cat}${subtitle}`,
      title: model,
      bodyHtml: modelDrillContent(model, focusMonth),
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

  // ─────────────── Init ───────────────
  async function init() {
    setupUpload();
    state.db = RepairDB.load();
    renderUploadList();
    // Escape key closes drawer
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('drawer').classList.contains('open')) closeDrawer();
    });
    // Pull shared cloud data (data.json) and auto-sync if maintainer published a newer version.
    await syncCloud();
    state.db = RepairDB.load();
    renderUploadList();
  }
  document.addEventListener('DOMContentLoaded', init);

  return {
    handleFiles, removeMonth, clearAll, confirmClear, exportData, importData,
    publishData,
    openDashboard, openUpload, switchPage,
    setMonth, setCategory, setModel,
    setAnalysisRole,
    toggleRank, toggleRankRow,
    dismissAlertPulse, dismissCrossMonthPulse,
    generateReport: () => RepairReport.generate(state.db),
    exportCrossMatrix,
    // Drawer
    openKpiDrawer, openAnomalyDrawer, openPartDrawer, openModelDrawer, openSerialDrawer,
    closeDrawer,
  };
})();
