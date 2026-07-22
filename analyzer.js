// ════════════════════════════════════════════════════════════════════
// Repair Analyzer
// Cross-month aggregation, anomaly detection, KPI computation.
// ════════════════════════════════════════════════════════════════════

(function () {

  function normalizePartName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (typeof window !== 'undefined' && window.RepairParser && window.RepairParser.normalizePart) {
      return window.RepairParser.normalizePart(raw);
    }
    return raw.toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function recordPartName(raw, storedNorm) {
    return normalizePartName(raw || storedNorm);
  }

  // ─── Filter records across months by selected month set + category + model + date
  function getRecords(db, filter) {
    const { months, category, model, dateFrom, dateTo, scrapOnly } = filter || {};
    const monthKeys = months && months.length ? months : Object.keys(db.months);
    let out = [];
    for (const mk of monthKeys) {
      const m = db.months[mk];
      if (!m) continue;
      for (const r of m.records) {
        // 正規化 model key（向下相容舊版 data.json，去除連字號/底線/空格）
        const modelKey = normalizeModel(r.model);
        if (category && category !== '全部' && r.category !== category) continue;
        if (model && model !== '全部' && modelKey !== normalizeModel(model)) continue;
        if (dateFrom && r.date && r.date < dateFrom) continue;
        if (dateTo && r.date && r.date > dateTo) continue;
        if (scrapOnly && !r.isScrap) continue;
        out.push({
          ...r,
          model: modelKey,
          part1Norm: recordPartName(r.part1, r.part1Norm),
          part2Norm: recordPartName(r.part2, r.part2Norm),
          part3Norm: recordPartName(r.part3, r.part3Norm),
          _monthKey: mk,
        });
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
        // 正規化 key，與 record.model 對齊（去除連字號/底線/空格）
        const key = normalizeModel(model);
        byModel[key] = (byModel[key] || 0) + n;
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
        [recordPartName(r.part1, r.part1Norm), r.part1, r.qty1, r.model, r.date],
        [recordPartName(r.part2, r.part2Norm), r.part2, r.qty2, r.model, r.date],
        [recordPartName(r.part3, r.part3Norm), r.part3, r.qty3, r.model, r.date],
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
        [recordPartName(r.part1, r.part1Norm), r.qty1],
        [recordPartName(r.part2, r.part2Norm), r.qty2],
        [recordPartName(r.part3, r.part3Norm), r.qty3]
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
          const recs = m.records.filter(r => normalizeModel(r.model) === e.model);
          let den = m.denominators[e.model] || 0;
          if (!den) {
            for (const [dk, dv] of Object.entries(m.denominators || {})) {
              if (normalizeModel(dk) === e.model) { den = dv; break; }
            }
          }
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
    const targetPart = normalizePartName(partNorm);
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
          [recordPartName(r.part1, r.part1Norm), r.qty1, r.model],
          [recordPartName(r.part2, r.part2Norm), r.qty2, r.model],
          [recordPartName(r.part3, r.part3Norm), r.qty3, r.model],
        ].forEach(([n, q, model]) => {
          if (n === targetPart && q) {
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
    const normName = normalizeModel(modelName);
    const monthKeys = Object.keys(db.months).sort();
    return monthKeys.map(mk => {
      const m = db.months[mk];
      if (!m) return { month: mk, count: 0, denom: 0, faultRate: null, scrap: 0 };
      const recs = m.records.filter(r => normalizeModel(r.model) === normName);
      // denominators keys may be raw or normalized — try both
      const denom = m.denominators[normName]
        || Object.entries(m.denominators || {}).find(([k]) => normalizeModel(k) === normName)?.[1]
        || 0;
      return {
        month: mk,
        count: recs.length,
        denom,
        faultRate: denom ? (recs.length / denom) : null,
        scrap: recs.filter(r => r.isScrap).length,
        topParts: aggregateParts(recs).slice(0, 5),
      };
    });
  }

  function getModelSupplement(db, modelName) {
    const supplements = (db && db.modelSupplements) || {};
    const normName = normalizeModel(modelName);
    if (!normName) return null;
    return supplements[normName]
      || Object.entries(supplements).find(([k, v]) => normalizeModel(k) === normName || normalizeModel(v && v.model) === normName)?.[1]
      || null;
  }

  function modelSupplementHistory(db, modelName) {
    const sup = getModelSupplement(db, modelName);
    if (!sup) return [];
    const map = new Map();
    for (const row of sup.monthly || []) {
      const month = row.month || '';
      if (!month) continue;
      if (!map.has(month)) {
        map.set(month, {
          month,
          refurbished: 0,
          passed: 0,
          failed: 0,
          variants: new Set(),
          sourceType: sup.sourceType || 'model-supplement-v1',
        });
      }
      const e = map.get(month);
      e.refurbished += Number(row.refurbished) || 0;
      e.passed += Number(row.passed) || 0;
      e.failed += Number(row.failed) || 0;
      if (row.variant) e.variants.add(row.variant);
    }
    return Array.from(map.values()).map(e => ({
      ...e,
      variants: Array.from(e.variants),
      faultRate: e.refurbished ? e.failed / e.refurbished : null,
      usableRate: e.refurbished ? e.passed / e.refurbished : null,
    })).sort((a, b) => a.month.localeCompare(b.month));
  }

  function modelSupplementReasons(db, modelName, month) {
    const sup = getModelSupplement(db, modelName);
    if (!sup) return [];
    const history = modelSupplementHistory(db, modelName);
    const failByMonth = Object.fromEntries(history.map(h => [h.month, h.failed]));
    const map = new Map();
    for (const row of sup.reasons || []) {
      if (month && month !== '__all__' && row.month !== month) continue;
      const key = `${row.code || ''}|${row.reason || ''}`;
      if (!map.has(key)) {
        map.set(key, { code: row.code || '', reason: row.reason || '', count: 0, months: new Set(), variants: new Set(), failedBase: 0 });
      }
      const e = map.get(key);
      e.count += Number(row.count) || 0;
      if (row.month) e.months.add(row.month);
      if (row.variant) e.variants.add(row.variant);
    }
    for (const e of map.values()) {
      e.failedBase = Array.from(e.months).reduce((s, mk) => s + (Number(failByMonth[mk]) || 0), 0);
    }
    return Array.from(map.values()).map(e => ({
      code: e.code,
      reason: e.reason,
      name: [e.code, e.reason].filter(Boolean).join(' '),
      count: e.count,
      months: Array.from(e.months).sort(),
      variants: Array.from(e.variants).sort(),
      share: e.failedBase ? e.count / e.failedBase : null,
    })).sort((a, b) => b.count - a.count);
  }

  function modelSupplementAnnual(db, modelName) {
    const sup = getModelSupplement(db, modelName);
    return sup ? (sup.annual || []).slice().sort((a, b) => String(a.year).localeCompare(String(b.year))) : [];
  }

  function knownModels(db) {
    const set = new Set();
    for (const m of Object.values((db && db.months) || {})) {
      for (const r of m.records || []) if (r.model) set.add(normalizeModel(r.model));
      for (const k of Object.keys(m.denominators || {})) if (k) set.add(normalizeModel(k));
      for (const k of Object.keys(m.partCatalog || {})) if (k) set.add(normalizeModel(k));
    }
    for (const [k, v] of Object.entries((db && db.modelSupplements) || {})) {
      set.add(normalizeModel((v && (v.modelDisplay || v.model)) || k));
    }
    return Array.from(set).filter(Boolean).sort();
  }

  function aggregateParts(records) {
    const m = new Map();
    for (const r of records) {
      [
        [recordPartName(r.part1, r.part1Norm), r.qty1],
        [recordPartName(r.part2, r.part2Norm), r.qty2],
        [recordPartName(r.part3, r.part3Norm), r.qty3],
      ].forEach(([n, q]) => {
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
            [recordPartName(r.part1, r.part1Norm), r.qty1, r.model],
            [recordPartName(r.part2, r.part2Norm), r.qty2, r.model],
            [recordPartName(r.part3, r.part3Norm), r.qty3, r.model],
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
      [
        recordPartName(r.part1, r.part1Norm),
        recordPartName(r.part2, r.part2Norm),
        recordPartName(r.part3, r.part3Norm),
      ].forEach(p => { if (p) e.parts.push(p); });
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
          parts: [
            recordPartName(r.part1, r.part1Norm),
            recordPartName(r.part2, r.part2Norm),
            recordPartName(r.part3, r.part3Norm),
          ].filter(Boolean),
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
    const targetPart = normalizePartName(partNorm);
    const monthKeys = Object.keys(db.months).sort();
    return monthKeys.map(mk => {
      const recs = getRecords(db, { ...filter, months: [mk] });
      let count = 0;
      const models = new Set();
      for (const r of recs) {
        [
          [recordPartName(r.part1, r.part1Norm), r.qty1, r.model],
          [recordPartName(r.part2, r.part2Norm), r.qty2, r.model],
          [recordPartName(r.part3, r.part3Norm), r.qty3, r.model],
        ].forEach(([n, q, m]) => {
          if (n === targetPart && q) { count += q; models.add(m); }
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
    const baselineMonths = monthKeys.slice(Math.max(0, curIdx - 3), curIdx);
    const baselinePartMaps = baselineMonths.map(mk =>
      new Map(partPareto(getRecords(db, { months: [mk] })).map(p => [p.name, p.count]))
    );
    const baselinePartNames = new Set();
    for (const mp of baselinePartMaps) {
      for (const name of mp.keys()) baselinePartNames.add(name);
    }
    const baselineAvg = (name) => {
      if (!baselinePartMaps.length) return 0;
      const sum = baselinePartMaps.reduce((s, mp) => s + (mp.get(name) || 0), 0);
      return sum / baselinePartMaps.length;
    };

    // 1) NEW high-volume parts
    for (const p of curParts) {
      // 小樣本單月出現容易是填寫粒度差異，先不打異常；真正的新熱點需同時滿足高件數與歷史未出現。
      if (p.count < 10) continue;
      if (!baselinePartNames.has(p.name) && prevMonth) {
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
      const base = baselineAvg(p.name);
      // 短期低基數跳動先忽略；用近 3 個月平均當基準，避免 1→5 這類雜訊每月報警。
      if (prev > 0 && p.count >= 10 && base >= 3) {
        const growth = (p.count - base) / base;
        if (growth >= 1.0) {
          anomalies.push({
            severity: growth >= 3 ? 'critical' : 'warn',
            type: 'surge_part',
            icon: '↑',
            title: `零件用量暴增`,
            subject: p.name,
            message: `近${baselineMonths.length}月均 ${base.toFixed(1)} → 本月 ${p.count} 件 (+${Math.round(growth * 100)}%)`,
            metric: Math.round(growth * 100),
            metricLabel: '%',
            drillDown: { kind: 'part', partNorm: p.name },
            detail: { part: p, prev, baseline: base, current: p.count, growth },
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

    // 信度分級：< 6 個月為探索性，6–11 個月為試算，≥ 12 個月才視為正式管制
    const n = trend.length;
    const confidence = n >= 12 ? 'ready' : n >= 6 ? 'trial' : 'exploratory';
    const confidenceLabel = { ready: '正式管制', trial: '試算管制界限（建議繼續蒐集至12個月）', exploratory: '探索性趨勢（資料不足6個月，不宜作為管制結論）' }[confidence];

    const points = trend.map(t => {
      let status = 'normal';
      if (t.faultPct > ucl) status = 'out';        // 超出管制界限
      else if (t.faultPct > uclW) status = 'warn'; // 接近界限
      return { ...t, status };
    });

    return {
      ready: true, confidence, confidenceLabel, mean, sigma, ucl, lcl, uclW, points,
      outCount: points.filter(p => p.status === 'out').length,
    };
  }

  // ─── 故障根因分類樹：部位 → 模式（關鍵字規則）───
  const FAULT_TAXONOMY = {
    '電源系統': { kws: [
      '電源','電供','變壓','adapter','power','電池','充電','供電','穩壓','保險絲',
      '電壓','過壓','低壓','欠壓','突波','ac','dc','充不進','無電','電源板','開機電',
      '短路保護','過電流','限流','電源模組','ups','電源異常','電源供應',
    ], color:'#f59e0b' },
    '主板/PCB': { kws: [
      '主板','母板','pcb','電路板','板子','ic','晶片','bga','電容','電阻','二極',
      '電晶','焊','短路','斷路','開路','假焊','虛焊','冷焊','銅箔','走線','過孔',
      '基板','smt','dip','主機板','cpu','mcu','芯片','損板','板壞','板故障',
      '元件燒','燒毀','燒焦','炸裂','異常發熱','過熱','熱當',
    ], color:'#ef4444' },
    '顯示/螢幕': { kws: [
      '螢幕','面板','顯示','lcd','背光','液晶','觸控','panel','花屏','黑屏',
      '無顯示','閃屏','畫面','顯示器','白屏','綠屏','色偏','亮度','dead pixel',
      'oled','顯示模組','顯示板','螢幕破','屏幕','顯示不正常','顯示異常',
    ], color:'#38bdf8' },
    '儲存/記憶': { kws: [
      '硬碟','hdd','ssd','記憶','ram','emmc','儲存','flash','sd卡','讀寫',
      'rom','eeprom','nand','nor','記憶體','記憶錯誤','存取失敗','memory',
      '資料遺失','存儲','讀取失敗','寫入失敗','格式化','損壞磁區',
    ], color:'#a78bfa' },
    '感測/鏡頭': { kws: [
      '鏡頭','感測','sensor','ccd','cmos','對焦','紅外','ir','pir','收訊',
      '影像','攝像','camera','圖像','偵測','感應','偵煙','偵溫','溫感',
      '震動感測','加速度計','陀螺儀','光感','人體感應','動態偵測','誤報',
    ], color:'#34d399' },
    '機構/外觀': { kws: [
      '外殼','機構','按鍵','卡榫','破裂','變形','刮傷','螺絲','接頭','端子','排線','連接',
      '插槽','插座','接觸不良','鬆動','歪斜','卡住','開關','滾輪','轉軸','鉸鏈',
      '接觸','接觸差','彈片','彈腳','公頭','母頭','裂縫','塑膠','外觀損','掉落損',
      '散熱','散熱片','風扇','機殼','鎖固','組裝','鈑金',
    ], color:'#94a2b6' },
    '運輸損傷': { kws: [
      '撞傷','摔落','包裝不良','碰損','壓損','包材','運輸損','出貨損','物流損',
      '運輸','出貨','入庫損','碰撞','跌落','包裝破','泡棉','保護不足','撞凹',
    ], color:'#f97316' },
    '通訊/網路': { kws: [
      '網路','wifi','藍牙','zigbee','rf','天線','訊號','通訊','連線','斷線','lan','poe',
      '無線','有線','以太網','乙太網','tcp','ip','udp','mqtt','lte','4g','gprs',
      '訊號弱','收不到訊號','斷網','連線中斷','pairing','配對','連不上','離線',
      'zigbee模組','rf模組','無線模組','通訊模組','連線失敗','網路異常',
    ], color:'#22d3ee' },
    '韌體/軟體': { kws: [
      '韌體','軟體','firmware','程式','當機','重啟','異常關機','無回應','升級','版本','設定','系統','ota',
      '死機','閃退','重開機','更新失敗','升級失敗','系統異常','無法開機','boot',
      '軔體','app','應用程式','程式異常','程式錯誤','跑掉','跑當','hang',
      '設定消失','參數','初始化','factory reset','還原','日誌','log',
    ], color:'#818cf8' },
    '電磁/靜電': { kws: [
      'esd','靜電','靜電損','雷擊','突波損','surge','電磁','干擾','emi','emc',
      '雷突波','接地','漏電','靜電放電','感應電','雜訊干擾',
    ], color:'#fb7185' },
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

    // 信度分級：< 6 個月僅為方向性估算，不宜作為產能或採購決策依據
    const confidence = n >= 6 ? 'forecast' : 'estimate';
    const confidenceLabel = n >= 6 ? '預測' : `短期估算（資料僅 ${n} 個月，信度低，建議持續蒐集至6個月以上）`;

    return {
      ready: true, confidence, confidenceLabel, forecast, linearPred, ma, lastCount, trendDir,
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
      // 若記錄有實際工時欄位，用實際工時估算；否則用設定單價
      const labor = r.labor_hours != null && laborPerRepair > 0
        ? r.labor_hours * laborPerRepair
        : laborPerRepair;
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

  // ─── Component-category Pareto (故障零件大類根因)
  // Rolls the per-month 故障零件總數 catalogue (品號) up into 大類 via RepairParser,
  // so we can see the NATURE of failures (連接器 / 電源 / IC / 開關 / 機構…).
  function componentCategoryPareto(db, filter) {
    const { months } = filter || {};
    const monthKeys = months && months.length ? months : Object.keys(db.months);
    const inScope = new Set(getRecords(db, filter).map(r => r.model));
    const pcat = (typeof window !== 'undefined' && window.RepairParser && window.RepairParser.partCategoryByPno)
      ? window.RepairParser.partCategoryByPno : (() => null);
    const cat = new Map();          // 大類 → { count, parts: Map }
    let uncategorized = 0, total = 0;
    for (const mk of monthKeys) {
      const m = db.months[mk];
      if (!m || !m.partCatalog) continue;
      for (const [model, parts] of Object.entries(m.partCatalog)) {
        if (inScope.size && !inScope.has(model)) continue;
        for (const p of parts) {
          const q = Number(p.count) || 0;
          if (!q) continue;
          total += q;
          const c = pcat(p.code);
          if (!c) { uncategorized += q; continue; }
          if (!cat.has(c)) cat.set(c, { count: 0, parts: new Map() });
          const e = cat.get(c);
          e.count += q;
          const label = String(p.name || p.code || '').trim();
          if (label) e.parts.set(label, (e.parts.get(label) || 0) + q);
        }
      }
    }
    const list = Array.from(cat.entries())
      .map(([name, e]) => ({
        name, count: e.count, pct: total ? e.count / total : 0,
        topParts: Array.from(e.parts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([n, c]) => ({ name: n, count: c })),
      }))
      .sort((a, b) => b.count - a.count);
    return { list, total, uncategorized };
  }

  const YM = /^\d{4}-\d{2}$/;
  const ym = v => (v && YM.test(v)) ? v : null;
  const topEntry = map => {
    let best = null;
    for (const [m, c] of map) if (!best || c > best.count) best = { month: m, count: c };
    return best;
  };
  const toBatches = map => Array.from(map.entries()).map(([m, c]) => ({ month: m, count: c })).sort((a, b) => b.count - a.count);

  // ─── Manufacture-batch analysis (製造批次 / 出廠批次)
  // Two date dimensions per unit:
  //   • orderMonth (製令)   = ORIGINAL factory batch — never changes ("身分證")
  //   • mfg        (製造日期) = RE-STAMPED on refurbishment (= origin if never re-worked)
  // Condition: 全新 (mfg==order) vs 整新 (mfg!=order).
  // Signals (per model):
  //   • 出廠批次集中: one 製令 origin month dominates → 元件/製程瑕疵落在該原始批次
  //   • 製造批次集中: one 製造日期 month dominates (neutral; 製令 disambiguates birth vs refurb)
  //   • 全新早夭:   全新品且 出廠月==檢修月 → 原廠新品早夭（原始生產/來料責任）
  //   • 整新後即壞: 整新品且 整新月==檢修月 → 整新製程責任
  function batchAnalysis(records, opts) {
    const minN = (opts && opts.minN) || 5;
    const conc = (opts && opts.conc) || 0.4;
    const byModel = new Map();
    for (const r of records) {
      if (!byModel.has(r.model)) byModel.set(r.model, {
        model: r.model, category: r.category, total: 0,
        dated: 0, withOrder: 0, brandNew: 0, refurb: 0,
        originB: new Map(), mfgB: new Map(),
        earlyNew: 0, earlyRefurb: 0, earlyMfgOnly: 0,
      });
      const e = byModel.get(r.model);
      e.total++;
      const mfg = ym(r.mfg);
      const order = ym(r.orderMonth);
      const rm = String(r.date || '').slice(0, 7);
      if (mfg) { e.dated++; e.mfgB.set(mfg, (e.mfgB.get(mfg) || 0) + 1); }
      if (order) { e.withOrder++; e.originB.set(order, (e.originB.get(order) || 0) + 1); }
      if (r.condition === '全新') { e.brandNew++; if (order && order === rm) e.earlyNew++; }
      else if (r.condition === '整新') { e.refurb++; if (mfg && mfg === rm) e.earlyRefurb++; }
      else if (mfg && !order && mfg === rm) { e.earlyMfgOnly++; }  // ambiguous: 缺製令無法判定全新/整新
    }
    const out = [];
    for (const e of byModel.values()) {
      const topOrigin = topEntry(e.originB);
      const topMfg = topEntry(e.mfgB);
      const topOriginPct = topOrigin && e.withOrder ? topOrigin.count / e.withOrder : 0;
      const topMfgPct = topMfg && e.dated ? topMfg.count / e.dated : 0;
      const flags = [];
      if (e.withOrder >= minN && topOriginPct >= conc) flags.push('出廠批次集中');
      // 製造日期集中 — neutral: without 製令 we can't say if it's a birth-batch or a refurb梯次
      if (e.dated >= minN && topMfgPct >= conc) flags.push('製造批次集中');
      if (e.earlyNew >= minN) flags.push('全新早夭');
      if (e.earlyRefurb >= minN) flags.push('整新後即壞');
      out.push({
        model: e.model, category: e.category, total: e.total,
        dated: e.dated, withOrder: e.withOrder,
        brandNew: e.brandNew, refurb: e.refurb,
        unknownCond: e.total - e.brandNew - e.refurb,
        originBatches: toBatches(e.originB).slice(0, 8),
        mfgBatches: toBatches(e.mfgB).slice(0, 8),
        topOrigin, topOriginPct, topMfg, topMfgPct,
        earlyNew: e.earlyNew, earlyRefurb: e.earlyRefurb, earlyMfgOnly: e.earlyMfgOnly,
        flags,
      });
    }
    out.sort((a, b) => (b.flags.length - a.flags.length) || (b.total - a.total));
    return out;
  }

  // ─── 全新 vs 整新 overall split + scrap by condition
  function conditionSummary(records) {
    const c = { 全新: 0, 整新: 0, 未知: 0 };
    const scrap = { 全新: 0, 整新: 0, 未知: 0 };
    for (const r of records) {
      const k = r.condition === '全新' ? '全新' : r.condition === '整新' ? '整新' : '未知';
      c[k]++; if (r.isScrap) scrap[k]++;
    }
    const total = records.length;
    const known = c.全新 + c.整新;
    return {
      total, known,
      brandNew: c.全新, refurb: c.整新, unknown: c.未知,
      brandNewPct: total ? c.全新 / total : 0,
      refurbPct: total ? c.整新 / total : 0,
      unknownPct: total ? c.未知 / total : 0,
      scrap,
      brandNewScrapPct: c.全新 ? scrap.全新 / c.全新 : 0,
      refurbScrapPct: c.整新 ? scrap.整新 / c.整新 : 0,
    };
  }

  // ─── 出廠批次 Pareto (依製令出廠年月) — 元件瑕疵落點
  // Which ORIGINAL production batches (by 製令 year-month) generate the most failures?
  // Optionally scoped to one model. Returns sorted [{month, count, pct, scrap, models}].
  function originBatchPareto(records, opts) {
    const model = opts && opts.model;
    const byMonth = new Map();
    let total = 0;
    for (const r of records) {
      if (model && r.model !== model) continue;
      const o = ym(r.orderMonth);
      if (!o) continue;
      total++;
      if (!byMonth.has(o)) byMonth.set(o, { count: 0, scrap: 0, models: new Set() });
      const e = byMonth.get(o);
      e.count++; if (r.isScrap) e.scrap++; e.models.add(r.model);
    }
    const list = Array.from(byMonth.entries())
      .map(([month, e]) => ({ month, count: e.count, pct: total ? e.count / total : 0, scrap: e.scrap, models: Array.from(e.models) }))
      .sort((a, b) => b.count - a.count || (a.month < b.month ? 1 : -1));
    return { list, total };
  }

  // ════════════════════════════════════════════════════════════════════
  // 型號名稱稽核（資料品質）
  //   合併規則分兩級：
  //   (1) 可判斷 → 自動合併：大小寫、連字號/底線/空格差異（語意上必為同型號）
  //   (2) 無法判斷 → 警示請填寫人員修正：易混淆字元（O↔0、I↔1…）或僅差一兩個
  //       字元的相似名稱（可能是輸入錯誤，也可能真的是不同型號，系統不擅自合併）
  // ════════════════════════════════════════════════════════════════════

  // 唯一真實來源：型號正規化（自動合併「可判斷」差異）
  const MODEL_STRIP_RE = /[-_\s]/g;
  function normalizeModel(raw) {
    if (raw == null) return '';
    return String(raw).toUpperCase().replace(MODEL_STRIP_RE, '');
  }

  // 易混淆字元折疊 — 僅供「相似度比對」，不改變實際儲存 key。
  // 只折疊「字母 vs 數字」這種視覺上真歧義、且型號命名不會用來區分產品的對：
  //   O↔0、I↔1、L↔1。
  // 刻意不含 S/5、B/8、Z/2、G/6 等——本產品線的型號碼會用這些字元做為
  //   有意義的不同尾碼（如 ...3Z 與 ...32 是兩個獨立型號），折疊會造成大量誤報。
  const CONFUSE_MAP = { O: '0', I: '1', L: '1' };
  function confusableFold(key) {
    let out = '';
    for (const ch of key) out += (CONFUSE_MAP[ch] || ch);
    return out;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  function auditModels(db) {
    const info = new Map(); // canonicalKey → 聚合資訊
    const ensure = (key) => {
      if (!info.has(key)) {
        info.set(key, {
          key,
          variants: new Map(), // 原始顯示寫法 → 件數
          count: 0,
          months: new Set(),
          sheets: new Set(),
          inRecords: false,
          inDenom: false,
        });
      }
      return info.get(key);
    };

    for (const [mk, m] of Object.entries((db && db.months) || {})) {
      for (const r of (m.records || [])) {
        const key = normalizeModel(r.model);
        if (!key) continue;
        const e = ensure(key);
        e.inRecords = true;
        e.count++;
        e.months.add(mk);
        if (r.sheet) e.sheets.add(r.sheet);
        const raw = String(r.modelDisplay || r.modelRaw || r.model || '').trim();
        if (raw) e.variants.set(raw, (e.variants.get(raw) || 0) + 1);
      }
      for (const dk of Object.keys(m.denominators || {})) {
        const key = normalizeModel(dk);
        if (!key) continue;
        const e = ensure(key);
        e.inDenom = true;
        e.months.add(mk);
        const raw = String(dk).trim();
        if (raw && !e.variants.has(raw)) e.variants.set(raw, 0);
      }
    }

    const keys = [...info.keys()];

    // 權威生產品名目錄：整新數彙總表機種 ∪ 零件目錄機種 ∪ 各機種工作表名稱。
    // 凡列入此目錄者，皆為已確立的獨立生產型號。兩個名稱若都在目錄中，代表
    // 它們是各自獨立登錄的型號（例如 THSM010 與 THS0010），即使長得相似也不警示。
    const knownModels = new Set();
    for (const [, m] of Object.entries((db && db.months) || {})) {
      for (const dk of Object.keys(m.denominators || {})) {
        const k = normalizeModel(dk); if (k) knownModels.add(k);
      }
      for (const pk of Object.keys(m.partCatalog || {})) {
        const k = normalizeModel(pk); if (k) knownModels.add(k);
      }
      for (const sk of Object.keys(m.sheetMeta || {})) {
        const k = normalizeModel(sk); if (k) knownModels.add(k);
      }
    }

    // (1) 已自動合併：同一 key 下有多種原始寫法（僅資訊，不需動作）
    const merged = [];
    for (const e of info.values()) {
      const distinct = [...e.variants.keys()].filter(Boolean);
      if (distinct.length > 1) {
        merged.push({
          key: e.key,
          count: e.count,
          months: [...e.months].sort(),
          variants: [...e.variants.entries()]
            .map(([raw, c]) => ({ raw, count: c }))
            .sort((a, b) => b.count - a.count),
        });
      }
    }
    merged.sort((a, b) => b.count - a.count);

    // (2) 疑似同型號但系統無法確定 → 請填寫人員確認
    const suspicious = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i], b = keys[j];
        // 兩者皆為已確立的生產型號 → 確定是不同型號，不警示
        if (knownModels.has(a) && knownModels.has(b)) continue;
        // 僅在「除去字母/數字易混淆字元後完全相同」時才警示。
        // 例：MSM0801 與 MSMO801（0 vs 字母O）。產品碼以 A/B、3/8、Z/2 等
        // 區分型號的情形不會在此誤觸，因為那些是不同字元、折疊後仍不相等。
        if (a === b) continue;
        const fa = confusableFold(a), fb = confusableFold(b);
        if (fa !== fb) continue;
        const reason = '兩個名稱只差字母與數字的易混淆字元（O↔0、I↔1、L↔1），且其中一個不在生產品名清單中，疑似同一型號被打成兩種寫法';
        const confidence = 'high';
        const ea = info.get(a), eb = info.get(b);
        suspicious.push({
          a: { key: a, count: ea.count, months: [...ea.months].sort(), sheets: [...ea.sheets], known: knownModels.has(a) },
          b: { key: b, count: eb.count, months: [...eb.months].sort(), sheets: [...eb.sheets], known: knownModels.has(b) },
          reason,
          confidence,
        });
      }
    }
    const cw = { high: 0, medium: 1, low: 2 };
    suspicious.sort((x, y) =>
      (cw[x.confidence] - cw[y.confidence]) ||
      ((y.a.count + y.b.count) - (x.a.count + x.b.count))
    );

    return { merged, suspicious, totalModels: keys.length };
  }

  // Expose
  window.RepairAnalyzer = {
    getRecords,
    normalizeModel,
    auditModels,
    getDenominators,
    computeKPIs,
    partPareto,
    modelRank,
    modelHistory,
    getModelSupplement,
    modelSupplementHistory,
    modelSupplementReasons,
    modelSupplementAnnual,
    knownModels,
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
    componentCategoryPareto,
    batchAnalysis,
    conditionSummary,
    originBatchPareto,
    FAULT_TAXONOMY,
  };
})();
