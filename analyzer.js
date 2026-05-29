// ════════════════════════════════════════════════════════════════════
// Repair Analyzer
// Cross-month aggregation, anomaly detection, KPI computation.
// ════════════════════════════════════════════════════════════════════

(function () {

  // ─── Filter records across months by selected month set + category + model + date
  function getRecords(db, filter) {
    const { months, category, model, dateFrom, dateTo, scrapOnly } = filter || {};
    const monthKeys = months && months.length ? months : Object.keys(db.months);
    let out = [];
    for (const mk of monthKeys) {
      const m = db.months[mk];
      if (!m) continue;
      for (const r of m.records) {
        if (category && category !== '全部' && r.category !== category) continue;
        if (model && model !== '全部' && r.model !== model) continue;
        if (dateFrom && r.date && r.date < dateFrom) continue;
        if (dateTo && r.date && r.date > dateTo) continue;
        if (scrapOnly && !r.isScrap) continue;
        out.push({ ...r, _monthKey: mk });
      }
    }
    return out;
  }

  // Get aggregated denominator (整新數) for selected months/models
  // Returns: { total, byModel: {model: denominator} }
  function getDenominators(db, filter) {
    const { months } = filter || {};
    const monthKeys = months && months.length ? months : Object.keys(db.months);
    const byModel = {}; // model → most-recent denominator across selected months
    const byMonthModel = {}; // for breakdown

    for (const mk of monthKeys) {
      const m = db.months[mk];
      if (!m) continue;
      byMonthModel[mk] = m.denominators || {};
      for (const [model, n] of Object.entries(m.denominators || {})) {
        // Sum across months — represents total units refurbished over the selected period
        byModel[model] = (byModel[model] || 0) + n;
      }
    }
    const total = Object.values(byModel).reduce((a, b) => a + b, 0);
    return { total, byModel, byMonthModel };
  }

  // ─── KPIs
  function computeKPIs(records, denom) {
    const total = records.length;
    const scrap = records.filter(r => r.isScrap).length;
    const models = new Set(records.map(r => r.model));
    const serials = {};
    for (const r of records) {
      if (!r.serial) continue;
      const k = `${r.model}|${r.serial}`;
      serials[k] = (serials[k] || 0) + 1;
    }
    const repeated = Object.values(serials).filter(c => c >= 2).length;
    const scrapPct = total ? (scrap / total) * 100 : 0;
    const denomPct = denom.total ? (total / denom.total) * 100 : 0;

    return {
      totalRepairs: total,
      scrap,
      scrapPct,
      models: models.size,
      repeatedSerials: repeated,
      denomTotal: denom.total,
      denomPct,  // total repairs ÷ total refurbished
    };
  }

  // ─── Pareto: top parts (using normalized name)
  function partPareto(records) {
    const map = new Map(); // normPart → { name, count, models:Set, dates:Set, raw:Set }
    for (const r of records) {
      [
        [r.part1Norm, r.part1, r.qty1, r.model, r.date],
        [r.part2Norm, r.part2, r.qty2, r.model, r.date],
        [r.part3Norm, r.part3, r.qty3, r.model, r.date],
      ].forEach(([norm, raw, qty, model, date]) => {
        if (!norm || !qty) return;
        if (!map.has(norm)) {
          map.set(norm, { name: norm, displayName: raw, count: 0, models: new Set(), dates: new Set(), rawNames: new Set() });
        }
        const e = map.get(norm);
        e.count += qty;
        if (model) e.models.add(model);
        if (date) e.dates.add(date);
        if (raw) e.rawNames.add(raw);
      });
    }
    const arr = Array.from(map.values()).map(e => ({
      name: e.name,
      displayName: e.displayName,
      count: e.count,
      models: Array.from(e.models),
      dates: Array.from(e.dates),
      rawNames: Array.from(e.rawNames),
    }));
    arr.sort((a, b) => b.count - a.count);
    const totalCount = arr.reduce((s, e) => s + e.count, 0);
    let cum = 0;
    return arr.map(e => {
      cum += e.count;
      return { ...e, pct: totalCount ? e.count / totalCount : 0, cumPct: totalCount ? cum / totalCount : 0 };
    });
  }

  // ─── Per-model rank (with denominator-based fault rate)
  // If db + monthKeys is passed, also computes per-month history
  function modelRank(records, denom, db, monthKeys) {
    const map = new Map();
    for (const r of records) {
      if (!map.has(r.model)) {
        map.set(r.model, {
          model: r.model,
          category: r.category,
          count: 0,
          scrap: 0,
          parts: new Map(),
          reasons: new Map(),
          contents: new Map(),
          serials: new Map(),
        });
      }
      const e = map.get(r.model);
      e.count++;
      if (r.isScrap) e.scrap++;
      if (r.serial) e.serials.set(r.serial, (e.serials.get(r.serial) || 0) + 1);
      [
        [r.part1Norm, r.qty1], [r.part2Norm, r.qty2], [r.part3Norm, r.qty3]
      ].forEach(([p, q]) => {
        if (p && q) e.parts.set(p, (e.parts.get(p) || 0) + q);
      });
      if (r.reason) e.reasons.set(r.reason, (e.reasons.get(r.reason) || 0) + 1);
      if (r.content) e.contents.set(r.content, (e.contents.get(r.content) || 0) + 1);
    }
    const arr = Array.from(map.values()).map(e => {
      const d = denom.byModel[e.model] || 0;
      const result = {
        model: e.model,
        category: e.category,
        count: e.count,
        scrap: e.scrap,
        scrapPct: e.count ? (e.scrap / e.count) : 0,
        denom: d,
        faultRate: d ? (e.count / d) : null,
        topParts: Array.from(e.parts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
        topReasons: Array.from(e.reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
        topContents: Array.from(e.contents.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
        repeatedSerials: Array.from(e.serials.entries()).filter(([_, c]) => c >= 2).sort((a, b) => b[1] - a[1]),
      };

      // Per-month history if db provided
      if (db && monthKeys && monthKeys.length) {
        result.history = monthKeys.map(mk => {
          const m = db.months[mk];
          if (!m) return { month: mk, count: 0, denom: 0, faultRate: null };
          const recs = m.records.filter(r => r.model === e.model);
          const den = m.denominators[e.model] || 0;
          return {
            month: mk,
            count: recs.length,
            denom: den,
            faultRate: den ? (recs.length / den) : null,
            scrap: recs.filter(r => r.isScrap).length,
          };
        });
      }
      return result;
    });
    arr.sort((a, b) => (b.faultRate || 0) - (a.faultRate || 0) || b.count - a.count);
    return arr;
  }

  // ─── Per-part history across months: returns {month, count, modelsAffected}
  // Also includes per-month per-model breakdown
  function partHistoryDetailed(db, partNorm, filter) {
    const monthKeys = Object.keys(db.months).sort();
    return monthKeys.map(mk => {
      const m = db.months[mk];
      if (!m) return { month: mk, count: 0, perModel: {}, models: [] };
      const perModel = {};
      for (const r of m.records) {
        // Apply user filter
        if (filter) {
          if (filter.category && filter.category !== '全部' && r.category !== filter.category) continue;
          if (filter.model && filter.model !== '全部' && r.model !== filter.model) continue;
        }
        [
          [r.part1Norm, r.qty1, r.model],
          [r.part2Norm, r.qty2, r.model],
          [r.part3Norm, r.qty3, r.model],
        ].forEach(([n, q, model]) => {
          if (n === partNorm && q) {
            perModel[model] = (perModel[model] || 0) + q;
          }
        });
      }
      const count = Object.values(perModel).reduce((a, b) => a + b, 0);
      // Denominators for affected models
      const denoms = {};
      for (const model of Object.keys(perModel)) {
        denoms[model] = m.denominators[model] || 0;
      }
      return {
        month: mk,
        count,
        perModel,
        denoms,
        models: Object.keys(perModel),
      };
    });
  }

  // ─── Per-model history across months
  function modelHistory(db, modelName) {
    const monthKeys = Object.keys(db.months).sort();
    return monthKeys.map(mk => {
      const m = db.months[mk];
      if (!m) return { month: mk, count: 0, denom: 0, faultRate: null, scrap: 0 };
      const recs = m.records.filter(r => r.model === modelName);
      const denom = m.denominators[modelName] || 0;
      return {
        month: mk,
        count: recs.length,
        denom,
        faultRate: denom ? (recs.length / denom) : null,
        scrap: recs.filter(r => r.isScrap).length,
        // Top parts this month for this model
        topParts: aggregateParts(recs).slice(0, 5),
      };
    });
  }

  function aggregateParts(records) {
    const m = new Map();
    for (const r of records) {
      [[r.part1Norm, r.qty1], [r.part2Norm, r.qty2], [r.part3Norm, r.qty3]].forEach(([n, q]) => {
        if (n && q) m.set(n, (m.get(n) || 0) + q);
      });
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }

  // ─── Reason / content breakdown
  function reasonBreakdown(records) {
    const reasons = new Map(), contents = new Map();
    for (const r of records) {
      if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1);
      if (r.content) contents.set(r.content, (contents.get(r.content) || 0) + 1);
    }
    const toArr = (m) => Array.from(m.entries()).map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return { reasons: toArr(reasons), contents: toArr(contents) };
  }

  // ─── Cross-model index: which parts span ≥2 models
  function crossModelParts(records, minModels = 2) {
    const pareto = partPareto(records);
    const byPart = pareto
      .filter(p => p.models.length >= minModels)
      .map(p => {
        // Per-model counts
        const perModel = {};
        for (const r of records) {
          [
            [r.part1Norm, r.qty1, r.model],
            [r.part2Norm, r.qty2, r.model],
            [r.part3Norm, r.qty3, r.model],
          ].forEach(([n, q, m]) => {
            if (n === p.name && q) perModel[m] = (perModel[m] || 0) + q;
          });
        }
        return { ...p, perModel };
      });
    byPart.sort((a, b) => b.models.length - a.models.length || b.count - a.count);
    return byPart;
  }

  // ─── Repeated serials (within filtered records)
  function repeatedSerials(records) {
    const map = new Map();
    for (const r of records) {
      if (!r.serial) continue;
      const k = `${r.model}|${r.serial}`;
      if (!map.has(k)) map.set(k, { model: r.model, serial: r.serial, count: 0, dates: [], reasons: [], parts: [] });
      const e = map.get(k);
      e.count++;
      if (r.date) e.dates.push(r.date);
      if (r.reason) e.reasons.push(r.reason);
      if (r.content) e.reasons.push(r.content);
      [r.part1Norm, r.part2Norm, r.part3Norm].forEach(p => { if (p) e.parts.push(p); });
    }
    return Array.from(map.values())
      .filter(e => e.count >= 2)
      .map(e => ({
        ...e,
        firstDate: e.dates.sort()[0],
        lastDate: e.dates.sort().slice(-1)[0],
        uniqueParts: Array.from(new Set(e.parts)).slice(0, 5),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ─── Cross-month repeated serials (THE KEY NEW FEATURE)
  // Same machine (model + serial) appearing in ≥2 different months — high priority signal
  function crossMonthSerials(db, filter) {
    const monthKeys = Object.keys(db.months).sort();
    if (monthKeys.length < 2) return [];

    const map = new Map(); // "model|serial" -> { model, serial, visits: [{month, date, reason, content, parts}] }
    for (const mk of monthKeys) {
      const m = db.months[mk];
      if (!m) continue;
      for (const r of m.records) {
        if (!r.serial) continue;
        // Apply user filter (category/model)
        if (filter) {
          if (filter.category && filter.category !== '全部' && r.category !== filter.category) continue;
          if (filter.model && filter.model !== '全部' && r.model !== filter.model) continue;
        }
        const k = `${r.model}|${r.serial}`;
        if (!map.has(k)) map.set(k, { model: r.model, serial: r.serial, category: r.category, visits: [] });
        map.get(k).visits.push({
          month: mk,
          date: r.date,
          reason: r.reason,
          content: r.content,
          isScrap: r.isScrap,
          parts: [r.part1Norm, r.part2Norm, r.part3Norm].filter(Boolean),
        });
      }
    }

    return Array.from(map.values())
      .map(e => {
        const months = Array.from(new Set(e.visits.map(v => v.month))).sort();
        return { ...e, monthsSpan: months, monthCount: months.length, visitCount: e.visits.length };
      })
      .filter(e => e.monthCount >= 2)  // appears in 2+ different months
      .sort((a, b) => b.monthCount - a.monthCount || b.visitCount - a.visitCount);
  }

  // ─── Scrap detail
  function scrapList(records) {
    const byModel = new Map();
    for (const r of records.filter(r => r.isScrap)) {
      if (!byModel.has(r.model)) byModel.set(r.model, { model: r.model, category: r.category, items: [], reasons: new Map() });
      const e = byModel.get(r.model);
      e.items.push(r);
      const k = r.content || r.reason || '未分類';
      e.reasons.set(k, (e.reasons.get(k) || 0) + 1);
    }
    return Array.from(byModel.values())
      .map(e => ({
        model: e.model,
        category: e.category,
        count: e.items.length,
        topReasons: Array.from(e.reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
        items: e.items,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ─── Monthly trend (for charts)
  function monthlyTrend(db, filter) {
    const monthKeys = Object.keys(db.months).sort();
    return monthKeys.map(mk => {
      const f = { ...filter, months: [mk] };
      const recs = getRecords(db, f);
      const denom = getDenominators(db, f);
      const scrap = recs.filter(r => r.isScrap).length;
      return {
        month: mk,
        count: recs.length,
        scrap,
        scrapPct: recs.length ? (scrap / recs.length) * 100 : 0,
        denom: denom.total,
        faultPct: denom.total ? (recs.length / denom.total) * 100 : 0,
      };
    });
  }

  // ─── Part trend across months (for a specific normalized part)
  function partTrend(db, partNorm, filter) {
    const monthKeys = Object.keys(db.months).sort();
    return monthKeys.map(mk => {
      const recs = getRecords(db, { ...filter, months: [mk] });
      let count = 0;
      const models = new Set();
      for (const r of recs) {
        [
          [r.part1Norm, r.qty1, r.model],
          [r.part2Norm, r.qty2, r.model],
          [r.part3Norm, r.qty3, r.model],
        ].forEach(([n, q, m]) => {
          if (n === partNorm && q) { count += q; models.add(m); }
        });
      }
      return { month: mk, count, models: Array.from(models) };
    });
  }

  // ─── Anomaly detection (the KEY new feature)
  // Detects:
  //   1. NEW high-volume parts (didn't exist last month, ≥3 this month)
  //   2. Surging parts (MoM increase ≥100% with ≥3 absolute)
  //   3. High fault-rate models (count/denom ≥ 5%)
  //   4. High scrap-rate models (scrap/count ≥ 30% with ≥3 scraps)
  //   5. Cross-model parts (single part affects ≥3 models)
  //   6. Repeated serials within recent month (≥3 visits)
  //   7. Concentrated failure reasons (single content ≥ 50% of model's failures)
  function detectAnomalies(db, currentMonth) {
    const monthKeys = Object.keys(db.months).sort();
    if (!monthKeys.length) return [];
    const curMonth = currentMonth || monthKeys[monthKeys.length - 1];
    const curIdx = monthKeys.indexOf(curMonth);
    const prevMonth = curIdx > 0 ? monthKeys[curIdx - 1] : null;

    const anomalies = [];
    const curRecs = getRecords(db, { months: [curMonth] });
    const curDenom = getDenominators(db, { months: [curMonth] });
    if (curRecs.length === 0) return [];

    const curParts = partPareto(curRecs);
    const prevRecs = prevMonth ? getRecords(db, { months: [prevMonth] }) : [];
    const prevParts = prevMonth ? partPareto(prevRecs) : [];
    const prevPartMap = new Map(prevParts.map(p => [p.name, p.count]));

    // 1) NEW high-volume parts
    for (const p of curParts) {
      if (p.count < 3) continue;
      if (!prevPartMap.has(p.name) && prevMonth) {
        anomalies.push({
          severity: 'critical',
          type: 'new_part',
          icon: '⊕',
          title: `新出現的高頻零件`,
          subject: p.name,
          message: `本月新增 ${p.count} 件，上月無此零件紀錄`,
          metric: p.count,
          metricLabel: '件',
          drillDown: { kind: 'part', partNorm: p.name },
          detail: { part: p, affectsModels: p.models },
        });
      }
    }

    // 2) Surging parts
    for (const p of curParts) {
      const prev = prevPartMap.get(p.name) || 0;
      if (prev > 0 && p.count >= 3) {
        const growth = (p.count - prev) / prev;
        if (growth >= 1.0) {
          anomalies.push({
            severity: growth >= 3 ? 'critical' : 'warn',
            type: 'surge_part',
            icon: '↑',
            title: `零件用量暴增`,
            subject: p.name,
            message: `${prev} → ${p.count} 件 (+${Math.round(growth * 100)}%)`,
            metric: Math.round(growth * 100),
            metricLabel: '%',
            drillDown: { kind: 'part', partNorm: p.name },
            detail: { part: p, prev, current: p.count, growth },
          });
        }
      }
    }

    // 3) High fault-rate models
    const ranks = modelRank(curRecs, curDenom);
    for (const m of ranks) {
      if (m.denom && m.faultRate >= 0.05) {
        anomalies.push({
          severity: m.faultRate >= 0.10 ? 'critical' : 'warn',
          type: 'high_fault_rate',
          icon: '!',
          title: `機種故障率偏高`,
          subject: m.model,
          message: `${m.count} 件 / 整新數 ${m.denom} = ${(m.faultRate * 100).toFixed(1)}%`,
          metric: (m.faultRate * 100).toFixed(1),
          metricLabel: '%',
          drillDown: { kind: 'model', model: m.model },
          detail: { model: m },
        });
      }
    }

    // 4) High scrap-rate models
    for (const m of ranks) {
      if (m.scrap >= 3 && m.scrapPct >= 0.30) {
        anomalies.push({
          severity: m.scrapPct >= 0.50 ? 'critical' : 'warn',
          type: 'high_scrap',
          icon: '✕',
          title: `報廢比例偏高`,
          subject: m.model,
          message: `報廢 ${m.scrap} 件 / 維修 ${m.count} 件 = ${(m.scrapPct * 100).toFixed(0)}%`,
          metric: (m.scrapPct * 100).toFixed(0),
          metricLabel: '%',
          drillDown: { kind: 'model', model: m.model },
          detail: { model: m },
        });
      }
    }

    // 5) Cross-model parts (≥3 models)
    const cross = crossModelParts(curRecs, 3);
    for (const p of cross.slice(0, 8)) {
      anomalies.push({
        severity: p.models.length >= 5 ? 'warn' : 'info',
        type: 'cross_model',
        icon: '⇄',
        title: `零件跨機種出現`,
        subject: p.name,
        message: `影響 ${p.models.length} 個機種，合計 ${p.count} 件`,
        metric: p.models.length,
        metricLabel: '機種',
        drillDown: { kind: 'part', partNorm: p.name },
        detail: { part: p },
      });
    }

    // 6) Repeated serials (≥3 visits in single month)
    const reps = repeatedSerials(curRecs);
    for (const r of reps.filter(r => r.count >= 3).slice(0, 10)) {
      anomalies.push({
        severity: r.count >= 4 ? 'critical' : 'warn',
        type: 'repeated_serial',
        icon: '♺',
        title: `同一機台重複維修`,
        subject: `${r.model} #${r.serial}`,
        message: `本月維修 ${r.count} 次(治標未治本？)`,
        metric: r.count,
        metricLabel: '次',
        drillDown: { kind: 'serial', model: r.model, serial: r.serial },
        detail: { serial: r },
      });
    }

    // 6b) CROSS-MONTH repeated serials
    const crossMonth = crossMonthSerials(db);
    for (const r of crossMonth.slice(0, 15)) {
      if (!r.monthsSpan.some(m => m <= curMonth)) continue;
      anomalies.push({
        severity: r.monthCount >= 3 ? 'critical' : 'warn',
        type: 'cross_month_serial',
        icon: '↻',
        title: `跨月份重複維修`,
        subject: `${r.model} #${r.serial}`,
        message: `${r.monthsSpan.map(m => m.replace(/^\d{4}-/, '')).join(' → ')} 月共 ${r.visitCount} 次`,
        metric: r.monthCount,
        metricLabel: '月份',
        drillDown: { kind: 'serial', model: r.model, serial: r.serial },
        detail: { serial: r },
      });
    }

    // 7) Concentrated failure contents per model
    for (const m of ranks) {
      if (m.count < 10) continue;
      const top = m.topContents[0];
      if (!top) continue;
      if (top.count / m.count >= 0.50) {
        anomalies.push({
          severity: 'info',
          type: 'concentrated_failure',
          icon: '◎',
          title: `故障原因高度集中`,
          subject: `${m.model} — ${top.name}`,
          message: `${top.count} 件 / 該機種 ${m.count} 件 = ${Math.round(top.count / m.count * 100)}%`,
          metric: Math.round(top.count / m.count * 100),
          metricLabel: '%',
          drillDown: { kind: 'model', model: m.model },
          detail: { model: m, topContent: top },
        });
      }
    }

    // Sort by severity (critical > warn > info), then metric
    const sevOrder = { critical: 0, warn: 1, info: 2 };
    anomalies.sort((a, b) => {
      const s = sevOrder[a.severity] - sevOrder[b.severity];
      if (s !== 0) return s;
      return parseFloat(b.metric) - parseFloat(a.metric);
    });

    return anomalies;
  }

  // ════════════════════════════════════════════════════════════════
  // ADVANCED ANALYTICS LAYER
  // 品質指標 / SPC / FMEA / 根因樹 / 預測 / 成本
  // ════════════════════════════════════════════════════════════════

  // ─── 品質指標體系：DPPM / FPY / 重工率 ───
  // base = 整新數 (denominator) 作為出貨/生產基數的代理值
  function qualityMetrics(records, denom, db, monthKeys) {
    const total = records.length;
    const base  = denom.total || 0;
    const scrap = records.filter(r => r.isScrap).length;

    // DPPM：每百萬缺陷數
    const dppm = base ? Math.round((total / base) * 1_000_000) : null;
    const scrapDppm = base ? Math.round((scrap / base) * 1_000_000) : null;

    // 重複維修（重工）：同序號在選定期間 ≥2 次
    const serialMap = {};
    for (const r of records) {
      if (!r.serial) continue;
      const k = `${r.model}|${r.serial}`;
      serialMap[k] = (serialMap[k] || 0) + 1;
    }
    const reworkUnits = Object.values(serialMap).filter(c => c >= 2).length;
    const uniqueUnits = Object.keys(serialMap).length;
    const reworkRate = uniqueUnits ? (reworkUnits / uniqueUnits) * 100 : 0;

    // FPY 直通率代理：(整新數 - 維修數) / 整新數，代表未進維修的比例
    const fpy = base ? Math.max(0, (base - total) / base) * 100 : null;

    return {
      total, base, scrap,
      dppm, scrapDppm,
      reworkUnits, uniqueUnits, reworkRate,
      fpy,
      scrapRate: total ? (scrap / total) * 100 : 0,
    };
  }

  // ─── SPC 管制圖：對每月故障率計算 mean / σ / UCL / LCL ───
  // 使用 p-chart 概念（不良率管制圖）；資料不足 3 個月時 σ 不可靠，回傳 ready=false
  function spcAnalysis(db, filter) {
    const trend = monthlyTrend(db, filter).filter(t => t.denom > 0);
    if (trend.length < 2) return { ready: false, points: trend, reason: '需至少 2 個月有整新數資料' };

    const rates = trend.map(t => t.faultPct);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rates.length;
    const sigma = Math.sqrt(variance);
    const ucl = mean + 3 * sigma;
    const lcl = Math.max(0, mean - 3 * sigma);
    const uclW = mean + 2 * sigma; // 警告線 (2σ)

    const points = trend.map(t => {
      let status = 'normal';
      if (t.faultPct > ucl) status = 'out';        // 超出管制界限
      else if (t.faultPct > uclW) status = 'warn'; // 接近界限
      return { ...t, status };
    });

    return {
      ready: true, mean, sigma, ucl, lcl, uclW, points,
      outCount: points.filter(p => p.status === 'out').length,
    };
  }

  // ─── 故障根因分類樹：部位 → 模式（關鍵字規則）───
  const FAULT_TAXONOMY = {
    '電源系統': { kws: ['電源','電供','變壓','adapter','power','電池','充電','供電','穩壓','保險絲'], color:'#f59e0b' },
    '主板/PCB': { kws: ['主板','母板','pcb','電路板','板子','ic','晶片','bga','電容','電阻','二極','電晶','焊','短路','斷路','開路'], color:'#ef4444' },
    '顯示/螢幕': { kws: ['螢幕','面板','顯示','lcd','背光','液晶','觸控','panel','花屏','黑屏'], color:'#38bdf8' },
    '儲存/記憶': { kws: ['硬碟','hdd','ssd','記憶','ram','emmc','儲存','flash','sd卡','讀寫'], color:'#a78bfa' },
    '感測/鏡頭': { kws: ['鏡頭','感測','sensor','ccd','cmos','對焦','紅外','ir','pir','收訊'], color:'#34d399' },
    '機構/外觀': { kws: ['外殼','機構','按鍵','卡榫','破裂','變形','刮傷','螺絲','接頭','端子','排線','連接'], color:'#94a2b6' },
    '通訊/網路': { kws: ['網路','wifi','藍牙','zigbee','rf','天線','訊號','通訊','連線','斷線','lan','poe'], color:'#22d3ee' },
    '韌體/軟體': { kws: ['韌體','軟體','firmware','程式','當機','重啟','異常關機','無回應','升級','版本','設定','系統','ota'], color:'#818cf8' },
  };

  function classifyFault(text) {
    const s = String(text || '').toLowerCase();
    for (const [part, def] of Object.entries(FAULT_TAXONOMY)) {
      if (def.kws.some(kw => s.includes(kw.toLowerCase()))) return part;
    }
    return '其他/未分類';
  }

  function rootCauseTree(records) {
    const tree = {}; // 部位 → { count, scrap, modes:{mode:count} }
    for (const r of records) {
      const text = `${r.content || ''} ${r.reason || ''}`;
      const part = classifyFault(text);
      if (!tree[part]) tree[part] = { count: 0, scrap: 0, modes: {} };
      tree[part].count++;
      if (r.isScrap) tree[part].scrap++;
      const mode = (r.content || r.reason || '未填').trim().slice(0, 30);
      tree[part].modes[mode] = (tree[part].modes[mode] || 0) + 1;
    }
    return Object.entries(tree)
      .map(([part, d]) => ({
        part,
        count: d.count,
        scrap: d.scrap,
        scrapRate: d.count ? (d.scrap / d.count) * 100 : 0,
        color: FAULT_TAXONOMY[part]?.color || '#64748b',
        topModes: Object.entries(d.modes).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([mode, count]) => ({ mode, count })),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ─── FMEA / RPN 風險評分 ───
  // Severity（嚴重度）：依該故障部位的報廢率推估 (1-10)
  // Occurrence（發生度）：依發生頻率分位推估 (1-10)
  // Detection（偵測度）：重複/跨月故障代表難偵測，預設偏高 (1-10)
  function fmeaAnalysis(records, db) {
    const tree = rootCauseTree(records);
    if (!tree.length) return [];
    const maxCount = Math.max(...tree.map(t => t.count), 1);

    // 跨月重複的部位集合（偵測度加權）
    const crossSerials = crossMonthSerials(db, {});
    const crossModels = new Set(crossSerials.map(c => c.model));

    return tree.map(t => {
      // Severity：報廢率 0→1, 50%+→10
      const severity = Math.min(10, Math.max(1, Math.round(1 + (t.scrapRate / 100) * 18)));
      // Occurrence：頻率分位
      const occurrence = Math.min(10, Math.max(1, Math.round((t.count / maxCount) * 10)));
      // Detection：基礎 5，若該部位涉及跨月重複機種 +3
      const hasCross = records.some(r => {
        const text = `${r.content || ''} ${r.reason || ''}`;
        return classifyFault(text) === t.part && crossModels.has(r.model);
      });
      const detection = Math.min(10, 5 + (hasCross ? 3 : 0) + (t.scrapRate > 20 ? 1 : 0));
      const rpn = severity * occurrence * detection;
      return {
        part: t.part, color: t.color,
        count: t.count, scrap: t.scrap, scrapRate: t.scrapRate,
        severity, occurrence, detection, rpn,
        level: rpn >= 200 ? 'critical' : rpn >= 100 ? 'high' : rpn >= 50 ? 'medium' : 'low',
        topModes: t.topModes,
      };
    }).sort((a, b) => b.rpn - a.rpn);
  }

  // ─── 預測：下月故障數（線性回歸 + 3 月移動平均）───
  function forecastNextMonth(db, filter) {
    const trend = monthlyTrend(db, filter);
    if (trend.length < 2) return { ready: false, reason: '需至少 2 個月資料' };

    const counts = trend.map(t => t.count);
    const n = counts.length;

    // 線性回歸 y = a + bx
    const xs = counts.map((_, i) => i);
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = counts.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * counts[i], 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);
    const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
    const a = (sumY - b * sumX) / n;
    const linearPred = Math.max(0, Math.round(a + b * n));

    // 3 月移動平均
    const recent = counts.slice(-3);
    const ma = Math.round(recent.reduce((x, y) => x + y, 0) / recent.length);

    // 綜合預測：兩者平均
    const forecast = Math.round((linearPred + ma) / 2);
    const lastCount = counts[counts.length - 1];
    const trendDir = b > 0.5 ? 'up' : b < -0.5 ? 'down' : 'flat';

    return {
      ready: true, forecast, linearPred, ma, lastCount, trendDir,
      slope: b,
      deltaPct: lastCount ? ((forecast - lastCount) / lastCount) * 100 : 0,
      nextMonthLabel: trend.length ? null : null,
    };
  }

  // ─── 成本量化（需單價設定）───
  // priceConfig: { models:{model:price}, categories:{cat:price}, laborPerRepair, scrapDefault }
  function costAnalysis(records, priceConfig) {
    const cfg = priceConfig || {};
    const modelPrices = cfg.models || {};
    const catPrices = cfg.categories || {};
    const laborPerRepair = cfg.laborPerRepair || 0;
    const scrapDefault = cfg.scrapDefault || 0;

    const unitPrice = (r) => modelPrices[r.model] ?? catPrices[r.category] ?? scrapDefault;

    let scrapCost = 0, laborCost = 0;
    const byCategory = {};
    let scrapCount = 0;

    for (const r of records) {
      const labor = laborPerRepair;
      laborCost += labor;
      let sc = 0;
      if (r.isScrap) { sc = unitPrice(r); scrapCost += sc; scrapCount++; }
      const cat = r.category || '其他';
      if (!byCategory[cat]) byCategory[cat] = { scrapCost: 0, laborCost: 0, count: 0, scrap: 0 };
      byCategory[cat].scrapCost += sc;
      byCategory[cat].laborCost += labor;
      byCategory[cat].count++;
      if (r.isScrap) byCategory[cat].scrap++;
    }

    return {
      scrapCost, laborCost, totalCost: scrapCost + laborCost,
      scrapCount,
      avgScrapCost: scrapCount ? scrapCost / scrapCount : 0,
      byCategory: Object.entries(byCategory)
        .map(([cat, d]) => ({ cat, ...d, total: d.scrapCost + d.laborCost }))
        .sort((a, b) => b.total - a.total),
      configured: Object.keys(modelPrices).length > 0 || Object.keys(catPrices).length > 0 || scrapDefault > 0,
    };
  }

  // Expose
  window.RepairAnalyzer = {
    getRecords,
    getDenominators,
    computeKPIs,
    partPareto,
    modelRank,
    modelHistory,
    partHistoryDetailed,
    aggregateParts,
    reasonBreakdown,
    crossModelParts,
    repeatedSerials,
    crossMonthSerials,
    scrapList,
    monthlyTrend,
    partTrend,
    detectAnomalies,
    // Advanced analytics
    qualityMetrics,
    spcAnalysis,
    rootCauseTree,
    classifyFault,
    fmeaAnalysis,
    forecastNextMonth,
    costAnalysis,
    FAULT_TAXONOMY,
  };
})();
