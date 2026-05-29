// ════════════════════════════════════════════════════════════════════
// RMA Management Module
// Create / track / resolve return merchandise authorization cases.
// Storage: localStorage keyed by rma_db_v1
// ════════════════════════════════════════════════════════════════════

window.RMA = (function () {

  const STORAGE_KEY = 'rma_db_v1';

  // ─── Status flow ───
  const STATUS = {
    received:    { label: '已收件', icon: '◎', color: '#38bdf8' },
    diagnosing:  { label: '診斷中', icon: '⊙', color: '#818cf8' },
    repairing:   { label: '維修中', icon: '⚙', color: '#f59e0b' },
    testing:     { label: '測試中', icon: '◈', color: '#10b981' },
    shipped:     { label: '已出貨', icon: '✓', color: '#10b981' },
    scrapped:    { label: '報廢',   icon: '✕', color: '#ef4444' },
    cancelled:   { label: '取消',   icon: '—', color: '#475569' },
  };

  const STATUS_ORDER = ['received', 'diagnosing', 'repairing', 'testing', 'shipped'];

  const CATEGORY_MAP = window.RepairParser ? window.RepairParser.CATEGORY_MAP : {};

  // ─── Role definitions ───
  const ROLES = {
    all:       { label:'綜合視角', short:'綜合',   icon:'⊞', color:'#38bdf8', desc:'所有部門共同關注的核心指標' },
    ceo:       { label:'董事長',   short:'董事長',  icon:'◈', color:'#a78bfa', desc:'戰略績效 · 風險評估 · 財務影響' },
    factory:   { label:'廠長',     short:'廠長',    icon:'⊙', color:'#fb923c', desc:'跨部門協調 · 積壓管理 · 資源調配' },
    procure:   { label:'採購主管', short:'採購',    icon:'◎', color:'#facc15', desc:'零件需求 · 供應商風險 · 換件成本' },
    prod:      { label:'生產主管', short:'生產',    icon:'⚙', color:'#10b981', desc:'良率 · 機種分布 · 製程異常' },
    qa:        { label:'品檢主管', short:'品檢',    icon:'◇', color:'#f472b6', desc:'重複故障 · 保固分析 · CAPA追蹤' },
    logistics: { label:'物流主管', short:'物流',    icon:'↗', color:'#34d399', desc:'SLA達成 · 在廠天數 · 出貨排程' },
    cs:        { label:'客服主管', short:'客服',    icon:'◉', color:'#60a5fa', desc:'客戶溝通 · 逾期通知 · 保固處理' },
    repair:    { label:'維修主管', short:'維修',    icon:'✦', color:'#f59e0b', desc:'工單分配 · 技師效率 · 報廢判定' },
    hw:        { label:'硬體研發', short:'硬體',    icon:'◁', color:'#818cf8', desc:'設計缺陷 · ECO · 元件可靠性' },
    fw:        { label:'韌體研發', short:'韌體',    icon:'▷', color:'#22d3ee', desc:'韌體Bug · OTA修復 · 版本分析' },
  };

  // ─── Column definitions ───
  const COL_DEFS = {
    id:      { th:'案件號',    w:'120px' },
    model:   { th:'機種/序號', w:'130px' },
    category:{ th:'大類',     w:'80px'  },
    customer:{ th:'客戶',     w:'120px' },
    issue:   { th:'故障描述', w:'160px' },
    warranty:{ th:'保固',     w:'72px'  },
    receivedDate:   { th:'收件日',   w:'88px' },
    estimatedReturn:{ th:'預計回覆', w:'88px' },
    days:    { th:'天數',     w:'60px'  },
    status:  { th:'狀態',     w:'90px'  },
    parts:   { th:'換件記錄', w:'140px' },
    techName:{ th:'技師',     w:'80px'  },
  };

  const ROLE_COLS = {
    all:       { cols:['id','model','category','customer','issue','warranty','receivedDate','days','status'],        hi:['days','status'] },
    ceo:       { cols:['id','model','category','warranty','days','status'],                                         hi:['status','days'] },
    factory:   { cols:['id','model','category','customer','receivedDate','days','status'],                          hi:['days'] },
    procure:   { cols:['id','model','category','warranty','parts','receivedDate','status'],                         hi:['parts','warranty'] },
    prod:      { cols:['id','model','category','issue','receivedDate','status'],                                    hi:['category','model'] },
    qa:        { cols:['id','model','warranty','issue','status'],                                                   hi:['warranty'] },
    logistics: { cols:['id','model','receivedDate','estimatedReturn','days','status'],                              hi:['days','estimatedReturn'] },
    cs:        { cols:['id','customer','model','warranty','estimatedReturn','status'],                              hi:['customer','estimatedReturn'] },
    repair:    { cols:['id','model','techName','issue','days','status'],                                            hi:['status','days','techName'] },
    hw:        { cols:['id','model','category','issue','warranty','parts','status'],                                hi:['model','warranty'] },
    fw:        { cols:['id','model','issue','days','status'],                                                       hi:['issue'] },
  };

  // ─── Storage ───
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { cases: [], nextSeq: 1 };
      const obj = JSON.parse(raw);
      if (!obj.cases) obj.cases = [];
      if (!obj.nextSeq) obj.nextSeq = (obj.cases.length || 0) + 1;
      return obj;
    } catch {
      return { cases: [], nextSeq: 1 };
    }
  }

  function save(db) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.warn('RMA save failed:', e);
      return false;
    }
  }

  function genId(db) {
    const now = new Date();
    const yr = now.getFullYear();
    const seq = String(db.nextSeq).padStart(4, '0');
    db.nextSeq++;
    return `RMA-${yr}-${seq}`;
  }

  function getCategory(model) {
    const key = String(model || '').toUpperCase().replace(/[\s\-_\.()（）]/g, '');
    for (const [cat, list] of Object.entries(CATEGORY_MAP)) {
      if (list.some(m => m.toUpperCase().replace(/[\s\-_\.()（）]/g, '') === key)) return cat;
    }
    return '其他';
  }

  function createCase(data) {
    const db = load();
    const now = new Date().toISOString().substring(0, 10);
    const c = {
      id: genId(db),
      createdAt: now,
      model: (data.model || '').toUpperCase().trim(),
      serial: (data.serial || '').trim(),
      customer: (data.customer || '').trim(),
      contactName: (data.contactName || '').trim(),
      contactPhone: (data.contactPhone || '').trim(),
      issueDesc: (data.issueDesc || '').trim(),
      category: data.category || getCategory(data.model),
      warranty: data.warranty || 'unknown',  // in | out | unknown
      receivedDate: data.receivedDate || now,
      estimatedReturn: data.estimatedReturn || null,
      actualReturn: null,
      status: 'received',
      statusHistory: [{ status: 'received', date: now, note: '建立案件', operator: data.operator || '' }],
      diagnosis: { techName: '', diagDate: '', faultContent: '', parts: [], isScrap: false, notes: '' },
      repair: { techName: '', repairDate: '', parts: [], notes: '' },
      repairType: null,
      cost: null,
      notes: (data.notes || '').trim(),
    };
    db.cases.push(c);
    save(db);
    return c;
  }

  function updateCase(id, patch) {
    const db = load();
    const idx = db.cases.findIndex(c => c.id === id);
    if (idx < 0) return null;
    Object.assign(db.cases[idx], patch);
    save(db);
    return db.cases[idx];
  }

  function advanceStatus(id, newStatus, note, operator) {
    const db = load();
    const idx = db.cases.findIndex(c => c.id === id);
    if (idx < 0) return null;
    const c = db.cases[idx];
    c.status = newStatus;
    c.statusHistory.push({
      status: newStatus,
      date: new Date().toISOString().substring(0, 10),
      note: note || '',
      operator: operator || '',
    });
    if (newStatus === 'shipped') c.actualReturn = new Date().toISOString().substring(0, 10);
    save(db);
    return c;
  }

  function deleteCase(id) {
    const db = load();
    db.cases = db.cases.filter(c => c.id !== id);
    save(db);
    return db;
  }

  function getCase(id) {
    const db = load();
    return db.cases.find(c => c.id === id) || null;
  }

  function listCases(filter) {
    const db = load();
    let cases = db.cases.slice();
    if (filter) {
      if (filter.status && filter.status !== 'all') cases = cases.filter(c => c.status === filter.status);
      if (filter.category && filter.category !== '全部') cases = cases.filter(c => c.category === filter.category);
      if (filter.q) {
        const q = filter.q.toLowerCase();
        cases = cases.filter(c =>
          c.id.toLowerCase().includes(q) ||
          c.model.toLowerCase().includes(q) ||
          c.serial.toLowerCase().includes(q) ||
          c.customer.toLowerCase().includes(q) ||
          c.issueDesc.toLowerCase().includes(q)
        );
      }
    }
    return cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function stats() {
    const db = load();
    const cases = db.cases;
    const today = new Date().toISOString().substring(0, 10);
    const byStatus = {};
    for (const s of Object.keys(STATUS)) byStatus[s] = 0;
    let overdue = 0;
    const byCategory = {};
    const byMonth = {};

    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
      const ym = c.createdAt.substring(0, 7);
      byMonth[ym] = (byMonth[ym] || 0) + 1;
      const open = !['shipped', 'scrapped', 'cancelled'].includes(c.status);
      if (open && c.estimatedReturn && c.estimatedReturn < today) overdue++;
    }
    const open = cases.filter(c => !['shipped', 'scrapped', 'cancelled'].includes(c.status)).length;
    return { total: cases.length, open, overdue, byStatus, byCategory, byMonth };
  }

  function computeExtStats(cases) {
    const today = new Date().toISOString().substring(0, 10);
    const thisMonth = today.substring(0, 7);

    const serialCount = {};
    const partFreq = {};
    const byCategory = {};
    const byModel = {};
    let warrantyIn = 0, scrapped = 0, swFaults = 0;

    const swKw = ['當機','異常關機','無法開機','無回應','軟體','韌體','系統','連線','網路','藍牙','WiFi','更新','升級'];

    for (const c of cases) {
      if (c.serial) serialCount[c.serial] = (serialCount[c.serial] || 0) + 1;
      if (c.warranty === 'in') warrantyIn++;
      if (c.status === 'scrapped') scrapped++;
      if (swKw.some(kw => (c.issueDesc || '').includes(kw))) swFaults++;
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
      if (c.model) byModel[c.model] = (byModel[c.model] || 0) + 1;
      for (const p of [...(c.diagnosis?.parts || []), ...(c.repair?.parts || [])]) {
        partFreq[p.part] = (partFreq[p.part] || 0) + (p.qty || 1);
      }
    }

    const repeatSerials = Object.values(serialCount).filter(n => n > 1).length;
    const topPart = Object.entries(partFreq).sort((a, b) => b[1] - a[1])[0] || null;
    const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0] || null;
    const topModel = Object.entries(byModel).sort((a, b) => b[1] - a[1])[0] || null;
    const totalParts = Object.values(partFreq).reduce((s, n) => s + n, 0);

    const closedThisMonth = cases.filter(c =>
      ['shipped', 'scrapped', 'cancelled'].includes(c.status) &&
      (c.statusHistory || []).some(h => h.date?.startsWith(thisMonth) && ['shipped', 'scrapped', 'cancelled'].includes(h.status))
    ).length;

    const shippedThisMonth = cases.filter(c => {
      return c.status === 'shipped' && (c.statusHistory || []).some(h => h.date?.startsWith(thisMonth) && h.status === 'shipped');
    }).length;

    const cycles = cases.map(c => {
      const end = c.actualReturn || (c.status === 'shipped' ? today : null);
      if (!end || !c.receivedDate) return null;
      return Math.floor((new Date(end) - new Date(c.receivedDate)) / 86400000);
    }).filter(d => d !== null && d >= 0);
    const avgCycleDays = cycles.length ? Math.round(cycles.reduce((s, d) => s + d, 0) / cycles.length) : 0;

    return {
      repeatSerials, warrantyIn, scrapped, swFaults,
      topPart, topCategory, topModel, totalParts,
      closedThisMonth, shippedThisMonth, avgCycleDays,
      scrapRate: cases.length ? Math.round(scrapped / cases.length * 100) : 0,
      warrantyInRate: cases.length ? Math.round(warrantyIn / cases.length * 100) : 0,
    };
  }

  function getRoleKPIs(role, cases, ext, st) {
    const today = new Date().toISOString().substring(0, 10);
    const thisMonth = today.substring(0, 7);
    switch (role) {
      case 'all': return [
        { label:'總案件',      value: st.total,              color:'blue', desc:'累計所有案件' },
        { label:'進行中',      value: st.open,               color:'warn', desc:'尚未關閉案件' },
        { label:'已逾期',      value: st.overdue,            color: st.overdue > 0 ? 'red' : 'ok', desc:'超過預計回覆日' },
        { label:'本月完成',    value: ext.closedThisMonth,   color:'info', desc:'出貨+報廢+取消' },
        { label:'平均在廠天數',value: ext.avgCycleDays + '天', color:'blue', desc:'收件至完成平均' },
        { label:'報廢率',      value: ext.scrapRate + '%',   color: ext.scrapRate > 10 ? 'red' : 'ok', desc:'累計報廢/總案件' },
      ];
      case 'ceo': return [
        { label:'本月完成',    value: ext.closedThisMonth,   color:'ok',   desc:'出貨結案件數' },
        { label:'逾期風險',    value: st.overdue,            color: st.overdue > 0 ? 'red' : 'ok', desc:'超出承諾日' },
        { label:'報廢率',      value: ext.scrapRate + '%',   color: ext.scrapRate > 10 ? 'red' : 'ok', desc:'品質指標' },
        { label:'平均週轉天數',value: ext.avgCycleDays + '天', color:'blue', desc:'維修效率指標' },
      ];
      case 'factory': return [
        { label:'進行中',      value: st.open,               color:'warn', desc:'需關注的案件' },
        { label:'逾期未處理',  value: st.overdue,            color: st.overdue > 0 ? 'red' : 'ok', desc:'需立即介入' },
        { label:'待診斷分配',  value: st.byStatus.received || 0, color:'blue', desc:'剛收件待分配技師' },
        { label:'測試完畢可出貨', value: st.byStatus.testing || 0, color:'ok', desc:'即將完工' },
      ];
      case 'procure': return [
        { label:'已記錄換件次數', value: ext.totalParts,    color:'blue', desc:'診斷+維修累計換件' },
        { label:'保固外案件',  value: cases.filter(c => c.warranty === 'out').length, color:'warn', desc:'可能涉及換件費用' },
        { label:'最高頻零件',  value: ext.topPart ? ext.topPart[0] : '—', color:'info', desc: ext.topPart ? `累計 ${ext.topPart[1]} 次` : '尚無換件記錄' },
        { label:'待診斷件數',  value: st.byStatus.received || 0, color:'warn', desc:'即將產生換件需求' },
      ];
      case 'prod': return [
        { label:'最高故障大類', value: ext.topCategory ? ext.topCategory[0] : '—', color:'warn', desc: ext.topCategory ? `${ext.topCategory[1]} 件` : '無資料' },
        { label:'最高故障機種', value: ext.topModel ? ext.topModel[0] : '—',     color:'red',  desc: ext.topModel ? `${ext.topModel[1]} 件` : '無資料' },
        { label:'報廢件數',    value: ext.scrapped,          color: ext.scrapped > 0 ? 'red' : 'ok', desc:'需分析製程根因' },
        { label:'本月結案',    value: ext.closedThisMonth,   color:'blue', desc:'本月完成件數' },
      ];
      case 'qa': return [
        { label:'重複序號',    value: ext.repeatSerials,     color: ext.repeatSerials > 0 ? 'red' : 'ok', desc:'同設備多次進廠' },
        { label:'保固內比例',  value: ext.warrantyInRate + '%', color: ext.warrantyInRate > 50 ? 'warn' : 'blue', desc:'設計/品質問題指標' },
        { label:'報廢件數',    value: ext.scrapped,          color: ext.scrapped > 0 ? 'red' : 'ok', desc:'本期累計報廢' },
        { label:'總案件基數',  value: st.total,              color:'blue', desc:'統計基礎母數' },
      ];
      case 'logistics': return [
        { label:'測試完可出貨', value: st.byStatus.testing || 0, color:'ok', desc:'等待安排出貨' },
        { label:'逾期超SLA',   value: st.overdue,            color: st.overdue > 0 ? 'red' : 'ok', desc:'超過承諾回覆日' },
        { label:'平均在廠天數', value: ext.avgCycleDays + '天', color:'blue', desc:'週轉效率' },
        { label:'本月已出貨',  value: ext.shippedThisMonth,  color:'ok', desc:'本月出貨件數' },
      ];
      case 'cs': return [
        { label:'逾期未回覆',  value: st.overdue,            color: st.overdue > 0 ? 'red' : 'ok', desc:'需主動聯繫客戶' },
        { label:'保固內案件',  value: ext.warrantyIn,        color:'blue', desc:'優先處理保固糾紛' },
        { label:'進行中案件',  value: st.open,               color:'warn', desc:'客戶等待回覆' },
        { label:'本月完成通知', value: ext.closedThisMonth,  color:'ok',  desc:'已完成結案' },
      ];
      case 'repair': return [
        { label:'待診斷',      value: st.byStatus.received || 0,   color:'blue', desc:'需分配技師' },
        { label:'診斷中',      value: st.byStatus.diagnosing || 0, color:'warn', desc:'技師進行中' },
        { label:'維修中',      value: st.byStatus.repairing || 0,  color:'warn', desc:'換件/調整中' },
        { label:'測試中',      value: st.byStatus.testing || 0,    color:'ok',   desc:'即將完工' },
      ];
      case 'hw': return [
        { label:'重複序號',    value: ext.repeatSerials,     color: ext.repeatSerials > 0 ? 'red' : 'ok', desc:'可能設計缺陷' },
        { label:'保固內比例',  value: ext.warrantyInRate + '%', color: ext.warrantyInRate > 50 ? 'red' : 'blue', desc:'設計問題指標' },
        { label:'最高故障機種', value: ext.topModel ? ext.topModel[0] : '—', color:'warn', desc: ext.topModel ? `${ext.topModel[1]} 件` : '無資料' },
        { label:'報廢率',      value: ext.scrapRate + '%',   color: ext.scrapRate > 10 ? 'red' : 'ok', desc:'硬體損壞程度' },
      ];
      case 'fw': return [
        { label:'疑似韌體故障', value: ext.swFaults,         color: ext.swFaults > 0 ? 'warn' : 'ok', desc:'含軟體關鍵字案件' },
        { label:'保固內案件',  value: ext.warrantyIn,        color:'blue', desc:'可能含韌體問題' },
        { label:'診斷+維修中', value: (st.byStatus.diagnosing || 0) + (st.byStatus.repairing || 0), color:'warn', desc:'可評估OTA修復' },
        { label:'已換件次數',  value: ext.totalParts,        color:'blue', desc:'可能是軟硬整合問題' },
      ];
      default: return [];
    }
  }

  function renderCellParts(c) {
    const parts = [...(c.diagnosis?.parts || []), ...(c.repair?.parts || [])];
    if (!parts.length) return '<span style="color:var(--text3)">—</span>';
    return parts.slice(0, 2).map(p =>
      `<span style="display:inline-block;background:var(--surface2);border-radius:4px;padding:1px 6px;margin:1px;font-family:var(--mono);font-size:11.5px">${esc(p.part)}×${p.qty}</span>`
    ).join('') + (parts.length > 2 ? `<span style="color:var(--text3);font-size:11px"> +${parts.length - 2}</span>` : '');
  }

  function renderCell(col, c, hi, today) {
    const open = !['shipped', 'scrapped', 'cancelled'].includes(c.status);
    const overdue = open && c.estimatedReturn && c.estimatedReturn < today;
    const hiCls = hi ? ' rma-col-hi' : '';
    switch (col) {
      case 'id':
        return `<td><span class="rma-id">${c.id}</span></td>`;
      case 'model':
        return `<td class="${hiCls}"><div class="rma-model" style="${hi ? 'color:inherit' : ''}">${esc(c.model)}</div>${c.serial ? `<div class="rma-serial">#${esc(c.serial)}</div>` : ''}</td>`;
      case 'category':
        return `<td class="${hiCls}"><span class="tag cat" style="--c:${CAT_COLOR[c.category] || '#64748b'}">${esc(c.category)}</span></td>`;
      case 'customer':
        return `<td class="${hiCls}"><div style="font-size:13px;font-weight:${hi ? '700' : '400'}">${esc(c.customer) || '<span style="color:var(--text3)">—</span>'}</div>${c.contactName ? `<div style="font-size:11.5px;color:var(--text3)">${esc(c.contactName)}</div>` : ''}</td>`;
      case 'issue':
        return `<td class="${hiCls}" style="max-width:200px"><div style="font-size:12.5px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.issueDesc) || '—'}</div></td>`;
      case 'warranty':
        return `<td class="${hiCls}"><span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${warrantyColor(c.warranty)}">${warrantyLabel(c.warranty)}</span></td>`;
      case 'receivedDate':
        return `<td><span style="font-family:var(--mono);font-size:12.5px;color:var(--text3)">${fmtDate(c.receivedDate)}</span></td>`;
      case 'estimatedReturn': {
        const od = c.estimatedReturn && c.estimatedReturn < today && open;
        return `<td class="${hiCls}"><span style="font-family:var(--mono);font-size:12.5px;font-weight:${hi ? '700' : '400'};color:${od ? 'var(--critical)' : c.estimatedReturn ? 'var(--text2)' : 'var(--text3)'}">${fmtDate(c.estimatedReturn)}</span>${od ? '<span style="display:block;font-size:10px;color:var(--critical)">⚠ 逾期</span>' : ''}</td>`;
      }
      case 'days': {
        const days = daysSince(c.receivedDate);
        return `<td><span style="font-family:var(--mono);font-size:13px;font-weight:${hi ? '700' : '400'};color:${overdue ? 'var(--critical)' : open ? 'var(--text2)' : 'var(--text3)'}">${days != null ? days + '天' : '—'}</span>${overdue && hi ? '<span style="display:block;font-size:10px;color:var(--critical)">逾期!</span>' : ''}</td>`;
      }
      case 'status': {
        const s = STATUS[c.status] || STATUS.received;
        return `<td><span class="rma-status-badge" style="--sc:${s.color}">${s.icon} ${s.label}</span></td>`;
      }
      case 'parts':
        return `<td class="${hiCls}"><div style="font-size:12px">${renderCellParts(c)}</div></td>`;
      case 'techName': {
        const tech = c.diagnosis?.techName || c.repair?.techName || '';
        return `<td class="${hiCls}"><span style="font-size:12.5px;color:${tech ? 'var(--text2)' : 'var(--text3)'};font-weight:${hi ? '700' : '400'}">${esc(tech) || '未分配'}</span></td>`;
      }
      default: return '<td></td>';
    }
  }

  // ─── UI State ───
  const state = {
    page: 'list',   // list | new | detail
    filter: { status: 'all', category: '全部', q: '' },
    role: 'all',
    detailId: null,
    editingDiagnosis: false,
    editingRepair: false,
  };

  // ─── Helpers ───
  const $ = id => document.getElementById(id);
  const CAT_COLOR = {
    '監視器':   '#38bdf8',
    '傳統保全': '#fb923c',
    '無線保全': '#10b981',
    '車機系統': '#a78bfa',
    'AED':      '#f472b6',
    '門禁':     '#facc15',
    '其他':     '#64748b',
  };

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(s) {
    if (!s) return '—';
    return s;
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const now = new Date();
    return Math.floor((now - d) / 86400000);
  }

  function warrantyLabel(w) {
    return w === 'in' ? '保固內' : w === 'out' ? '保固外' : '待確認';
  }

  function warrantyColor(w) {
    return w === 'in' ? 'var(--ok)' : w === 'out' ? 'var(--warn)' : 'var(--text3)';
  }

  // ─── Render ───
  function render() {
    const container = $('rmaContent');
    if (!container) return;

    if (state.page === 'new') {
      container.innerHTML = renderNewForm();
      bindNewForm();
    } else if (state.page === 'detail') {
      container.innerHTML = renderDetail(state.detailId);
      bindDetail();
    } else {
      container.innerHTML = renderList();
      bindList();
    }
  }

  // ── List page ──
  function renderList() {
    const allCases = load().cases;
    const st = stats();
    const ext = computeExtStats(allCases);
    const cases = listCases(state.filter);
    const today = new Date().toISOString().substring(0, 10);
    const role = state.role || 'all';
    const roleInfo = ROLES[role];
    const kpis = getRoleKPIs(role, allCases, ext, st);
    const colCfg = ROLE_COLS[role] || ROLE_COLS.all;

    const pipeStatuses = ['received', 'diagnosing', 'repairing', 'testing', 'shipped'];
    const pipeTotal = pipeStatuses.reduce((s, k) => s + (st.byStatus[k] || 0), 0) || 1;
    const showPipe = ['all', 'factory', 'repair', 'logistics'].includes(role);

    const statusTabs = [
      { key: 'all', label: '全部', count: st.total },
      ...Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, count: st.byStatus[k] || 0 })),
    ];

    return `
      <div class="rma-page">

        <!-- ── Header ── -->
        <div class="rma-page-h">
          <div>
            <div class="page-t">RMA 案件管理</div>
            <div class="page-d">故障品退修授權 · 追蹤維修狀態 · 建立客戶回報記錄</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn" onclick="RMA.exportToExcel()">⤓ 匯出 Excel</button>
            <button class="btn primary" onclick="RMA.goNew()">+ 新增 RMA</button>
          </div>
        </div>

        <!-- ── Role switcher ── -->
        <div class="rma-role-bar">
          ${Object.entries(ROLES).map(([k, r]) => `
            <button class="rma-role-chip ${role === k ? 'active' : ''}"
                    style="${role === k ? `--rc:${r.color}` : ''}"
                    onclick="RMA.setRole('${k}')" title="${r.desc}">
              <span class="rma-role-ico">${r.icon}</span>
              <span class="rma-role-label">${r.short}</span>
            </button>
          `).join('')}
        </div>

        <!-- ── Role context banner ── -->
        <div class="rma-role-banner" style="--rc:${roleInfo.color}">
          <span class="rma-role-banner-ico">${roleInfo.icon}</span>
          <div>
            <div class="rma-role-banner-t">${roleInfo.label} 視角</div>
            <div class="rma-role-banner-d">${roleInfo.desc}</div>
          </div>
        </div>

        <!-- ── KPI strip (dynamic per role) ── -->
        <div class="rma-kpi-row" style="grid-template-columns:repeat(${kpis.length},1fr)">
          ${kpis.map(k => `
            <div class="rma-kpi rma-kpi-${k.color}" style="--rc:${roleInfo.color}">
              <div class="rma-kpi-l">${k.label}</div>
              <div class="rma-kpi-v">${k.value}</div>
              <div class="rma-kpi-d">${k.desc}</div>
            </div>
          `).join('')}
        </div>

        <!-- ── Pipeline flow bar ── -->
        ${showPipe ? `
          <div class="rma-pipeline-bar">
            ${pipeStatuses.map(s => {
              const n = st.byStatus[s] || 0;
              const info = STATUS[s];
              const pct = Math.round(n / pipeTotal * 100);
              const isDone = s === 'shipped';
              return `
                <div class="rma-pipe-seg${isDone ? ' rma-pipe-seg-done' : ''}"
                     style="flex:${Math.max(n, 0.3)};--sc:${info.color}"
                     title="${info.label}：${n} 件 (${pct}%)">
                  <div class="rma-pipe-seg-bar"></div>
                  <div class="rma-pipe-seg-lbl">
                    <span>${info.icon}</span>
                    <span class="rma-pipe-seg-name">${info.label}</span>
                    <strong>${n}</strong>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        <!-- ── Status tabs ── -->
        <div class="rma-tabs">
          ${statusTabs.map(t => `
            <button class="rma-tab ${state.filter.status === t.key ? 'active' : ''}"
                    onclick="RMA.setFilter('status','${t.key}')">
              ${t.label} <span class="rma-tab-n">${t.count}</span>
            </button>
          `).join('')}
        </div>

        <!-- ── Toolbar ── -->
        <div class="rma-toolbar">
          <div class="rma-search-wrap">
            <span class="rma-search-ico">⌕</span>
            <input class="rma-search" id="rmaSearch" type="text"
              placeholder="搜尋案件號 · 機種 · 序號 · 客戶…"
              value="${esc(state.filter.q)}" oninput="RMA.setFilter('q',this.value)">
          </div>
          <select class="rma-select" onchange="RMA.setFilter('category',this.value)">
            <option value="全部" ${state.filter.category === '全部' ? 'selected' : ''}>全部大類</option>
            ${['監視器','傳統保全','無線保全','車機系統','AED','門禁','其他'].map(c =>
              `<option value="${c}" ${state.filter.category === c ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
          <div class="rma-col-hint">
            <span class="rma-col-hint-dot" style="background:${roleInfo.color}"></span>
            ${colCfg.hi.map(c => COL_DEFS[c]?.th || c).join(' · ')} 已強調
          </div>
        </div>

        <!-- ── Cases table ── -->
        ${cases.length === 0 ? `
          <div class="empty" style="padding:80px 24px">
            <div class="empty-ico">◌</div>
            <div class="empty-t">目前沒有符合條件的案件</div>
            <div style="margin-top:12px">
              <button class="btn primary" onclick="RMA.goNew()">+ 建立第一筆 RMA</button>
            </div>
          </div>
        ` : `
          <div class="rma-table-wrap">
            <table class="rma-table" style="min-width:560px">
              <thead>
                <tr>
                  ${colCfg.cols.map(col => {
                    const def = COL_DEFS[col];
                    if (!def) return '';
                    const hi = colCfg.hi.includes(col);
                    return `<th style="min-width:${def.w}${hi ? ';color:' + roleInfo.color : ''}">${def.th}${hi ? ' ●' : ''}</th>`;
                  }).join('')}
                  <th style="width:24px"></th>
                </tr>
              </thead>
              <tbody>
                ${cases.map(c => {
                  const open = !['shipped', 'scrapped', 'cancelled'].includes(c.status);
                  const overdue = open && c.estimatedReturn && c.estimatedReturn < today;
                  return `
                    <tr class="rma-row${overdue ? ' rma-row-overdue' : ''}" onclick="RMA.goDetail('${c.id}')">
                      ${colCfg.cols.map(col => renderCell(col, c, colCfg.hi.includes(col), today)).join('')}
                      <td><span style="color:var(--text3);font-size:12px">›</span></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          <div class="rma-count-hint">共 ${cases.length} 筆 · ${roleInfo.label}視角</div>
        `}
      </div>
    `;
  }


  // ── New form ──
  function renderNewForm() {
    const today = new Date().toISOString().substring(0, 10);
    return `
      <div class="rma-page">
        <div class="rma-page-h">
          <div>
            <button class="btn" style="margin-bottom:10px" onclick="RMA.goList()">← 返回列表</button>
            <div class="page-t">新增 RMA 案件</div>
          </div>
        </div>

        <div class="rma-form-card">
          <div class="rma-form-section">
            <div class="rma-form-section-t">設備資訊</div>
            <div class="rma-form-grid">
              <div class="rma-field">
                <label class="rma-label">機種品號 *</label>
                <input class="rma-input" id="fModel" type="text" placeholder="如 IP43A3Z" oninput="RMA.autofillCategory()">
              </div>
              <div class="rma-field">
                <label class="rma-label">序號</label>
                <input class="rma-input" id="fSerial" type="text" placeholder="機器序號（選填）">
              </div>
              <div class="rma-field">
                <label class="rma-label">大類</label>
                <select class="rma-input" id="fCategory">
                  ${['監視器','傳統保全','無線保全','車機系統','AED','門禁','其他'].map(c =>
                    `<option value="${c}">${c}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="rma-field">
                <label class="rma-label">保固狀態</label>
                <select class="rma-input" id="fWarranty">
                  <option value="unknown">待確認</option>
                  <option value="in">保固內</option>
                  <option value="out">保固外</option>
                </select>
              </div>
            </div>
          </div>

          <div class="rma-form-section">
            <div class="rma-form-section-t">客戶資訊</div>
            <div class="rma-form-grid">
              <div class="rma-field">
                <label class="rma-label">客戶 / 公司名稱</label>
                <input class="rma-input" id="fCustomer" type="text" placeholder="客戶或公司名稱">
              </div>
              <div class="rma-field">
                <label class="rma-label">聯絡人</label>
                <input class="rma-input" id="fContactName" type="text" placeholder="聯絡人姓名">
              </div>
              <div class="rma-field">
                <label class="rma-label">聯絡電話</label>
                <input class="rma-input" id="fContactPhone" type="text" placeholder="電話號碼">
              </div>
            </div>
          </div>

          <div class="rma-form-section">
            <div class="rma-form-section-t">故障說明</div>
            <div class="rma-field" style="grid-column:1/-1">
              <label class="rma-label">故障描述 *</label>
              <textarea class="rma-input rma-textarea" id="fIssueDesc" rows="4" placeholder="詳細描述故障現象、使用條件、客戶反映內容…"></textarea>
            </div>
          </div>

          <div class="rma-form-section">
            <div class="rma-form-section-t">時程 / 備註</div>
            <div class="rma-form-grid">
              <div class="rma-field">
                <label class="rma-label">收件日期</label>
                <input class="rma-input" id="fReceivedDate" type="date" value="${today}">
              </div>
              <div class="rma-field">
                <label class="rma-label">預計回覆日</label>
                <input class="rma-input" id="fEstimatedReturn" type="date">
              </div>
              <div class="rma-field">
                <label class="rma-label">負責人員</label>
                <input class="rma-input" id="fOperator" type="text" placeholder="建案人員名稱">
              </div>
            </div>
            <div class="rma-field" style="margin-top:14px">
              <label class="rma-label">備註</label>
              <textarea class="rma-input rma-textarea" id="fNotes" rows="2" placeholder="其他補充資訊…"></textarea>
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:8px">
            <button class="btn" onclick="RMA.goList()">取消</button>
            <button class="btn primary" id="fSubmit" onclick="RMA.submitNew()">建立 RMA 案件</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Detail page ──
  function renderDetail(id) {
    const c = getCase(id);
    if (!c) return `<div class="empty"><div class="empty-t">找不到案件 ${esc(id)}</div></div>`;
    const s = STATUS[c.status] || STATUS.received;
    const today = new Date().toISOString().substring(0, 10);
    const overdue = !['shipped','scrapped','cancelled'].includes(c.status) && c.estimatedReturn && c.estimatedReturn < today;
    const days = daysSince(c.receivedDate);
    const closed = ['shipped','scrapped','cancelled'].includes(c.status);

    // Status pipeline
    const pipelineHtml = STATUS_ORDER.map((sk, i) => {
      const sv = STATUS[sk];
      const done = STATUS_ORDER.indexOf(c.status) >= i || closed;
      const current = c.status === sk;
      return `
        <div class="rma-pipe-step ${done ? 'done' : ''} ${current ? 'current' : ''}">
          <div class="rma-pipe-dot">${done ? '✓' : sv.icon}</div>
          <div class="rma-pipe-label">${sv.label}</div>
        </div>
        ${i < STATUS_ORDER.length - 1 ? '<div class="rma-pipe-line"></div>' : ''}
      `;
    }).join('');

    // Next status button
    const curIdx = STATUS_ORDER.indexOf(c.status);
    const nextStatus = (!closed && curIdx >= 0 && curIdx < STATUS_ORDER.length - 1)
      ? STATUS_ORDER[curIdx + 1] : null;

    const actionButtons = closed
      ? `<button class="btn" onclick="RMA.reopenCase('${id}')">重新開啟</button>`
      : `
        ${nextStatus ? `<button class="btn primary" onclick="RMA.advance('${id}','${nextStatus}')">→ ${STATUS[nextStatus].label}</button>` : ''}
        <button class="btn" onclick="RMA.advance('${id}','scrapped')">報廢</button>
        <button class="btn danger" onclick="RMA.advance('${id}','cancelled')">取消案件</button>
      `;

    return `
      <div class="rma-page">
        <div class="rma-page-h" style="margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <button class="btn" onclick="RMA.goList()">← 返回列表</button>
            <div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span style="font-family:var(--mono);font-size:22px;font-weight:700;color:var(--accent)">${c.id}</span>
                <span class="rma-status-badge" style="--sc:${s.color}">${s.icon} ${s.label}</span>
                ${overdue ? `<span style="font-family:var(--mono);font-size:12px;color:var(--critical);padding:2px 8px;background:var(--critical-soft);border-radius:8px;font-weight:700">⚠ 已逾期</span>` : ''}
              </div>
              <div style="font-size:13px;color:var(--text3);margin-top:4px;font-family:var(--mono)">建案：${fmtDate(c.createdAt)} · 收件：${fmtDate(c.receivedDate)} · ${days != null ? days + ' 天' : ''}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="btn" onclick="RMA.printDetail('${id}')">⤓ 列印</button>
            ${actionButtons}
          </div>
        </div>

        <!-- Status pipeline -->
        <div class="rma-pipeline-wrap card" style="margin-bottom:20px;padding:20px 24px">
          <div class="rma-pipe">${pipelineHtml}</div>
          ${c.status === 'scrapped' ? `<div style="text-align:center;margin-top:10px;font-size:12px;color:var(--critical);font-weight:600">此案件已報廢</div>` : ''}
          ${c.status === 'cancelled' ? `<div style="text-align:center;margin-top:10px;font-size:12px;color:var(--text3)">此案件已取消</div>` : ''}
        </div>

        <div class="rma-detail-grid">
          <!-- Left: device + customer info -->
          <div>
            <div class="card rma-info-card" style="margin-bottom:16px">
              <div class="card-h"><div class="card-t">設備資訊</div>
                <button class="btn" style="font-size:12px;padding:5px 10px" onclick="RMA.editField('${id}','device')">編輯</button>
              </div>
              <div class="rma-info-rows" id="deviceInfo">
                ${infoRow('機種品號', c.model || '—', 'font-family:var(--mono);font-weight:700;font-size:15px')}
                ${infoRow('序號', c.serial ? '#' + c.serial : '—', 'font-family:var(--mono)')}
                ${infoRow('大類', `<span class="tag cat" style="--c:${CAT_COLOR[c.category] || '#64748b'}">${esc(c.category)}</span>`)}
                ${infoRow('保固狀態', `<span style="color:${warrantyColor(c.warranty)};font-weight:600">${warrantyLabel(c.warranty)}</span>`)}
              </div>
            </div>

            <div class="card rma-info-card" style="margin-bottom:16px">
              <div class="card-h"><div class="card-t">客戶資訊</div>
                <button class="btn" style="font-size:12px;padding:5px 10px" onclick="RMA.editField('${id}','customer')">編輯</button>
              </div>
              <div class="rma-info-rows">
                ${infoRow('客戶', c.customer || '—')}
                ${infoRow('聯絡人', c.contactName || '—')}
                ${infoRow('電話', c.contactPhone || '—', 'font-family:var(--mono)')}
              </div>
            </div>

            <div class="card rma-info-card" style="margin-bottom:16px">
              <div class="card-h"><div class="card-t">時程</div>
                <button class="btn" style="font-size:12px;padding:5px 10px" onclick="RMA.editField('${id}','schedule')">編輯</button>
              </div>
              <div class="rma-info-rows">
                ${infoRow('收件日', fmtDate(c.receivedDate))}
                ${infoRow('預計回覆', c.estimatedReturn ? fmtDate(c.estimatedReturn) + (overdue ? ' <span style="color:var(--critical);font-weight:600"> ⚠逾期</span>' : '') : '—')}
                ${infoRow('實際出貨', c.actualReturn ? fmtDate(c.actualReturn) : '—')}
                ${infoRow('天數', days != null ? `<span style="font-family:var(--mono)">${days} 天</span>` : '—')}
              </div>
            </div>
          </div>

          <!-- Right: issue + diagnosis + repair -->
          <div>
            <div class="card rma-info-card" style="margin-bottom:16px">
              <div class="card-h"><div class="card-t">故障描述</div>
                <button class="btn" style="font-size:12px;padding:5px 10px" onclick="RMA.editField('${id}','issue')">編輯</button>
              </div>
              <div style="font-size:14px;color:var(--text2);line-height:1.7;white-space:pre-wrap">${esc(c.issueDesc) || '<span style="color:var(--text3)">—</span>'}</div>
              ${c.notes ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12px;color:var(--text3)">${esc(c.notes)}</div>` : ''}
            </div>

            <!-- Diagnosis -->
            <div class="card rma-info-card" style="margin-bottom:16px" id="diagCard">
              <div class="card-h">
                <div class="card-t">診斷結果</div>
                <button class="btn" style="font-size:12px;padding:5px 10px" onclick="RMA.toggleEditSection('${id}','diag')">
                  ${state.editingDiagnosis ? '取消' : '填寫 / 編輯'}
                </button>
              </div>
              ${state.editingDiagnosis ? renderDiagnosisForm(c) : renderDiagnosisView(c)}
            </div>

            <!-- Repair -->
            <div class="card rma-info-card" style="margin-bottom:16px" id="repairCard">
              <div class="card-h">
                <div class="card-t">維修記錄</div>
                <button class="btn" style="font-size:12px;padding:5px 10px" onclick="RMA.toggleEditSection('${id}','repair')">
                  ${state.editingRepair ? '取消' : '填寫 / 編輯'}
                </button>
              </div>
              ${state.editingRepair ? renderRepairForm(c) : renderRepairView(c)}
            </div>
          </div>
        </div>

        <!-- Status history -->
        <div class="card" style="margin-top:4px">
          <div class="card-h"><div class="card-t">狀態歷程</div></div>
          <div class="rma-timeline">
            ${[...c.statusHistory].reverse().map(h => {
              const hs = STATUS[h.status] || STATUS.received;
              return `
                <div class="rma-tl-row">
                  <div class="rma-tl-dot" style="background:${hs.color}">${hs.icon}</div>
                  <div class="rma-tl-body">
                    <div class="rma-tl-title">${hs.label}</div>
                    ${h.note ? `<div class="rma-tl-note">${esc(h.note)}</div>` : ''}
                    <div class="rma-tl-meta">${h.date}${h.operator ? '  ·  ' + esc(h.operator) : ''}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function infoRow(label, value, style = '') {
    return `
      <div class="rma-info-row">
        <div class="rma-info-l">${label}</div>
        <div class="rma-info-v" ${style ? `style="${style}"` : ''}>${value}</div>
      </div>
    `;
  }

  function renderDiagnosisView(c) {
    const d = c.diagnosis;
    if (!d.faultContent && !d.techName && !d.parts.length) {
      return `<div class="empty" style="padding:20px 0"><div class="empty-t" style="font-size:12px">尚未填寫診斷資料</div></div>`;
    }
    return `
      <div>
        ${d.techName || d.diagDate ? `<div style="font-size:12px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">${esc(d.techName)}${d.diagDate ? '　' + d.diagDate : ''}</div>` : ''}
        ${d.faultContent ? `<div style="font-size:14px;color:var(--text2);margin-bottom:10px;white-space:pre-wrap">${esc(d.faultContent)}</div>` : ''}
        ${d.isScrap ? `<div style="color:var(--critical);font-weight:700;font-size:13px;margin-bottom:8px">⚠ 建議報廢</div>` : ''}
        ${d.parts.length ? `
          <div style="font-size:11px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px">更換零件</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${d.parts.map(p => `<span class="tag">${esc(p.part)} <span class="muted">×${p.qty}</span></span>`).join('')}
          </div>
        ` : ''}
        ${d.notes ? `<div style="margin-top:10px;font-size:12px;color:var(--text3)">${esc(d.notes)}</div>` : ''}
      </div>
    `;
  }

  function renderDiagnosisForm(c) {
    const d = c.diagnosis;
    return `
      <div class="rma-form-inner" id="diagForm">
        <div class="rma-form-grid" style="grid-template-columns:1fr 1fr">
          <div class="rma-field">
            <label class="rma-label">診斷人員</label>
            <input class="rma-input" id="dTech" type="text" value="${esc(d.techName)}" placeholder="技術員姓名">
          </div>
          <div class="rma-field">
            <label class="rma-label">診斷日期</label>
            <input class="rma-input" id="dDate" type="date" value="${d.diagDate || ''}">
          </div>
        </div>
        <div class="rma-field">
          <label class="rma-label">故障原因</label>
          <textarea class="rma-input rma-textarea" id="dContent" rows="3" placeholder="診斷出的故障原因、損壞零件…">${esc(d.faultContent)}</textarea>
        </div>
        <div class="rma-field">
          <label class="rma-label">更換零件（每行一筆，格式：零件名稱,數量）</label>
          <textarea class="rma-input rma-textarea" id="dParts" rows="3" placeholder="LMC-FPC-CABLE,1&#10;SENSOR-IR,2">${d.parts.map(p => `${p.part},${p.qty}`).join('\n')}</textarea>
        </div>
        <div class="rma-field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="dIsScrap" ${d.isScrap ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--critical)">
          <label for="dIsScrap" style="font-size:13px;color:var(--text2);cursor:pointer">建議報廢（無法修復）</label>
        </div>
        <div class="rma-field">
          <label class="rma-label">備註</label>
          <input class="rma-input" id="dNotes" type="text" value="${esc(d.notes)}" placeholder="其他補充">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn" onclick="RMA.toggleEditSection('${c.id}','diag')">取消</button>
          <button class="btn primary" onclick="RMA.saveDiagnosis('${c.id}')">儲存診斷</button>
        </div>
      </div>
    `;
  }

  function renderRepairView(c) {
    const r = c.repair;
    if (!r.notes && !r.techName && !r.parts.length) {
      return `<div class="empty" style="padding:20px 0"><div class="empty-t" style="font-size:12px">尚未填寫維修記錄</div></div>`;
    }
    return `
      <div>
        ${r.techName || r.repairDate ? `<div style="font-size:12px;color:var(--text3);margin-bottom:8px;font-family:var(--mono)">${esc(r.techName)}${r.repairDate ? '　' + r.repairDate : ''}</div>` : ''}
        ${r.parts.length ? `
          <div style="font-size:11px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px">更換零件</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            ${r.parts.map(p => `<span class="tag">${esc(p.part)} <span class="muted">×${p.qty}</span></span>`).join('')}
          </div>
        ` : ''}
        ${r.notes ? `<div style="font-size:14px;color:var(--text2);white-space:pre-wrap">${esc(r.notes)}</div>` : ''}
      </div>
    `;
  }

  function renderRepairForm(c) {
    const r = c.repair;
    return `
      <div class="rma-form-inner" id="repairForm">
        <div class="rma-form-grid" style="grid-template-columns:1fr 1fr">
          <div class="rma-field">
            <label class="rma-label">維修人員</label>
            <input class="rma-input" id="rTech" type="text" value="${esc(r.techName)}" placeholder="技術員姓名">
          </div>
          <div class="rma-field">
            <label class="rma-label">維修日期</label>
            <input class="rma-input" id="rDate" type="date" value="${r.repairDate || ''}">
          </div>
        </div>
        <div class="rma-field">
          <label class="rma-label">更換零件（每行一筆，格式：零件名稱,數量）</label>
          <textarea class="rma-input rma-textarea" id="rParts" rows="3" placeholder="LMC-FPC-CABLE,1&#10;SENSOR-IR,2">${r.parts.map(p => `${p.part},${p.qty}`).join('\n')}</textarea>
        </div>
        <div class="rma-field">
          <label class="rma-label">維修記錄 / 備註</label>
          <textarea class="rma-input rma-textarea" id="rNotes" rows="3" placeholder="維修過程、注意事項…">${esc(r.notes)}</textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn" onclick="RMA.toggleEditSection('${c.id}','repair')">取消</button>
          <button class="btn primary" onclick="RMA.saveRepair('${c.id}')">儲存維修記錄</button>
        </div>
      </div>
    `;
  }

  // ─── Bind events ───
  function bindList() {}
  function bindNewForm() {
    const input = $('fModel');
    if (input) input.focus();
  }
  function bindDetail() {}

  // ─── Actions ───
  function setFilter(key, val) {
    state.filter[key] = val;
    render();
  }

  function setRole(role) {
    state.role = role;
    render();
  }

  function goList() {
    state.page = 'list';
    state.detailId = null;
    state.editingDiagnosis = false;
    state.editingRepair = false;
    render();
  }

  function goNew() {
    state.page = 'new';
    render();
  }

  function goDetail(id) {
    state.page = 'detail';
    state.detailId = id;
    state.editingDiagnosis = false;
    state.editingRepair = false;
    render();
  }

  function autofillCategory() {
    const model = ($('fModel') || {}).value || '';
    const cat = getCategory(model);
    const sel = $('fCategory');
    if (sel) sel.value = cat;
  }

  function submitNew() {
    const model = ($('fModel') || {}).value || '';
    const issueDesc = ($('fIssueDesc') || {}).value || '';
    if (!model.trim()) { alert('請填寫機種品號'); return; }
    if (!issueDesc.trim()) { alert('請填寫故障描述'); return; }
    const c = createCase({
      model: model.trim(),
      serial: ($('fSerial') || {}).value || '',
      category: ($('fCategory') || {}).value || '其他',
      warranty: ($('fWarranty') || {}).value || 'unknown',
      customer: ($('fCustomer') || {}).value || '',
      contactName: ($('fContactName') || {}).value || '',
      contactPhone: ($('fContactPhone') || {}).value || '',
      issueDesc,
      receivedDate: ($('fReceivedDate') || {}).value || '',
      estimatedReturn: ($('fEstimatedReturn') || {}).value || null,
      operator: ($('fOperator') || {}).value || '',
      notes: ($('fNotes') || {}).value || '',
    });
    goDetail(c.id);
  }

  function advance(id, newStatus) {
    const note = prompt(`備註（選填）：`, '') ;
    if (note === null) return; // cancelled
    advanceStatus(id, newStatus, note, '');
    goDetail(id);
  }

  function reopenCase(id) {
    advanceStatus(id, 'received', '重新開啟案件', '');
    updateCase(id, { status: 'received', actualReturn: null });
    goDetail(id);
  }

  function toggleEditSection(id, section) {
    if (section === 'diag') state.editingDiagnosis = !state.editingDiagnosis;
    if (section === 'repair') state.editingRepair = !state.editingRepair;
    state.detailId = id;
    render();
  }

  function parseParts(text) {
    return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [part, qty] = l.split(',');
      return { part: (part || '').trim(), qty: parseFloat(qty) || 1 };
    }).filter(p => p.part);
  }

  function saveDiagnosis(id) {
    const diagnosis = {
      techName: ($('dTech') || {}).value || '',
      diagDate: ($('dDate') || {}).value || '',
      faultContent: ($('dContent') || {}).value || '',
      parts: parseParts(($('dParts') || {}).value),
      isScrap: !!($('dIsScrap') || {}).checked,
      notes: ($('dNotes') || {}).value || '',
    };
    updateCase(id, { diagnosis });
    state.editingDiagnosis = false;
    goDetail(id);
  }

  function saveRepair(id) {
    const repair = {
      techName: ($('rTech') || {}).value || '',
      repairDate: ($('rDate') || {}).value || '',
      parts: parseParts(($('rParts') || {}).value),
      notes: ($('rNotes') || {}).value || '',
    };
    updateCase(id, { repair });
    state.editingRepair = false;
    goDetail(id);
  }

  function editField(id, section) {
    const c = getCase(id);
    if (!c) return;

    let fields = '';
    if (section === 'device') {
      fields = `
        <div class="rma-form-grid">
          <div class="rma-field"><label class="rma-label">機種品號</label><input class="rma-input" id="ef_model" value="${esc(c.model)}"></div>
          <div class="rma-field"><label class="rma-label">序號</label><input class="rma-input" id="ef_serial" value="${esc(c.serial)}"></div>
          <div class="rma-field"><label class="rma-label">大類</label>
            <select class="rma-input" id="ef_category">
              ${['監視器','傳統保全','無線保全','車機系統','AED','門禁','其他'].map(cat =>
                `<option value="${cat}" ${c.category===cat?'selected':''}>${cat}</option>`
              ).join('')}
            </select>
          </div>
          <div class="rma-field"><label class="rma-label">保固</label>
            <select class="rma-input" id="ef_warranty">
              <option value="unknown" ${c.warranty==='unknown'?'selected':''}>待確認</option>
              <option value="in" ${c.warranty==='in'?'selected':''}>保固內</option>
              <option value="out" ${c.warranty==='out'?'selected':''}>保固外</option>
            </select>
          </div>
        </div>
      `;
    } else if (section === 'customer') {
      fields = `
        <div class="rma-form-grid">
          <div class="rma-field"><label class="rma-label">客戶</label><input class="rma-input" id="ef_customer" value="${esc(c.customer)}"></div>
          <div class="rma-field"><label class="rma-label">聯絡人</label><input class="rma-input" id="ef_contactName" value="${esc(c.contactName)}"></div>
          <div class="rma-field"><label class="rma-label">電話</label><input class="rma-input" id="ef_contactPhone" value="${esc(c.contactPhone)}"></div>
        </div>
      `;
    } else if (section === 'schedule') {
      fields = `
        <div class="rma-form-grid">
          <div class="rma-field"><label class="rma-label">收件日</label><input class="rma-input" id="ef_receivedDate" type="date" value="${c.receivedDate}"></div>
          <div class="rma-field"><label class="rma-label">預計回覆</label><input class="rma-input" id="ef_estimatedReturn" type="date" value="${c.estimatedReturn||''}"></div>
          <div class="rma-field"><label class="rma-label">實際出貨</label><input class="rma-input" id="ef_actualReturn" type="date" value="${c.actualReturn||''}"></div>
        </div>
      `;
    } else if (section === 'issue') {
      fields = `
        <div class="rma-field"><label class="rma-label">故障描述</label><textarea class="rma-input rma-textarea" id="ef_issueDesc" rows="4">${esc(c.issueDesc)}</textarea></div>
        <div class="rma-field" style="margin-top:10px"><label class="rma-label">備註</label><textarea class="rma-input rma-textarea" id="ef_notes" rows="2">${esc(c.notes)}</textarea></div>
      `;
    }

    // Modal popup
    showModal('編輯資訊', `
      <div style="padding:4px 0">${fields}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn" onclick="RMA.closeModal()">取消</button>
        <button class="btn primary" onclick="RMA.saveEditField('${id}','${section}')">儲存</button>
      </div>
    `);
  }

  function saveEditField(id, section) {
    const patch = {};
    if (section === 'device') {
      patch.model = ($('ef_model')||{}).value || '';
      patch.serial = ($('ef_serial')||{}).value || '';
      patch.category = ($('ef_category')||{}).value || '其他';
      patch.warranty = ($('ef_warranty')||{}).value || 'unknown';
    } else if (section === 'customer') {
      patch.customer = ($('ef_customer')||{}).value || '';
      patch.contactName = ($('ef_contactName')||{}).value || '';
      patch.contactPhone = ($('ef_contactPhone')||{}).value || '';
    } else if (section === 'schedule') {
      patch.receivedDate = ($('ef_receivedDate')||{}).value || '';
      patch.estimatedReturn = ($('ef_estimatedReturn')||{}).value || null;
      patch.actualReturn = ($('ef_actualReturn')||{}).value || null;
    } else if (section === 'issue') {
      patch.issueDesc = ($('ef_issueDesc')||{}).value || '';
      patch.notes = ($('ef_notes')||{}).value || '';
    }
    updateCase(id, patch);
    closeModal();
    goDetail(id);
  }

  // ─── Modal ───
  function showModal(title, bodyHtml) {
    let el = $('rmaModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rmaModal';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="rma-modal-mask" onclick="RMA.closeModal()"></div>
      <div class="rma-modal">
        <div class="rma-modal-h">
          <div class="rma-modal-t">${esc(title)}</div>
          <button class="drawer-close" onclick="RMA.closeModal()">✕</button>
        </div>
        <div class="rma-modal-body">${bodyHtml}</div>
      </div>
    `;
    el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const el = $('rmaModal');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    document.body.style.overflow = '';
  }

  // ─── Export to Excel ───
  function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('XLSX 函式庫未載入'); return; }
    const cases = listCases(state.filter);
    if (!cases.length) { alert('目前沒有可匯出的案件'); return; }

    const header = ['案件號','建案日','機種','序號','大類','客戶','聯絡人','電話','保固','收件日','預計回覆','實際出貨','狀態','故障描述','診斷結果','維修記錄','備註'];
    const rows = cases.map(c => [
      c.id, c.createdAt, c.model, c.serial, c.category,
      c.customer, c.contactName, c.contactPhone,
      warrantyLabel(c.warranty),
      c.receivedDate, c.estimatedReturn || '', c.actualReturn || '',
      STATUS[c.status]?.label || c.status,
      c.issueDesc,
      c.diagnosis?.faultContent || '',
      c.repair?.notes || '',
      c.notes,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      {wch:16},{wch:10},{wch:12},{wch:14},{wch:8},
      {wch:16},{wch:10},{wch:14},{wch:8},
      {wch:10},{wch:10},{wch:10},{wch:8},
      {wch:36},{wch:36},{wch:36},{wch:24},
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RMA案件列表');

    const now = new Date();
    const ds = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `RMA案件清單_${ds}.xlsx`);
  }

  // ─── Print detail ───
  function printDetail(id) {
    const c = getCase(id);
    if (!c) return;
    const s = STATUS[c.status] || STATUS.received;
    const w = window.open('', '_blank');
    if (!w) { alert('彈出視窗被阻擋'); return; }
    w.document.write(`<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
    <title>RMA ${c.id}</title>
    <style>
      body{font-family:'Noto Sans TC',sans-serif;color:#1e293b;padding:24px;font-size:13px}
      h1{font-size:22px;margin-bottom:4px}
      .meta{color:#64748b;font-size:12px;margin-bottom:20px;font-family:monospace}
      .section{margin-bottom:16px}
      .section h2{font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:8px}
      table{width:100%;border-collapse:collapse}
      td,th{padding:6px 8px;border:1px solid #e2e8f0;font-size:12px;vertical-align:top}
      th{background:#f8fafc;font-weight:600;width:140px}
      .status{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:700;background:#f1f5f9}
      @media print{@page{margin:12mm}}
    </style></head><body>
    <h1>RMA 維修授權單 — ${c.id}</h1>
    <div class="meta">建案：${c.createdAt}　收件：${c.receivedDate}　狀態：${s.label}　列印：${new Date().toLocaleDateString('zh-TW')}</div>
    <div class="section"><h2>設備 / 客戶</h2>
    <table><tr><th>機種品號</th><td>${c.model}</td><th>序號</th><td>${c.serial||'—'}</td></tr>
    <tr><th>大類</th><td>${c.category}</td><th>保固</th><td>${warrantyLabel(c.warranty)}</td></tr>
    <tr><th>客戶</th><td>${c.customer||'—'}</td><th>聯絡人</th><td>${c.contactName||'—'}</td></tr>
    <tr><th>電話</th><td colspan="3">${c.contactPhone||'—'}</td></tr></table></div>
    <div class="section"><h2>故障描述</h2><p>${c.issueDesc||'—'}</p></div>
    <div class="section"><h2>診斷結果</h2>
    <p>${c.diagnosis?.faultContent||'—'}</p>
    ${c.diagnosis?.parts?.length?`<p>更換零件：${c.diagnosis.parts.map(p=>p.part+'×'+p.qty).join('、')}</p>`:''}
    </div>
    <div class="section"><h2>維修記錄</h2>
    <p>${c.repair?.notes||'—'}</p>
    ${c.repair?.parts?.length?`<p>更換零件：${c.repair.parts.map(p=>p.part+'×'+p.qty).join('、')}</p>`:''}
    </div>
    <div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
      <div style="border-top:1px solid #cbd5e1;padding-top:8px">收件確認：</div>
      <div style="border-top:1px solid #cbd5e1;padding-top:8px">維修技術員：</div>
      <div style="border-top:1px solid #cbd5e1;padding-top:8px">出貨確認：</div>
    </div>
    <script>setTimeout(()=>window.print(),600)<\/script></body></html>`);
    w.document.close();
  }

  // ─── Init ───
  function init() {
    render();
  }

  return {
    init, render, goList, goNew, goDetail,
    setFilter, setRole, autofillCategory, submitNew,
    advance, reopenCase,
    toggleEditSection, saveDiagnosis, saveRepair,
    editField, saveEditField,
    showModal, closeModal,
    exportToExcel, printDetail,
    // exposed for external callers
    stats, listCases, getCase,
  };
})();
