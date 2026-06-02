// ════════════════════════════════════════════════════════════════════
// Executive Summary Report Generator
// Builds a print-ready HTML document and opens it in a new tab.
// User presses Cmd+P / Ctrl+P to save as PDF.
// ════════════════════════════════════════════════════════════════════

(function () {

  const CAT_COLOR = {
    '監視器':   '#0ea5e9',
    '傳統保全': '#ea580c',
    '無線保全': '#059669',
    '車機系統': '#7c3aed',
    'AED':      '#db2777',
    '門禁':     '#ca8a04',
    '其他':     '#475569',
  };

  function fmtMonth(mk) {
    if (!mk) return '';
    const [y, m] = mk.split('-');
    return `${parseInt(y, 10) - 1911}/${m}`;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function generate(db, roleCtx) {
    roleCtx = roleCtx || null;
    const months = Object.keys(db.months).sort();
    if (!months.length) return alert('沒有資料可生成報告');

    const latestMonth = months[months.length - 1];
    const prevMonth = months.length >= 2 ? months[months.length - 2] : null;

    // === Aggregate ALL months for executive summary ===
    const allRecords = RepairAnalyzer.getRecords(db, { months });
    const allDenom = RepairAnalyzer.getDenominators(db, { months });
    const allKpis = RepairAnalyzer.computeKPIs(allRecords, allDenom);

    // === Latest month only ===
    const curRecords = RepairAnalyzer.getRecords(db, { months: [latestMonth] });
    const curDenom = RepairAnalyzer.getDenominators(db, { months: [latestMonth] });
    const curKpis = RepairAnalyzer.computeKPIs(curRecords, curDenom);

    // Previous month for delta
    let prevKpis = null;
    if (prevMonth) {
      const prevRecords = RepairAnalyzer.getRecords(db, { months: [prevMonth] });
      const prevDenom = RepairAnalyzer.getDenominators(db, { months: [prevMonth] });
      prevKpis = RepairAnalyzer.computeKPIs(prevRecords, prevDenom);
    }

    // === Anomalies (latest month) ===
    const anomalies = RepairAnalyzer.detectAnomalies(db, latestMonth);
    const critical = anomalies.filter(a => a.severity === 'critical');
    const warn = anomalies.filter(a => a.severity === 'warn');

    // === Model rank (latest month) ===
    const modelRank = RepairAnalyzer.modelRank(curRecords, curDenom).slice(0, 10);

    // === Top parts (latest month) ===
    const topParts = RepairAnalyzer.partPareto(curRecords).slice(0, 15);

    // === Cross-month repeated serials ===
    const crossMonth = RepairAnalyzer.crossMonthSerials(db, {});

    // === Trend across all months ===
    const trend = RepairAnalyzer.monthlyTrend(db, {});

    // === Build delta info ===
    const delta = prevKpis ? {
      count: curKpis.totalRepairs - prevKpis.totalRepairs,
      countPct: prevKpis.totalRepairs ? ((curKpis.totalRepairs - prevKpis.totalRepairs) / prevKpis.totalRepairs * 100) : 0,
      scrap: curKpis.scrap - prevKpis.scrap,
      faultRate: curKpis.denomPct - prevKpis.denomPct,
    } : null;

    const fontScale = (function(){ try { return localStorage.getItem('titan_display_size') || 'md'; } catch(e) { return 'md'; } })();
    const html = buildHTML({
      months, latestMonth, prevMonth,
      curKpis, prevKpis, allKpis, delta,
      anomalies, critical, warn,
      modelRank, topParts, crossMonth, trend,
      reportDate: new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' }),
      fontScale,
      roleTitle: roleCtx ? (roleCtx.roleTitle || (roleCtx.roleInfo && roleCtx.roleInfo.label) || null) : null,
      roleItems: roleCtx ? roleCtx.items : null,
      isAllRole: roleCtx ? (roleCtx.isAllRole !== undefined ? roleCtx.isAllRole : (roleCtx.role === 'all')) : true,
    });

    // Open in new tab
    const w = window.open('', '_blank');
    if (!w) {
      alert('彈出視窗被阻擋，請允許後再試一次');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  function buildHTML(d) {
    const monthLabel = fmtMonth(d.latestMonth);
    const sevLabel = { critical: '嚴重', warn: '注意', info: '資訊' };

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>維修月度總結 · ${monthLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 14mm 12mm; }
  html, body { font-family: 'Inter', 'Noto Sans TC', system-ui, sans-serif; color: #1e293b; line-height: 1.6; background: #f8fafc; font-size: ${d.fontScale === 'lg' ? '23px' : d.fontScale === 'sm' ? '14px' : '16px'}; }
  body { padding: 16px; }
  .doc { max-width: 100%; background: white; padding: 32px 40px; box-shadow: none; }
  @media (min-width: 1100px) { .doc { padding: 40px 60px; } }
  @media (max-width: 700px) {
    body { padding: 0; }
    .doc { padding: 20px 16px; }
    .trend-grid { grid-template-columns: 1fr; }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  }
  @media print {
    body { background: white; padding: 0; }
    .doc { box-shadow: none; padding: 0; max-width: none; }
    .pagebreak { page-break-before: always; }
    .no-print { display: none !important; }
    .print-btn { display: none !important; }
  }

  /* Print button */
  .print-btn {
    position: fixed; top: 20px; right: 20px;
    background: #0ea5e9; color: white;
    padding: 12px 24px; border-radius: 8px; border: none;
    font-size: 0.93em; font-weight: 700; cursor: pointer;
    font-family: inherit;
    box-shadow: 0 4px 12px rgba(14,165,233,.3);
    z-index: 100;
  }
  .print-btn:hover { background: #0284c7; }

  /* Cover */
  .cover {
    border-bottom: 3px solid #0ea5e9;
    padding-bottom: 24px; margin-bottom: 32px;
  }
  .cover-overline {
    font-size: 0.75em; color: #64748b; letter-spacing: .18em; text-transform: uppercase;
    font-weight: 700; margin-bottom: 8px;
  }
  .cover-title { font-size: 2em; font-weight: 700; letter-spacing: -.02em; margin-bottom: 6px; color: #0f172a; }
  .cover-sub { font-size: 0.9em; color: #475569; font-family: 'JetBrains Mono', monospace; }
  .cover-meta {
    margin-top: 14px; display: flex; gap: 20px; flex-wrap: wrap;
    font-size: 0.8em; color: #64748b;
  }
  .cover-meta span { font-family: 'JetBrains Mono', monospace; }

  /* Section heading */
  h2.sec {
    font-size: 1.07em; color: #0f172a;
    margin: 32px 0 14px;
    padding-bottom: 8px; border-bottom: 1.5px solid #e2e8f0;
    letter-spacing: -.01em; font-weight: 700;
    display: flex; align-items: center; gap: 8px;
  }
  h2.sec::before {
    content: ''; width: 4px; height: 16px; background: #0ea5e9; border-radius: 2px;
  }
  h2.sec .meta { margin-left: auto; font-size: 0.75em; color: #94a3b8; font-weight: 400; letter-spacing: .04em; }

  /* KPI grid */
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  @media (max-width: 600px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
  .kpi {
    background: #f8fafc; border: 1px solid #e2e8f0;
    padding: 16px 18px; border-radius: 8px;
    border-left: 3px solid #0ea5e9;
  }
  .kpi.warn { border-left-color: #f59e0b; }
  .kpi.bad { border-left-color: #ef4444; }
  .kpi-l {
    font-size: 0.72em; color: #64748b; letter-spacing: .1em;
    text-transform: uppercase; font-weight: 700; margin-bottom: 8px;
  }
  .kpi-v {
    font-family: 'JetBrains Mono', monospace; font-size: 1.75em;
    font-weight: 700; line-height: 1; letter-spacing: -.02em; color: #0f172a;
  }
  .kpi-d {
    margin-top: 8px; font-size: 0.78em; color: #64748b;
    display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  }
  .kpi-d .pct { color: #0f172a; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
  .kpi-d .delta {
    font-family: 'JetBrains Mono', monospace; font-size: 0.72em;
    padding: 2px 6px; border-radius: 8px; font-weight: 700;
  }
  .kpi-d .delta.up { color: #ef4444; background: #fef2f2; }
  .kpi-d .delta.down { color: #059669; background: #f0fdf4; }
  .kpi-d .delta.flat { color: #64748b; background: #f1f5f9; }

  /* Executive summary box */
  .exec {
    background: linear-gradient(135deg, #0c4a6e, #075985);
    color: white; padding: 24px 28px; border-radius: 10px;
    margin: 20px 0;
  }
  .exec-h {
    font-size: 0.75em; color: #7dd3fc; letter-spacing: .14em; text-transform: uppercase;
    font-weight: 700; margin-bottom: 12px;
  }
  .exec-body { font-size: 1em; line-height: 1.8; color: #f0f9ff; }
  .exec-body strong { color: white; font-weight: 700; }

  /* Anomaly card */
  .anom-list { display: flex; flex-direction: column; gap: 8px; }
  .anom {
    border: 1px solid #e2e8f0;
    border-left: 3px solid #94a3b8;
    border-radius: 6px; padding: 12px 16px;
    display: grid; grid-template-columns: 1fr 60px; gap: 16px;
    align-items: center;
  }
  .anom.critical { border-left-color: #ef4444; background: #fef2f2; }
  .anom.warn { border-left-color: #f59e0b; background: #fffbeb; }
  .anom.info { border-left-color: #6366f1; background: #eef2ff; }
  .anom-l { min-width: 0; }
  .anom-h { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .anom-t { font-size: 0.72em; color: #475569; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; }
  .anom-sev {
    font-family: 'JetBrains Mono', monospace; font-size: 0.65em;
    padding: 1px 6px; border-radius: 4px; font-weight: 700; letter-spacing: .04em;
  }
  .anom.critical .anom-sev { background: #fecaca; color: #991b1b; }
  .anom.warn .anom-sev { background: #fde68a; color: #92400e; }
  .anom.info .anom-sev { background: #c7d2fe; color: #3730a3; }
  .anom-s { font-size: 0.93em; font-weight: 700; color: #0f172a; margin-bottom: 2px; word-break: break-word; }
  .anom-m { font-size: 0.8em; color: #475569; font-family: 'JetBrains Mono', monospace; }
  .anom-r {
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
  }
  .anom-metric { font-size: 1.45em; font-weight: 700; line-height: 1; }
  .anom.critical .anom-metric { color: #dc2626; }
  .anom.warn .anom-metric { color: #d97706; }
  .anom.info .anom-metric { color: #4f46e5; }
  .anom-mlabel { font-size: 0.67em; color: #64748b; margin-top: 3px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
  thead th {
    text-align: left; padding: 10px 12px; font-size: 0.72em;
    letter-spacing: .08em; text-transform: uppercase; color: #64748b; font-weight: 700;
    border-bottom: 1.5px solid #cbd5e1; background: #f1f5f9;
  }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  .num { font-family: 'JetBrains Mono', monospace; }
  .right { text-align: right; }
  .center { text-align: center; }
  .muted { color: #94a3b8; }

  .bar { display: inline-block; height: 4px; background: #0ea5e9; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  .tag {
    display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 0.67em;
    padding: 1px 6px; border-radius: 8px; background: #f1f5f9; color: #475569;
    border: 1px solid #e2e8f0; white-space: nowrap;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 0.67em; padding: 1px 6px; border-radius: 8px;
    font-weight: 600;
  }
  .pill.crit { background: #fee2e2; color: #991b1b; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.ok { background: #d1fae5; color: #065f46; }
  .pill::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

  /* Trend chart (SVG) */
  .trend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .trend-card {
    border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;
  }
  .trend-card h3 {
    font-size: 0.73em; letter-spacing: .1em; text-transform: uppercase;
    color: #64748b; font-weight: 700; margin-bottom: 12px;
  }
  .trend-svg { width: 100%; height: 120px; }

  /* Cross-month detail */
  .cm-row {
    border: 1px solid #e2e8f0; border-left: 3px solid #ef4444;
    border-radius: 6px; padding: 12px 16px; margin-bottom: 8px;
    background: #fef2f2;
  }
  .cm-row.warn { border-left-color: #f59e0b; background: #fffbeb; }
  .cm-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .cm-id { font-family: 'JetBrains Mono', monospace; font-size: 0.87em; font-weight: 700; color: #0f172a; }
  .cm-id .ser { color: #64748b; font-weight: 500; }
  .cm-months { display: flex; gap: 4px; }
  .cm-month {
    font-family: 'JetBrains Mono', monospace; font-size: 0.67em; padding: 2px 7px; border-radius: 8px;
    background: #fecaca; color: #991b1b; font-weight: 700;
  }
  .cm-row.warn .cm-month { background: #fde68a; color: #92400e; }
  .cm-visits { font-size: 0.77em; color: #475569; font-family: 'JetBrains Mono', monospace; line-height: 1.7; }

  /* Role action cards */
  .role-section { margin: 20px 0; }
  .role-section-h {
    font-size: 0.75em; color: #64748b; letter-spacing: .14em; text-transform: uppercase;
    font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
  }
  .role-cards { display: flex; flex-direction: column; gap: 8px; }
  .role-card {
    border: 1px solid #e2e8f0; border-left: 3px solid #94a3b8;
    border-radius: 6px; padding: 12px 16px;
  }
  .role-card.critical { border-left-color: #ef4444; background: #fef2f2; }
  .role-card.warn { border-left-color: #f59e0b; background: #fffbeb; }
  .role-card.info { border-left-color: #6366f1; background: #eef2ff; }
  .role-card-area { font-size: 0.7em; color: #64748b; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; margin-bottom: 3px; }
  .role-card-title { font-size: 0.92em; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
  .role-card-detail { font-size: 0.8em; color: #475569; }
  .role-card-action { font-size: 0.78em; color: #0369a1; margin-top: 5px; font-style: italic; }

  /* Footer */
  .footer {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0;
    font-size: 0.7em; color: #94a3b8; display: flex; justify-content: space-between;
  }

  /* Helpers */
  .strip {
    display: flex; gap: 16px; align-items: center;
    padding: 12px 16px; background: #f1f5f9; border-radius: 8px; margin-bottom: 12px;
    font-size: 0.83em; color: #475569;
  }
  .strip strong { color: #0f172a; }
</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">⤓ 列印 / 儲存為 PDF</button>

<div class="doc">

  <!-- COVER -->
  <div class="cover">
    <div class="cover-overline">維修月度總結報告</div>
    <div class="cover-title">${monthLabel} 維修分析摘要${d.roleTitle ? `（${escapeHtml(d.roleTitle)}）` : ''}</div>
    <div class="cover-sub">電子工廠 · 報廢與維修狀態總覽</div>
    <div class="cover-meta">
      <span>生成日期：${d.reportDate}</span>
      <span>資料範圍：${fmtMonth(d.months[0])} – ${monthLabel}（${d.months.length} 個月）</span>
      <span>總紀錄：${d.allKpis.totalRepairs.toLocaleString()} 筆</span>
    </div>
  </div>

  <!-- Executive summary -->
  <div class="exec">
    <div class="exec-h">本月重點摘要</div>
    <div class="exec-body">
      ${buildExecutiveSummary(d)}
    </div>
  </div>

  ${d.roleItems && d.roleItems.length ? `
  <!-- Role-specific findings -->
  <div class="role-section">
    <div class="role-section-h">${d.roleTitle ? escapeHtml(d.roleTitle) + ' · ' : ''}應關注事項（${d.roleItems.length} 項）</div>
    <div class="role-cards">
      ${d.roleItems.slice(0, 12).map(item => `
        <div class="role-card ${item.sev || ''}">
          <div class="role-card-area">${escapeHtml(item.area || '')} ${item.icon || ''}</div>
          <div class="role-card-title">${escapeHtml(item.title || '')}</div>
          ${item.detail ? `<div class="role-card-detail">${escapeHtml(item.detail)}</div>` : ''}
          ${item.action ? `<div class="role-card-action">→ ${escapeHtml(item.action)}</div>` : ''}
        </div>`).join('')}
    </div>
  </div>` : ''}

  <!-- KPIs -->
  <h2 class="sec">本月關鍵指標 <span class="meta">${monthLabel}</span></h2>
  <div class="kpi-row">
    ${kpiCard('總維修件數', d.curKpis.totalRepairs, `佔整新數 <span class="pct">${d.curKpis.denomPct.toFixed(1)}%</span><span class="muted">/ ${d.curKpis.denomTotal.toLocaleString()}</span>`, deltaPill(d.delta?.count, '上月'))}
    ${kpiCard('受檢機種', d.curKpis.models, '<span class="muted">機種</span>', '')}
    ${kpiCard('報廢件數', d.curKpis.scrap, `報廢率 <span class="pct">${d.curKpis.scrapPct.toFixed(1)}%</span>`, deltaPill(d.delta?.scrap, '上月'), d.curKpis.scrapPct >= 10 ? 'bad' : d.curKpis.scrapPct >= 5 ? 'warn' : '')}
    ${kpiCard('重複維修', d.curKpis.repeatedSerials, '<span class="muted">同序號 ≥ 2 次</span>', '')}
  </div>

  ${d.critical.length || d.warn.length ? `
  <h2 class="sec">需立即關注 <span class="meta">${d.critical.length + d.warn.length} 筆警示</span></h2>
  <div class="anom-list">
    ${d.critical.slice(0, 6).map(anomCard).join('')}
    ${d.warn.slice(0, 6 - Math.min(d.critical.length, 6)).map(anomCard).join('')}
  </div>` : ''}

  ${d.crossMonth.length ? `
  <h2 class="sec">跨月份重複維修 <span class="meta">${d.crossMonth.length} 台機台</span></h2>
  <div class="strip">
    <strong>${d.crossMonth.length}</strong> 台機台在 ≥ 2 個月份出現維修紀錄。可能為治標未治本、設計缺陷或客戶使用問題。建議列入下月重點檢討。
  </div>
  ${d.crossMonth.slice(0, 10).map(crossMonthCard).join('')}
  ${d.crossMonth.length > 10 ? `<div style="text-align:center;font-size:0.80em;color:#94a3b8;margin-top:8px">…另有 ${d.crossMonth.length - 10} 台未顯示</div>` : ''}
  ` : ''}

  <div class="pagebreak"></div>

  <!-- Trend -->
  ${d.trend.length >= 2 ? `
  <h2 class="sec">月份趨勢 <span class="meta">${d.trend.length} 個月</span></h2>
  <div class="trend-grid">
    <div class="trend-card">
      <h3>維修件數</h3>
      ${trendSvg(d.trend.map(t => ({ label: fmtMonth(t.month), value: t.count })), '#0ea5e9')}
    </div>
    <div class="trend-card">
      <h3>故障率 (件數 / 整新數)</h3>
      ${trendSvg(d.trend.map(t => ({ label: fmtMonth(t.month), value: t.faultPct })), '#f59e0b', '%')}
    </div>
  </div>
  ` : ''}

  <!-- Top models -->
  <h2 class="sec">機種故障排名 <span class="meta">本月前 10</span></h2>
  <div class="table-wrap"><table>
    <thead><tr>
      <th style="width:32px">#</th>
      <th>機種</th>
      <th>大類</th>
      <th class="right">件數</th>
      <th class="right">整新數</th>
      <th class="right">故障率</th>
      <th class="right">報廢</th>
      <th>主要故障內容</th>
    </tr></thead>
    <tbody>
      ${d.modelRank.map((r, i) => `
        <tr>
          <td class="num muted">${i + 1}</td>
          <td><strong class="num">${escapeHtml(r.model)}</strong></td>
          <td><span class="tag" style="border-color:${CAT_COLOR[r.category] || '#94a3b8'}33;color:${CAT_COLOR[r.category] || '#475569'}">${r.category}</span></td>
          <td class="right num">${r.count}</td>
          <td class="right num muted">${r.denom || '—'}</td>
          <td class="right">${r.faultRate != null ? `<span class="pill ${r.faultRate >= 0.1 ? 'crit' : r.faultRate >= 0.05 ? 'warn' : 'ok'}">${(r.faultRate * 100).toFixed(1)}%</span>` : '<span class="muted">—</span>'}</td>
          <td class="right num">${r.scrap || '<span class="muted">0</span>'}</td>
          <td class="muted" style="font-size:0.82em">${r.topContents.slice(0, 2).map(c => `${escapeHtml(c.name)} <span class="muted">×${c.count}</span>`).join('・') || '—'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table></div>

  <!-- Top parts -->
  <h2 class="sec">本月最常更換零件 <span class="meta">前 15</span></h2>
  <div class="table-wrap"><table>
    <thead><tr>
      <th style="width:32px">#</th>
      <th>零件名稱</th>
      <th>影響機種</th>
      <th class="right">件數</th>
      <th style="width:160px">佔比</th>
    </tr></thead>
    <tbody>
      ${d.topParts.map((p, i) => `
        <tr>
          <td class="num muted">${i + 1}</td>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>
            <span class="tag">${p.models.length} 機種</span>
            <span style="font-size:0.78em;color:#94a3b8;font-family:'JetBrains Mono',monospace;margin-left:4px">${p.models.slice(0, 3).join(', ')}${p.models.length > 3 ? '…' : ''}</span>
          </td>
          <td class="right num"><strong>${p.count}</strong></td>
          <td>
            <span class="bar" style="width:${Math.max(8, p.pct * 100 * 2)}px;background:${i < 3 ? '#ef4444' : i < 7 ? '#f59e0b' : '#0ea5e9'}"></span>
            <span class="num" style="font-size:0.80em;color:#475569">${(p.pct * 100).toFixed(1)}%</span>
            <span class="muted" style="font-size:0.75em;margin-left:6px">累計 ${(p.cumPct * 100).toFixed(0)}%</span>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table></div>

  <div class="footer">
    <span>維修分析報表 · ${d.reportDate}</span>
    <span class="num">${d.allKpis.totalRepairs.toLocaleString()} 筆總紀錄 · ${d.months.length} 個月份累積</span>
  </div>
</div>

<script>
  // Auto-trigger print dialog after fonts/layout settle (give user a moment to see preview)
  // window.addEventListener('load', () => setTimeout(() => window.print(), 800));
</script>
</body>
</html>`;
  }

  function kpiCard(label, value, detail, extra, cls = '') {
    return `
      <div class="kpi ${cls}">
        <div class="kpi-l">${label}</div>
        <div class="kpi-v">${typeof value === 'number' ? value.toLocaleString() : value}</div>
        <div class="kpi-d">${detail}${extra ? ` ${extra}` : ''}</div>
      </div>`;
  }

  function deltaPill(d, label) {
    if (d == null || d === undefined) return '';
    if (d === 0) return `<span class="delta flat">→ ${label} ±0</span>`;
    const cls = d > 0 ? 'up' : 'down';
    const arrow = d > 0 ? '▲' : '▼';
    return `<span class="delta ${cls}">${arrow} ${label} ${d > 0 ? '+' : ''}${d}</span>`;
  }

  function anomCard(a) {
    const sevLabel = { critical: '嚴重', warn: '注意', info: '資訊' };
    return `
      <div class="anom ${a.severity}">
        <div class="anom-l">
          <div class="anom-h">
            <span class="anom-t">${a.title}</span>
            <span class="anom-sev">${sevLabel[a.severity]}</span>
          </div>
          <div class="anom-s">${escapeHtml(a.subject)}</div>
          <div class="anom-m">${escapeHtml(a.message)}</div>
        </div>
        <div class="anom-r">
          <div class="anom-metric">${a.metric}</div>
          <div class="anom-mlabel">${a.metricLabel}</div>
        </div>
      </div>`;
  }

  function crossMonthCard(r) {
    const sev = r.monthCount >= 3 ? '' : 'warn';
    return `
      <div class="cm-row ${sev}">
        <div class="cm-h">
          <div>
            <div class="cm-id">${escapeHtml(r.model)} <span class="ser">#${escapeHtml(r.serial)}</span></div>
          </div>
          <div class="cm-months">
            ${r.monthsSpan.map(m => `<span class="cm-month">${fmtMonth(m)}</span>`).join('')}
            <span style="margin-left:8px;font-family:'JetBrains Mono',monospace;font-size:0.87em;font-weight:700;color:${r.monthCount >= 3 ? '#dc2626' : '#d97706'}">${r.visitCount} 次</span>
          </div>
        </div>
        <div class="cm-visits">
          ${r.visits.slice(0, 4).map(v => `
            <div>${v.date || '—'}　${escapeHtml(v.content || v.reason || '—')}${v.parts.length ? `　→ ${v.parts.slice(0, 2).map(escapeHtml).join(', ')}` : ''}</div>
          `).join('')}
          ${r.visits.length > 4 ? `<div style="color:#94a3b8">…另有 ${r.visits.length - 4} 次</div>` : ''}
        </div>
      </div>`;
  }

  function trendSvg(data, color, suffix = '') {
    if (!data.length) return '';
    const w = 380, h = 120, padX = 30, padY = 18;
    const xs = data.length === 1
      ? [w / 2]
      : data.map((_, i) => padX + (w - 2 * padX) * (i / (data.length - 1)));
    const maxV = Math.max(...data.map(d => d.value), 0.001);
    const ys = data.map(d => h - padY - ((h - 2 * padY) * d.value / maxV));
    const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ');
    const areaD = `${pathD} L ${xs[xs.length - 1]} ${h - padY} L ${xs[0]} ${h - padY} Z`;
    return `
      <svg viewBox="0 0 ${w} ${h}" class="trend-svg" preserveAspectRatio="none">
        <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="#e2e8f0" stroke-width="1"/>
        <path d="${areaD}" fill="${color}" opacity=".12"/>
        <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2"/>
        ${xs.map((x, i) => `
          <circle cx="${x}" cy="${ys[i]}" r="3.5" fill="${color}"/>
          <text x="${x}" y="${ys[i] - 8}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" font-weight="700" fill="#0f172a">${typeof data[i].value === 'number' ? (suffix === '%' ? data[i].value.toFixed(1) : data[i].value.toLocaleString()) : data[i].value}${suffix}</text>
          <text x="${x}" y="${h - 4}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9.5" fill="#64748b">${data[i].label}</text>
        `).join('')}
      </svg>`;
  }

  function buildExecutiveSummary(d) {
    const parts = [];
    const m = fmtMonth(d.latestMonth);

    // Total + delta
    if (d.delta && d.prevKpis) {
      const dir = d.delta.count > 0 ? '較上月增加' : d.delta.count < 0 ? '較上月減少' : '與上月持平';
      parts.push(`${m} 月共處理 <strong>${d.curKpis.totalRepairs.toLocaleString()}</strong> 筆維修，${dir} <strong>${Math.abs(d.delta.count)}</strong> 件（${d.delta.countPct >= 0 ? '+' : ''}${d.delta.countPct.toFixed(0)}%），佔整新數 <strong>${d.curKpis.denomPct.toFixed(1)}%</strong>。`);
    } else {
      parts.push(`${m} 月共處理 <strong>${d.curKpis.totalRepairs.toLocaleString()}</strong> 筆維修，佔整新數 <strong>${d.curKpis.denomPct.toFixed(1)}%</strong>。`);
    }

    // Critical anomalies
    if (d.critical.length > 0) {
      parts.push(`系統偵測到 <strong>${d.critical.length}</strong> 件嚴重異常${d.warn.length ? `、${d.warn.length} 件待注意項目` : ''}，需立即關注。`);
      // Highlight top 1-2
      const top = d.critical.slice(0, 2);
      top.forEach(a => {
        parts.push(`<strong>${a.title}：${escapeHtml(a.subject)}</strong> — ${escapeHtml(a.message)}。`);
      });
    } else if (d.warn.length > 0) {
      parts.push(`偵測到 <strong>${d.warn.length}</strong> 件待注意項目，本月整體狀況穩定。`);
    } else {
      parts.push(`未偵測到顯著異常，狀況穩定。`);
    }

    // Cross-month
    if (d.crossMonth.length > 0) {
      const ge3 = d.crossMonth.filter(r => r.monthCount >= 3).length;
      parts.push(`<strong>${d.crossMonth.length}</strong> 台機台在多個月份均有維修紀錄${ge3 ? `（其中 <strong>${ge3}</strong> 台已連續 ≥ 3 個月）` : ''}，建議列入下月重點檢討。`);
    }

    // Top part
    if (d.topParts.length > 0) {
      const p = d.topParts[0];
      parts.push(`本月最頻繁更換零件為 <strong>${escapeHtml(p.name)}</strong>，共 <strong>${p.count}</strong> 件${p.models.length > 1 ? `，跨 <strong>${p.models.length}</strong> 個機種` : ''}。`);
    }

    return parts.join(' ');
  }

  // Expose
  window.RepairReport = { generate };
})();
