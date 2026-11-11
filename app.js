(function () {
  'use strict';
  var G = window.TalabatGen, ML = window.ML, Fe = window.Features, Ch = window.Charts;
  var $ = function (id) { return document.getElementById(id); };
  var WINDOW = 4000, SEED_N = 1500, SEED = 2026, ROLL = 300;
  var SVC = G.C.services, SVC_KEYS = SVC.map(function (s) { return s[0]; }), SVC_NAMES = SVC.map(function (s) { return s[1]; });

  var S = {
    rows: [], rng: null, nextId: 0, acc: 0, params: { keetaPromo: false, serviceIssues: false, ramadan: false },
    playing: true, speed: 3, version: 1, sessionNew: 0, history: [], models: {}, training: false, trainingName: '', tab: 'overview', t0: Date.now(),
    ui: { k: 3, thr: 0.5, minSup: 0.05, minConf: 0.3, minLift: 1.2, cost: 15, profit: 22, imp: 0.1, delta: 0.10, sel: { int_mart_grocery: 1 }, reduction: 25, sim: null, wi: null }
  };

  /* ---------- formatting ---------- */
  function pct(v, d) { return (v * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function pts(v) { return (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + ' pts'; }
  function num(v) { return Math.round(v).toLocaleString('en-US'); }
  function aed(v) { return 'AED ' + num(v); }
  function pval(p) { return p < 0.001 ? '< 0.001' : p.toFixed(3); }
  function ago(ms) { var s = Math.round((Date.now() - ms) / 1000); return s < 2 ? 'just now' : s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'; }
  function esc(s) { return Ch.esc(s); }
  var CS = null;
  function col(name) { if (!CS) CS = getComputedStyle(document.documentElement); return CS.getPropertyValue('--' + name).trim(); }
  function hexRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mix(a, b, t) { var A = hexRgb(a), B = hexRgb(b); t = Math.max(0, Math.min(1, t)); return 'rgb(' + A.map(function (v, i) { return Math.round(v + (B[i] - v) * t); }).join(',') + ')'; }
  function lum(c) { var m = c.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function share(rows, f) { var c = 0; for (var i = 0; i < rows.length; i++) if (f(rows[i])) c++; return rows.length ? c / rows.length : 0; }
  function table(head, body, numCols, rowClass) {
    numCols = numCols || [];
    var h = '<table><thead><tr>' + head.map(function (x, i) { return '<th' + (numCols.indexOf(i) >= 0 ? ' class="n"' : '') + '>' + x + '</th>'; }).join('') + '</tr></thead><tbody>';
    body.forEach(function (r, ri) { h += '<tr' + (rowClass && rowClass(ri) ? ' class="' + rowClass(ri) + '"' : '') + '>' + r.map(function (x, i) { return '<td' + (numCols.indexOf(i) >= 0 ? ' class="n"' : '') + '>' + x + '</td>'; }).join('') + '</tr>'; });
    return h + '</tbody></table>';
  }
  function legend(items) { return items.map(function (it) { return '<span><i class="' + (it.line ? 'ln' : '') + '" style="background:' + it.color + '"></i>' + esc(it.name) + '</span>'; }).join(''); }
  function pill(kind, text) { return '<span class="pill ' + kind + '">' + esc(text) + '</span>'; }
  function waiting(id) { var el = $(id); if (el) el.innerHTML = '<div class="placeholder">Training model on the latest responses…</div>'; }
  function visible(tab) { return S.tab === tab; }

  /* ---------- data stream ---------- */
  function reset() {
    S.rows = G.seedDataset(SEED_N, SEED); S.seed = S.rows.slice(); S.rng = new G.Rng(90210); S.nextId = SEED_N + 1; S.acc = 0; S.sessionNew = 0;
    S.history = []; S.models = {}; S.version++; calibrate();
    for (var end = ROLL; end <= S.rows.length; end += 30) S.history.push(snap(S.rows.slice(end - ROLL, end), end));
  }
  function snap(rows, n) {
    var A = rows.filter(function (r) { return r.scenario_group === 'A_control'; }), B = rows.filter(function (r) { return r.scenario_group === 'B_voucher'; });
    return { n: n, churn: share(rows, function (r) { return r.churn_risk; }), mart: share(rows, function (r) { return r.mart_interested; }),
      uplift: share(B, function (r) { return r.scenario_converted; }) - share(A, function (r) { return r.scenario_converted; }),
      willing: mean(rows.map(function (r) { return r.willing_monthly_spend_aed; })), keeta: share(rows, function (r) { return r.uses_keeta; }), margin: unit(rows).margin };
  }
  function addRows(k) {
    for (var i = 0; i < k; i++) S.rows.push(G.respondent(S.rng, S.nextId++, Date.now(), S.params));
    S.sessionNew += k;
    if (S.rows.length > 20000) S.rows.splice(0, S.rows.length - 20000);
    S.version++;
    S.history.push(snap(S.rows.slice(-ROLL), S.rows.length));
    if (S.history.length > 140) S.history.shift();
  }
  function win() { return S.rows.length > WINDOW ? S.rows.slice(-WINDOW) : S.rows.slice(); }

  /* ---------- models ---------- */
  function classifiers(M, y, sp) {
    var bins = ML.bins(M, sp.train, 32);
    var defs = [
      ['Logistic regression', function () { return ML.logistic(M, y, sp.train); }],
      ['Decision tree (depth 3)', function () { return ML.tree(M, y, sp.train, { bins: bins, maxDepth: 3 }); }],
      ['Gradient boosting', function () { return ML.boost(M, y, sp.train, { style: 'gbm', rounds: 80, eta: 0.1, bins: bins }); }],
      ['XGBoost', function () { return ML.boost(M, y, sp.train, { style: 'xgb', rounds: 80, eta: 0.12, lambda: 1, gamma: 0.1, bins: bins }); }]
    ];
    return defs.map(function (d) {
      var t = performance.now(), m = d[1](), ms = performance.now() - t, prob = ML.predictAll(m, M.n);
      return { name: d[0], m: m, prob: prob, met: ML.classMetrics(prob, y, sp.test, 0.5), ms: ms };
    });
  }
  function normImp(imp, labels) {
    var tot = imp.reduce(function (a, b) { return a + b; }, 0) || 1;
    return imp.map(function (v, i) { return { label: labels[i], value: v / tot }; }).sort(function (a, b) { return b.value - a.value; });
  }
  function trainChurn(rows) {
    var M = ML.matrix(rows, Fe.get('churn')), y = ML.vector(rows, function (r) { return r.churn_risk; }), sp = ML.split(rows.length, 0.25, 42);
    var ms = classifiers(M, y, sp), best = ms.slice().sort(function (a, b) { return b.met.auc - a.met.auc; })[0], xgb = ms[3];
    var probById = new Map(); rows.forEach(function (r, i) { probById.set(r.respondent_id, xgb.prob[i]); });
    return { rows: rows, M: M, y: y, sp: sp, models: ms, best: best, xgb: xgb, lr: ms[0], probById: probById, imp: normImp(xgb.m.importance, M.labels) };
  }
  function trainMart(rows) {
    var M = ML.matrix(rows, Fe.get('mart')), y = ML.vector(rows, function (r) { return r.mart_interested; }), sp = ML.split(rows.length, 0.25, 43);
    var ms = classifiers(M, y, sp), best = ms.slice().sort(function (a, b) { return b.met.auc - a.met.auc; })[0], xgb = ms[3];
    var prospects = rows.map(function (r, i) { return { r: r, p: xgb.prob[i] }; }).filter(function (o) { return !o.r.used_mart; }).sort(function (a, b) { return b.p - a.p; });
    return { rows: rows, M: M, y: y, sp: sp, models: ms, best: best, xgb: xgb, prospects: prospects, imp: normImp(xgb.m.importance, M.labels) };
  }
  function trainSpend(rows) {
    var feats = Fe.get('spend'), M = ML.matrix(rows, feats), y = ML.vector(rows, function (r) { return r.willing_monthly_spend_aed; }), sp = ML.split(rows.length, 0.25, 44);
    var bins = ML.bins(M, sp.train, 32);
    var defs = [
      ['Linear regression', function () { return ML.linear(M, y, sp.train, { l2: 1 }); }],
      ['Gradient boosting', function () { return ML.boost(M, y, sp.train, { style: 'gbm', loss: 'squared', rounds: 100, eta: 0.1, bins: bins }); }],
      ['XGBoost', function () { return ML.boost(M, y, sp.train, { style: 'xgb', loss: 'squared', rounds: 100, eta: 0.1, lambda: 1, bins: bins }); }]
    ];
    var ms = defs.map(function (d) { var t = performance.now(), m = d[1](), msec = performance.now() - t, pred = ML.predictAll(m, M.n); return { name: d[0], m: m, pred: pred, met: ML.regMetrics(pred, y, sp.test), ms: msec }; });
    var best = ms.slice().sort(function (a, b) { return b.met.r2 - a.met.r2; })[0], xgb = ms[2];
    var predById = new Map(); rows.forEach(function (r, i) { predById.set(r.respondent_id, xgb.pred[i]); });
    var lin = ms[0].m, coefs = lin.w.map(function (w, j) { return { label: M.labels[j], w: w }; }).sort(function (a, b) { return Math.abs(b.w) - Math.abs(a.w); });
    return { rows: rows, M: M, y: y, sp: sp, models: ms, best: best, xgb: xgb, lin: ms[0], predById: predById, coefs: coefs, imp: normImp(xgb.m.importance, M.labels), keys: M.keys };
  }
  var SEG_NAMES = { 2: ['Most probable', 'Least probable'], 3: ['Most probable', 'Medium probable', 'Least probable'], 4: ['Most probable', 'Medium-high', 'Medium-low', 'Least probable'], 5: ['Most probable', 'High-medium', 'Medium', 'Low-medium', 'Least probable'] };
  var SEG_COLORS = ['s1', 's2', 's3', 's4', 's5'];
  function trainSegments(rows) {
    // RFM scored as percentile ranks (0 = worst, 1 = best), the usual RFM scoring scale, then clustered
    var R = prank(rows.map(function (r) { return -r.recency_days; })), F = prank(rows.map(function (r) { return r.orders_per_month; })), Mo = prank(rows.map(function (r) { return r.talabat_monthly_spend_aed; }));
    var Z = rows.map(function (_, i) { return [R[i], F[i], Mo[i]]; });
    var sample = Z.filter(function (_, i) { return Z.length <= 1500 || i % Math.ceil(Z.length / 1500) === 0; });
    var elbow = [1, 2, 3, 4, 5, 6, 7, 8].map(function (k) { return [k, ML.kmeans(sample, k, { nInit: 2, seed: 3 }).inertia / sample.length]; });
    var k = S.ui.k, km = ML.kmeans(Z, k, { nInit: 4, seed: 11 }), sil = ML.silhouette(Z, km.labels, k, 400, 5);
    var prof = [];
    for (var c = 0; c < k; c++) {
      var g = rows.filter(function (_, i) { return km.labels[i] === c; });
      prof.push({ c: c, n: g.length, rec: mean(g.map(function (r) { return r.recency_days; })), orders: mean(g.map(function (r) { return r.orders_per_month; })),
        spend: mean(g.map(function (r) { return r.talabat_monthly_spend_aed; })), churn: share(g, function (r) { return r.churn_risk; }), pro: share(g, function (r) { return r.pro_status === 'Current'; }),
        mart: share(g, function (r) { return r.mart_interested; }), willing: mean(g.map(function (r) { return r.willing_monthly_spend_aed; })), keeta: share(g, function (r) { return r.uses_keeta; }) });
    }
    prof.sort(function (a, b) { return b.spend - a.spend; });
    var rankOf = {}; prof.forEach(function (p, i) { p.rank = i; p.name = SEG_NAMES[k][i]; rankOf[p.c] = i; });
    var segById = new Map(); rows.forEach(function (r, i) { segById.set(r.respondent_id, rankOf[km.labels[i]]); });
    return { rows: rows, k: k, labels: km.labels, rankOf: rankOf, prof: prof, elbow: elbow, sil: sil, segById: segById, inertia: km.inertia / rows.length };
  }
  function trainAB(rows) {
    function test(sub) {
      var A = sub.filter(function (r) { return r.scenario_group === 'A_control'; }), B = sub.filter(function (r) { return r.scenario_group === 'B_voucher'; });
      var xa = A.reduce(function (s, r) { return s + r.scenario_converted; }, 0), xb = B.reduce(function (s, r) { return s + r.scenario_converted; }, 0);
      var z = ML.twoPropZ(xa, Math.max(1, A.length), xb, Math.max(1, B.length));
      z.welch = ML.welch(A.map(function (r) { return r.scenario_order_intent; }), B.map(function (r) { return r.scenario_order_intent; }));
      return z;
    }
    var all = test(rows);
    var segs = [
      ['talabat pro members', function (r) { return r.pro_status === 'Current'; }],
      ['Not pro members', function (r) { return r.pro_status !== 'Current'; }],
      ['Discounts very important (E1 = 4–5)', function (r) { return r.discount_importance >= 4; }],
      ['Discounts unimportant (E1 = 1–2)', function (r) { return r.discount_importance <= 2; }],
      ['Heavy users (8+ orders a month)', function (r) { return r.orders_per_month >= 8; }],
      ['Light users (0–2 orders a month)', function (r) { return r.orders_per_month <= 2; }]
    ].map(function (s) { var sub = rows.filter(s[1]); return { name: s[0], n: sub.length, z: test(sub) }; });
    return { all: all, segs: segs, ss: ML.sampleSize(all.p1, all.p2, 0.8), n: rows.length };
  }
  function trainUplift(rows) {
    var M = ML.matrix(rows, Fe.get('uplift')), y = ML.vector(rows, function (r) { return r.scenario_converted; }), tr = ML.vector(rows, function (r) { return r.scenario_group === 'B_voucher' ? 1 : 0; });
    var sp = ML.split(rows.length, 0.4, 45), u = ML.uplift(M, y, tr, sp.train, sp.test, { rounds: 40, eta: 0.1, lambda: 5, minLeaf: 25 });
    var a = sp.test.map(function (i) { return u.uplift[i]; }), b = sp.test.map(function (i) { return rows[i]._true_uplift; });
    var ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    var byLevel = [1, 2, 3, 4, 5].map(function (lv) {
      var idx = []; rows.forEach(function (r, i) { if (r.discount_importance === lv) idx.push(i); });
      var A = idx.filter(function (i) { return !tr[i]; }), B = idx.filter(function (i) { return tr[i]; });
      return { lv: lv, n: idx.length, obs: mean(B.map(function (i) { return y[i]; })) - mean(A.map(function (i) { return y[i]; })), pred: mean(idx.map(function (i) { return u.uplift[i]; })) };
    });
    return { rows: rows, M: M, y: y, tr: tr, sp: sp, u: u, corr: sab / Math.sqrt(saa * sbb || 1), byLevel: byLevel, imp: normImp(u.importance, M.labels) };
  }
  function trainRules(rows) {
    var ap = ML.apriori(rows, SVC_KEYS, S.ui.minSup, 3), n = rows.length, k = SVC_KEYS.length;
    var cnt = [], one = SVC_KEYS.map(function (key) { return share(rows, function (r) { return r[key]; }); });
    for (var i = 0; i < k; i++) { cnt.push([]); for (var j = 0; j < k; j++) cnt[i].push(0); }
    rows.forEach(function (r) { for (var i = 0; i < k; i++) if (r[SVC_KEYS[i]]) for (var j = 0; j < k; j++) if (r[SVC_KEYS[j]]) cnt[i][j]++; });
    var lift = cnt.map(function (row, i) { return row.map(function (c, j) { return i === j ? null : (c / n) / ((one[i] * one[j]) || 1); }); });
    var conf = cnt.map(function (row, i) { return row.map(function (c, j) { return i === j ? null : c / (cnt[i][i] || 1); }); });
    return { ap: ap, lift: lift, conf: conf, one: one, n: n };
  }

  var DEFS = {
    segments: { label: 'K-means clustering', tabs: ['overview', 'retention'], fn: trainSegments },
    churn: { label: 'Churn classifiers', tabs: ['overview', 'retention'], fn: trainChurn },
    spend: { label: 'Spend regression', tabs: ['overview', 'retention', 'grocery'], fn: trainSpend },
    ab: { label: 'A/B test', tabs: ['overview', 'discounts'], fn: trainAB },
    uplift: { label: 'Uplift model', tabs: ['overview', 'discounts'], fn: trainUplift },
    rules: { label: 'Apriori rules', tabs: ['overview', 'grocery'], fn: trainRules },
    mart: { label: 'talabat mart classifiers', tabs: ['overview', 'grocery'], fn: trainMart }
  };
  function stale(name) { var m = S.models[name]; return !m || m.dirty || (m.version < S.version && Date.now() - m.at > 4000); }
  function schedule() {
    if (S.training) return;
    var names = Object.keys(DEFS), pick = null, i;
    for (i = 0; i < names.length && !pick; i++) if (DEFS[names[i]].tabs.indexOf(S.tab) >= 0 && stale(names[i])) pick = names[i];
    for (i = 0; i < names.length && !pick; i++) if (stale(names[i])) pick = names[i];
    if (!pick) return;
    S.training = true; S.trainingName = DEFS[pick].label; renderStatus();
    setTimeout(function () {
      var rows = win(), t = performance.now();
      try { S.models[pick] = { res: DEFS[pick].fn(rows), version: S.version, at: Date.now(), ms: performance.now() - t, n: rows.length }; }
      catch (e) { console.error(pick, e); S.models[pick] = { res: null, version: S.version, at: Date.now(), ms: 0, n: rows.length, err: String(e) }; }
      S.training = false; S.trainingName = '';
      onModel(pick);
    }, 30);
  }
  function M_(name) { var m = S.models[name]; return m && m.res ? m.res : null; }

  /* ---------- rendering: shared ---------- */
  function renderStatus() {
    var st = $('status');
    var lastAt = Object.keys(S.models).reduce(function (a, k) { return Math.max(a, S.models[k].at); }, 0);
    st.innerHTML = '<span class="live' + (S.playing ? '' : ' paused') + '"><i></i>' + (S.playing ? 'Live' : 'Paused') + '</span>' +
      '<span><b>' + num(S.rows.length) + '</b> responses</span><span><b>+' + num(S.sessionNew) + '</b> this session</span>' +
      '<span>' + (S.training ? 'Training: ' + esc(S.trainingName) + '…' : (lastAt ? 'Models updated ' + ago(lastAt) : 'Starting models…')) + '</span>';
  }
  function kpi(label, value, sub, sparkVals, sparkColor) {
    return '<div class="kpi"><div class="lab">' + esc(label) + '</div><div class="row"><div class="val">' + value + '</div>' + (sparkVals ? Ch.spark(sparkVals, sparkColor || col('s1'), 96, 28) : '') + '</div><div class="sub">' + sub + '</div></div>';
  }
  function hist(key) { return S.history.map(function (h) { return h[key]; }); }
  function delta(cur, base, goodWhenUp, fmt) {
    var d = cur - base, cls = Math.abs(d) < 0.005 ? '' : ((d > 0) === goodWhenUp ? 'up-good' : 'up-bad');
    return '<span class="' + cls + '">' + fmt(d) + '</span>';
  }

  /* ---------- Overview ---------- */
  function renderOverview() {
    var all = S.rows, last = S.rows.slice(-ROLL), h0 = S.history[0] || snap(last, 0);
    var ab = M_('ab'), seg = M_('segments');
    $('ov-kpis').innerHTML =
      kpi('Survey responses', num(all.length), '+' + num(S.sessionNew) + ' streamed this session', hist('n'), col('s1')) +
      kpi('Churn risk (latest 300)', pct(snap(last).churn), delta(snap(last).churn, h0.churn, false, pts) + ' vs start · answered 4–5 on G1', hist('churn'), col('crit')) +
      kpi('Voucher uplift (A/B)', ab ? pts(ab.all.diff) : '…', ab ? 'p = ' + pval(ab.all.p) + ' · ' + num(ab.n) + ' respondents' : 'Running test…', hist('uplift'), col('s2')) +
      kpi('talabat mart interest (latest 300)', pct(snap(last).mart), delta(snap(last).mart, h0.mart, true, pts) + ' vs start · answered 4–5 on G4', hist('mart'), col('s3')) +
      kpi('Willing monthly spend (latest 300)', aed(snap(last).willing), 'Average answer to H4', hist('willing'), col('s1')) +
      kpi('Adj. EBITDA margin, modelled (latest 500)', pct(unit(S.rows.slice(-500)).margin), 'Calibrated to reported 5.0% · see P&amp;L tab', hist('margin'), col('s1'));

    var ch = M_('churn'), up = M_('uplift'), ru = M_('rules'), mart = M_('mart');
    var low = seg ? seg.prof[seg.prof.length - 1] : null, high = seg ? seg.prof[0] : null;
    var waste = up ? wasted(up) : null;
    var topRule = ru ? ML.rules(ru.ap, S.ui.minConf, S.ui.minLift).filter(function (r) { return r.ante.length === 2; })[0] : null;
    var cards = [
      { tab: 'retention', n: 1, color: col('s1'), title: 'Low-value customers are leaving', stmt: 'Rivals like Keeta win price-sensitive, infrequent customers. Who is leaving, and who is worth saving?',
        head: low ? pct(low.churn, 0) + ' vs ' + pct(high.churn, 0) : '…', sub: low ? 'churn risk: least vs most probable segment' : 'Clustering…', algos: ['K-means', 'XGBoost', 'Gradient boosting', 'Logistic', 'Regression'] },
      { tab: 'discounts', n: 2, color: col('s2'), title: 'Vouchers are squeezing margins', stmt: 'Many vouchers go to people who would order anyway. Who does a voucher actually persuade?',
        head: waste !== null ? pct(waste, 0) : '…', sub: waste !== null ? 'of voucher redemptions would have happened anyway' : 'Training uplift model…', algos: ['A/B test', 'Uplift (XGBoost)', 'Market response'] },
      { tab: 'grocery', n: 3, color: col('s3'), title: 'Food-only customers skip groceries', stmt: 'Food + grocery customers spend far more. Which services go together, and who will try talabat mart?',
        head: topRule ? '×' + topRule.lift.toFixed(2) : '…', sub: topRule ? esc(topRule.ante.map(function (i) { return SVC_NAMES[i]; }).join(' + ')) + ' → ' + esc(SVC_NAMES[topRule.cons]) : 'Mining rules…', algos: ['Apriori', 'XGBoost', 'Regression'] }
    ];
    $('ov-problems').innerHTML = cards.map(function (c) {
      return '<a class="pcard" href="#' + c.tab + '" data-goto="' + c.tab + '"><span class="stripe" style="background:' + c.color + '"></span><span class="pnum">Problem ' + c.n + '</span><h3>' + esc(c.title) + '</h3><p class="stmt">' + esc(c.stmt) + '</p>' +
        '<div class="head">' + c.head + '<small>' + c.sub + '</small></div><div class="chips">' + c.algos.map(function (a) { return '<span class="chip">' + esc(a) + '</span>'; }).join('') + '</div><span class="open">Open live analysis →</span></a>';
    }).join('');

    var hs = S.history;
    $('ov-trend-legend').innerHTML = legend([{ name: 'Churn risk', color: col('crit'), line: 1 }, { name: 'talabat mart interest', color: col('s3'), line: 1 }, { name: 'Uses Keeta', color: col('s2'), line: 1 }]);
    Ch.line($('ov-trend'), {
      series: [
        { name: 'Churn risk', color: col('crit'), pts: hs.map(function (h) { return [h.n, h.churn]; }) },
        { name: 'Mart interest', color: col('s3'), pts: hs.map(function (h) { return [h.n, h.mart]; }) },
        { name: 'Keeta use', color: col('s2'), pts: hs.map(function (h) { return [h.n, h.keeta]; }) }
      ], y: [0, 0.7], yFmt: Ch.pctAxis, tipFmt: function (v) { return pct(v); }, xFmt: function (v) { return num(v); }, xLabel: 'Responses collected', h: 300, endLabels: true
    });
    renderFeed();
    renderBoard();
  }
  function renderFeed() {
    var rows = S.rows.slice(-8).reverse();
    $('ov-feed').innerHTML = table(['ID', 'Country', 'Age', 'Orders/mo', 'Spend', 'Churn intent', 'Mart intent', 'Scenario'],
      rows.map(function (r) { return [esc(r.respondent_id), esc(r.country), esc(r.age_group), r.orders_per_month, aed(r.talabat_monthly_spend_aed), r.churn_intent + '/5' + (r.churn_risk ? ' ' + pill('crit', 'at risk') : ''), r.mart_order_intent + '/5', r.scenario_group === 'B_voucher' ? 'Voucher' : 'Control']; }), [3, 4]);
  }
  function renderBoard() {
    var el = $('ov-board'); if (!el) return;
    function m(name) { return S.models[name]; }
    function upd(name) { var x = m(name); return x ? 'n = ' + num(x.n) + ' · ' + ago(x.at) + ' · ' + Math.round(x.ms) + ' ms' : (S.training && S.trainingName === DEFS[name].label ? 'training…' : 'queued'); }
    var seg = M_('segments'), ch = M_('churn'), ab = M_('ab'), up = M_('uplift'), ru = M_('rules'), mt = M_('mart'), sp = M_('spend');
    var nRules = ru ? ML.rules(ru.ap, S.ui.minConf, S.ui.minLift).length : 0;
    var rows = [
      ['Clustering', 'K-means (k-means++, elbow, silhouette)', '1 Retention', seg ? 'k = ' + seg.k + ', silhouette ' + seg.sil.toFixed(2) : '…', upd('segments')],
      ['Classification', 'Logistic · Decision tree · Gradient boosting · XGBoost', '1 Retention', ch ? 'Best: ' + ch.best.name + ', AUC ' + ch.best.met.auc.toFixed(3) : '…', upd('churn')],
      ['Testing', 'Two-proportion z-test, Welch t-test', '2 Discounts', ab ? pts(ab.all.diff) + ', p ' + pval(ab.all.p) : '…', upd('ab')],
      ['Classification (uplift)', 'Two-model XGBoost (T-learner)', '2 Discounts', up ? 'Agreement with simulated truth r = ' + up.corr.toFixed(2) : '…', upd('uplift')],
      ['Association', 'Apriori (support → confidence → lift)', '3 Grocery', ru ? ru.ap.itemsets.length + ' frequent itemsets, ' + nRules + ' rules' : '…', upd('rules')],
      ['Classification', 'Logistic · Decision tree · Gradient boosting · XGBoost', '3 Grocery', mt ? 'Best: ' + mt.best.name + ', AUC ' + mt.best.met.auc.toFixed(3) : '…', upd('mart')],
      ['Regression', 'Linear (ridge) · Gradient boosting · XGBoost', '1 + 3', sp ? 'Best: ' + sp.best.name + ', R² ' + sp.best.met.r2.toFixed(3) : '…', upd('spend')]
    ];
    el.innerHTML = table(['Algorithm family', 'Methods', 'Problem', 'Latest result (test set)', 'Last trained'], rows);
  }

  /* ---------- Problem 1: Retention ---------- */
  function renderP1Kpis() {
    var rows = S.rows.slice(-ROLL), seg = M_('segments');
    var kee = rows.filter(function (r) { return r.uses_keeta; }), non = rows.filter(function (r) { return !r.uses_keeta; });
    $('p1-kpis').innerHTML =
      kpi('Churn risk (latest 300)', pct(share(rows, function (r) { return r.churn_risk; })), 'Answered 4–5 on G1', hist('churn'), col('crit')) +
      kpi('Least probable segment', seg ? pct(seg.prof[seg.prof.length - 1].churn) : '…', seg ? 'churn risk among ' + num(seg.prof[seg.prof.length - 1].n) + ' customers' : 'Clustering…') +
      kpi('Most probable segment', seg ? pct(seg.prof[0].churn) : '…', seg ? 'churn risk among ' + num(seg.prof[0].n) + ' customers' : 'Clustering…') +
      kpi('Keeta users vs others', pct(share(kee, function (r) { return r.churn_risk; }), 0) + ' / ' + pct(share(non, function (r) { return r.churn_risk; }), 0), 'churn risk, latest 300', hist('keeta'), col('s2'));
  }
  function renderSegments() {
    var s = M_('segments'); if (!s) { waiting('p1-seg-scatter'); return; }
    var colors = SEG_COLORS.map(col), r = mulberry(5);
    $('p1-seg-legend').innerHTML = legend(s.prof.map(function (p) { return { name: p.name + ' (' + num(p.n) + ')', color: colors[p.rank] }; }));
    var pts = [], step = Math.max(1, Math.floor(s.rows.length / 900));
    for (var i = 0; i < s.rows.length; i += step) {
      var row = s.rows[i], rk = s.rankOf[s.labels[i]];
      pts.push({ x: row.orders_per_month + (r() - 0.5) * 0.6, y: row.talabat_monthly_spend_aed, c: colors[rk], tip: esc(row.respondent_id) + ' · ' + esc(SEG_NAMES[s.k][rk]) + '<br>' + row.orders_per_month + ' orders/month · ' + esc(aed(row.talabat_monthly_spend_aed)) + '<br>Last order ' + row.recency_days + ' days ago' });
    }
    var ymax = quantile(s.rows.map(function (x) { return x.talabat_monthly_spend_aed; }), 0.985);
    Ch.scatter($('p1-seg-scatter'), { pts: pts, x: [-0.5, quantile(s.rows.map(function (x) { return x.orders_per_month; }), 0.995) + 0.5], y: [0, ymax], xLabel: 'Orders per month (C2)', yLabel: 'Monthly talabat spend, AED', h: 280 });
    Ch.line($('p1-elbow'), { series: [{ name: 'Inertia per customer', color: col('s1'), pts: s.elbow }], x: [1, 8], xTicks: [1, 2, 3, 4, 5, 6, 7, 8], xLabel: 'Number of clusters (k)', yLabel: 'Within-cluster inertia per customer', vlines: [{ x: s.k, label: 'k = ' + s.k }], h: 240, tipFmt: function (v) { return v.toFixed(3); } });
    $('p1-sil').innerHTML = 'Silhouette score <b>' + s.sil.toFixed(3) + '</b> (−1 to 1; above 0.25 means usable structure). Features: recency (C1), frequency (C2) and monetary value (C2 × C3), each scored as a percentile rank from 0 (worst) to 1 (best).';
    $('p1-seg-table').innerHTML = table(['Segment', 'Customers', 'Days since order', 'Orders / month', 'Monthly spend', 'Churn risk', 'pro members', 'Uses Keeta', 'Willing spend'],
      s.prof.map(function (p) { return ['<span class="sw" style="background:' + colors[p.rank] + '"></span>' + esc(p.name), num(p.n), p.rec.toFixed(1), p.orders.toFixed(1), aed(p.spend), pct(p.churn), pct(p.pro), pct(p.keeta), aed(p.willing)]; }), [1, 2, 3, 4, 5, 6, 7, 8]);
    var lo = s.prof[s.prof.length - 1], hi = s.prof[0];
    $('p1-seg-insight').innerHTML = '<b>Reading:</b> the "' + esc(lo.name) + '" segment orders ' + lo.orders.toFixed(1) + ' times a month and last ordered ' + lo.rec.toFixed(0) + ' days ago on average; its churn risk is <b>' + pct(lo.churn) + '</b> against <b>' + pct(hi.churn) + '</b> for "' + esc(hi.name) + '". That gap is Problem 1 in numbers.';
  }
  function mulberry(seed) { return ML.rand(seed); }
  function prank(v) {
    var idx = v.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return a[0] - b[0]; }), out = new Array(v.length), i = 0;
    while (i < idx.length) { var j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; var r = (i + j) / 2 / Math.max(1, v.length - 1); for (var k = i; k <= j; k++) out[idx[k][1]] = r; i = j + 1; }
    return out;
  }
  function quantile(a, q) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(q * b.length))] || 0; }
  var MODEL_COLORS = ['s1', 's2', 's3', 's4'];
  function modelTable(id, res, extra) {
    var bestName = res.best.name;
    $(id).innerHTML = table(['Model', 'Accuracy', 'Precision', 'Recall', 'F1', 'ROC AUC', 'Train time'],
      res.models.map(function (m) { return ['<span class="sw" style="background:' + col(MODEL_COLORS[res.models.indexOf(m)]) + '"></span>' + esc(m.name) + (m.name === bestName ? ' ' + pill('good', 'best AUC') : ''), pct(m.met.acc), pct(m.met.prec), pct(m.met.rec), m.met.f1.toFixed(3), m.met.auc.toFixed(3), Math.round(m.ms) + ' ms']; }),
      [1, 2, 3, 4, 5, 6], function (i) { return res.models[i].name === bestName ? 'best' : ''; }) +
      '<p class="note">Test set: ' + num(res.sp.test.length) + ' respondents (25%), trained on ' + num(res.sp.train.length) + '. Threshold 0.5. ' + (extra || '') + '</p>';
  }
  function rocChart(id, legendId, res) {
    $(legendId).innerHTML = legend(res.models.map(function (m, i) { return { name: m.name + ' (AUC ' + m.met.auc.toFixed(2) + ')', color: col(MODEL_COLORS[i]), line: 1 }; }));
    Ch.line($(id), { series: res.models.map(function (m, i) { return { name: m.name, color: col(MODEL_COLORS[i]), pts: m.met.roc, tip: function (p) { return esc(m.name) + '<br>False positive rate ' + pct(p[0]) + '<br>True positive rate <b>' + pct(p[1]) + '</b>'; } }; }),
      x: [0, 1], y: [0, 1], diag: true, xFmt: Ch.pctAxis, yFmt: Ch.pctAxis, xLabel: 'False positive rate', yLabel: 'True positive rate (recall)', h: 260, endDot: false });
  }
  function cmHtml(cm, labels) {
    var tot = cm.tp + cm.fp + cm.tn + cm.fn || 1, lo = col('seq-lo'), hi = col('seq-hi');
    function cell(v, lab) { var c = mix(lo, hi, v / tot * 2.2), inv = lum(c) < 0.5; return '<div class="cmc' + (inv ? ' inv' : '') + '" style="background:' + c + '" data-tip="' + esc(lab + ': ' + v + ' of ' + tot) + '">' + esc(lab) + '<b>' + v + '</b></div>'; }
    return '<div class="cm"><div></div><div class="cmh">' + labels[2] + '</div><div class="cmh">' + labels[3] + '</div>' +
      '<div class="cmh row">' + labels[0] + '</div>' + cell(cm.tn, 'True negative') + cell(cm.fp, 'False positive') +
      '<div class="cmh row">' + labels[1] + '</div>' + cell(cm.fn, 'False negative') + cell(cm.tp, 'True positive') + '</div>';
  }
  function renderChurn() {
    var c = M_('churn'); if (!c) { waiting('p1-models'); return; }
    modelTable('p1-models', c, 'The churn blog\'s depth-3 tree is the baseline to beat.');
    rocChart('p1-roc', 'p1-roc-legend', c);
    renderThreshold();
    Ch.barH($('p1-imp'), { items: c.imp.slice(0, 10).map(function (d) { return { label: d.label, value: d.value, color: col('s1') }; }), fmt: function (v) { return pct(v); }, labelW: 200 });
  }
  function renderThreshold() {
    var c = M_('churn'); if (!c) return;
    var met = ML.classMetrics(c.xgb.prob, c.y, c.sp.test, S.ui.thr);
    $('thr-out').textContent = S.ui.thr.toFixed(2);
    $('p1-cm').innerHTML = cmHtml(met.cm, ['Actually stayed', 'Actually at risk', 'Predicted stay', 'Predicted at risk']) +
      '<div class="metrics"><span>XGBoost at threshold ' + S.ui.thr.toFixed(2) + '</span><span>Precision <b>' + pct(met.prec) + '</b></span><span>Recall <b>' + pct(met.rec) + '</b></span><span>Flagged <b>' + num(met.cm.tp + met.cm.fp) + '</b> of ' + num(met.n) + '</span>' +
      (met.rec >= 0.7 ? pill('good', 'Meets 70% recall target') : pill('warn', 'Below 70% recall target')) + '</div>';
    renderGrid();
  }
  function renderGrid() {
    var c = M_('churn'), sp = M_('spend'), seg = M_('segments');
    if (!c || !sp) { waiting('p1-grid-cells'); return; }
    var rows = c.rows.filter(function (r) { return sp.predById.has(r.respondent_id); });
    var vals = rows.map(function (r) { return sp.predById.get(r.respondent_id); }), med = quantile(vals, 0.5);
    var cells = { HH: [], HL: [], LH: [], LL: [] };
    rows.forEach(function (r) { var v = sp.predById.get(r.respondent_id), p = c.probById.get(r.respondent_id); cells[(v >= med ? 'H' : 'L') + (p >= S.ui.thr ? 'H' : 'L')].push({ r: r, v: v, p: p }); });
    var def = {
      HH: ['crit', 'Save now', 'Personal save: talabat pro trial, priority support, service-recovery credit'],
      HL: ['good', 'Reward', 'Loyalty perks and early access, no discounts needed'],
      LH: ['warn', 'Nudge cheaply', 'Push reminder; voucher only if the uplift model says it persuades'],
      LL: ['neutral', 'Grow', 'Cross-sell talabat mart and pick-up (see Problem 3)']
    };
    function cell(key) {
      var a = cells[key], d = def[key], barc = { crit: col('crit'), good: col('good'), warn: col('warn'), neutral: col('muted') }[d[0]];
      return '<div class="vr-cell"><span class="bar" style="background:' + barc + '"></span>' + pill(d[0], d[1]) + '<div class="cnt">' + num(a.length) + ' <span class="meta">' + pct(a.length / (rows.length || 1), 0) + ' of customers</span></div>' +
        '<div class="meta">Avg predicted spend ' + aed(mean(a.map(function (o) { return o.v; }))) + ' · avg churn risk ' + pct(mean(a.map(function (o) { return o.p; })), 0) + '</div><div class="act">' + esc(d[2]) + '</div></div>';
    }
    $('p1-grid-cells').innerHTML = '<div></div><div class="ax">Churn risk high (≥ ' + S.ui.thr.toFixed(2) + ')</div><div class="ax">Churn risk low</div>' +
      '<div class="ax">Value high<br>(≥ ' + aed(med) + ')</div>' + cell('HH') + cell('HL') + '<div class="ax">Value low</div>' + cell('LH') + cell('LL');
    // top at-risk high-value customers with main driver from the logistic model
    var lr = c.lr.m, M = c.M, idxById = new Map(); c.rows.forEach(function (r, i) { idxById.set(r.respondent_id, i); });
    var top = cells.HH.slice().sort(function (a, b) { return b.v * b.p - a.v * a.p; }).slice(0, 10);
    $('p1-top').innerHTML = top.length ? table(['Customer', 'Segment', 'Churn risk', 'Predicted spend', 'Main risk drivers (logistic contribution)', 'Action'],
      top.map(function (o) {
        var i = idxById.get(o.r.respondent_id), contrib = [];
        for (var j = 0; j < M.X.length; j++) contrib.push([j, lr.w[j] * (M.X[j][i] - lr.st.mean[j]) / lr.st.sd[j]]);
        contrib.sort(function (a, b) { return b[1] - a[1]; });
        var drivers = contrib.slice(0, 2).filter(function (cc) { return cc[1] > 0; }).map(function (cc) { return esc(M.labels[cc[0]]) + ' = ' + (+M.X[cc[0]][i].toFixed(1)); }).join('; ');
        var sg = seg && seg.segById.has(o.r.respondent_id) ? SEG_NAMES[seg.k][seg.segById.get(o.r.respondent_id)] : '–';
        return [esc(o.r.respondent_id), esc(sg), pct(o.p, 0), aed(o.v), drivers || '–', o.r.pro_status === 'Current' ? 'Priority support + recovery credit' : 'talabat pro trial'];
      }), [2, 3]) : '<p class="placeholder">No customers in this cell at the current threshold.</p>';
  }
  function renderPlanner() {
    var c = M_('churn'), sp = M_('spend');
    var base = 0.5, target = 'High value, high risk';
    if (c && sp) {
      var rows = c.rows.filter(function (r) { return sp.predById.has(r.respondent_id); }), med = quantile(rows.map(function (r) { return sp.predById.get(r.respondent_id); }), 0.5);
      var hh = rows.filter(function (r) { return sp.predById.get(r.respondent_id) >= med && c.probById.get(r.respondent_id) >= S.ui.thr; });
      if (hh.length > 10) base = share(hh, function (r) { return r.churn_risk; });
    }
    var red = S.ui.reduction / 100, p2 = base * (1 - red), n = ML.sampleSize(base, p2, 0.8);
    $('red-out').textContent = S.ui.reduction + '%';
    var sim = S.ui.sim;
    $('p1-plan-out').innerHTML = '<div class="out"><span>Target group: <b>' + target + '</b></span><span>Baseline churn risk in group: <b>' + pct(base) + '</b></span><span>Expected churn with the action: <b>' + pct(p2) + '</b></span>' +
      '<span class="big">' + (isFinite(n) ? num(n) : '–') + ' customers per group</span><span>needed for 80% power at α = 0.05 (two-sided)</span></div>' +
      (sim ? '<div class="out"><span>Simulated test (' + num(sim.n) + ' per group)</span><span>Control churn <b>' + pct(sim.z.p1) + '</b> · Treatment churn <b>' + pct(sim.z.p2) + '</b></span><span>Difference ' + pts(sim.z.diff) + ', 95% CI ' + pts(sim.z.lo) + ' to ' + pts(sim.z.hi) + '</span><span>z = ' + sim.z.z.toFixed(2) + ', p = ' + pval(sim.z.p) + '</span>' + (sim.z.p < 0.05 ? pill('good', 'Significant: scale the action') : pill('warn', 'Not significant: keep testing or drop')) + '</div>' : '');
    S.ui.planBase = base; S.ui.planP2 = p2; S.ui.planN = n;
  }
  function simulateTest() {
    var n = isFinite(S.ui.planN) ? Math.min(S.ui.planN, 20000) : 1000, r = ML.rand(Date.now() & 0xffff), x1 = 0, x2 = 0;
    for (var i = 0; i < n; i++) { if (r() < S.ui.planBase) x1++; if (r() < S.ui.planP2) x2++; }
    S.ui.sim = { n: n, z: ML.twoPropZ(x1, n, x2, n) };
    renderPlanner();
  }

  /* ---------- Problem 2: Discounts ---------- */
  function groups(up) {
    var d = S.ui.delta, counts = { 'Persuadable': 0, 'Sure thing': 0, 'Lost cause': 0, 'Do-not-disturb': 0 }, g = new Array(up.rows.length);
    for (var i = 0; i < up.rows.length; i++) {
      var u = up.u.uplift[i], k = u >= d ? 'Persuadable' : u <= -d ? 'Do-not-disturb' : up.u.pC[i] >= 0.4 ? 'Sure thing' : 'Lost cause';
      g[i] = k; counts[k]++;
    }
    return { g: g, counts: counts };
  }
  function wasted(up) { var c = 0, t = 0; for (var i = 0; i < up.rows.length; i++) { c += up.u.pC[i]; t += up.u.pT[i]; } return t ? c / t : 0; }
  var GROUP_COL = { 'Persuadable': 's1', 'Sure thing': 's3', 'Lost cause': 's4', 'Do-not-disturb': 's8' };
  function renderP2Kpis() {
    var ab = M_('ab'), up = M_('uplift'), rows = S.rows.slice(-ROLL);
    var waste = up ? wasted(up) : null;
    $('p2-kpis').innerHTML =
      kpi('Control conversion (A)', ab ? pct(ab.all.p1) : '…', 'Would order tonight (E3 answer 4–5)') +
      kpi('Voucher conversion (B)', ab ? pct(ab.all.p2) : '…', 'Same question with an AED 15 voucher') +
      kpi('Voucher uplift', ab ? pts(ab.all.diff) : '…', ab ? 'p = ' + pval(ab.all.p) + ', latest 300: ' + pts(snap(rows).uplift) : '', hist('uplift'), col('s2')) +
      kpi('Redemptions that buy nothing', waste !== null ? pct(waste, 0) : '…', 'Share of voucher orders that would happen anyway (uplift model)') +
      kpi('Voucher orders per 10', mean(rows.map(function (r) { return r.voucher_orders_of_10; })).toFixed(1), 'E2, latest 300 responses');
  }
  function renderAB() {
    var ab = M_('ab'); if (!ab) { waiting('p2-ab-chart'); return; }
    var a = ab.all;
    Ch.columns($('p2-ab-chart'), { items: [
      { label: 'A · Control', sub: 'n = ' + num(a.n1), value: a.p1, lo: a.p1 - 1.96 * a.se1, hi: a.p1 + 1.96 * a.se1, color: col('muted'), tip: 'Control: <b>' + pct(a.p1) + '</b> would order<br>95% CI ' + pct(a.p1 - 1.96 * a.se1) + ' to ' + pct(a.p1 + 1.96 * a.se1) },
      { label: 'B · AED 15 voucher', sub: 'n = ' + num(a.n2), value: a.p2, lo: a.p2 - 1.96 * a.se2, hi: a.p2 + 1.96 * a.se2, color: col('s2'), tip: 'Voucher: <b>' + pct(a.p2) + '</b> would order<br>95% CI ' + pct(a.p2 - 1.96 * a.se2) + ' to ' + pct(a.p2 + 1.96 * a.se2) }
    ], yMax: Math.min(1, Math.max(a.p1, a.p2) * 1.35), yFmt: Ch.pctAxis, fmt: function (v) { return pct(v); }, h: 240, subLabels: true, yLabel: 'Share who would order tonight' });
    $('p2-ab-stats').innerHTML = table(['Test', 'Result'], [
      ['Difference (B − A)', '<b>' + pts(a.diff) + '</b>, 95% CI ' + pts(a.lo) + ' to ' + pts(a.hi)],
      ['Two-proportion z-test', 'z = ' + a.z.toFixed(2) + ', p = ' + pval(a.p)],
      ['Welch t-test on intent (1–5)', 'means ' + a.welch.m1.toFixed(2) + ' vs ' + a.welch.m2.toFixed(2) + ', t = ' + a.welch.t.toFixed(2) + ', p = ' + pval(a.welch.p)],
      ['Sample needed for this effect', (isFinite(ab.ss) ? num(ab.ss) : '–') + ' per group (80% power)'],
      ['Verdict', a.p < 0.05 ? pill('good', 'Voucher effect is real') : pill('warn', 'Not significant yet')]
    ]);
    $('p2-ab-segs').innerHTML = table(['Segment', 'Respondents', 'Control', 'Voucher', 'Uplift', 'p-value', ''],
      ab.segs.map(function (s) { var z = s.z; return [esc(s.name), num(s.n), pct(z.p1), pct(z.p2), pts(z.diff), pval(z.p), z.p < 0.05 ? (z.diff > 0 ? pill('good', 'Persuadable') : pill('crit', 'Backfires')) : pill('neutral', 'No clear effect')]; }), [1, 2, 3, 4, 5]);
  }
  function renderUplift() {
    var up = M_('uplift'); if (!up) { waiting('p2-up-hist'); return; }
    var gs = groups(up), d = S.ui.delta;
    $('delta-out').textContent = '±' + (d * 100).toFixed(0) + ' pts';
    Ch.hist($('p2-up-hist'), { values: Array.prototype.slice.call(up.u.uplift), bins: 30, x: [-0.6, 0.8], xFmt: function (v) { return (v >= 0 ? '+' : '') + Math.round(v * 100); }, xLabel: 'Predicted uplift in chance of ordering (percentage points)',
      colorFn: function (v) { return v >= d ? col('s1') : v <= -d ? col('s8') : col('axis'); }, refs: [{ x: -d }, { x: d }], h: 220 });
    var order = ['Persuadable', 'Sure thing', 'Lost cause', 'Do-not-disturb'], tot = up.rows.length;
    var desc = { 'Persuadable': 'orders only with a voucher: target', 'Sure thing': 'likely to order anyway (40%+): no voucher', 'Lost cause': 'won\'t order either way', 'Do-not-disturb': 'voucher puts them off' };
    Ch.barH($('p2-groups'), { items: order.map(function (k) { return { label: k, value: gs.counts[k] / tot, color: col(GROUP_COL[k]), tip: '<b>' + k + '</b>: ' + num(gs.counts[k]) + ' customers (' + pct(gs.counts[k] / tot) + ')<br>' + desc[k] }; }), fmt: function (v) { return pct(v, 0); }, labelW: 130, max: 1 });
    $('p2-groups-note').innerHTML = order.map(function (k) { return '<span class="sw" style="background:' + col(GROUP_COL[k]) + '"></span><b>' + k + '</b> ' + desc[k]; }).join('<br>');
    var rnd = up.u.curve.map(function (p) { return [p[0], up.u.overall * p[0] * up.u.nTest]; });
    $('p2-curve-legend').innerHTML = legend([{ name: 'Uplift model (target highest predicted uplift first)', color: col('s1'), line: 1 }, { name: 'Random targeting', color: col('muted'), line: 1 }]);
    Ch.line($('p2-curve'), { series: [{ name: 'Uplift model', color: col('s1'), pts: up.u.curve, area: true }, { name: 'Random', color: col('muted'), pts: rnd }], x: [0, 1], xFmt: Ch.pctAxis, xLabel: 'Share of test customers targeted', yLabel: 'Extra orders gained (test set)', h: 240, tipFmt: function (v) { return v.toFixed(1); } });
    $('p2-up-check').innerHTML = 'Simulation check: predicted uplift correlates <b>r = ' + up.corr.toFixed(2) + '</b> with the true effect built into the synthetic data (test set). Trained on ' + num(up.sp.train.length) + ' respondents: one XGBoost model on version B, one on version A; uplift = P(order | voucher) − P(order | no voucher).';
    $('p2-levels').innerHTML = table(['Discount importance (E1)', 'Respondents', 'Observed uplift (B − A)', 'Predicted uplift'], up.byLevel.map(function (l) { return [l.lv + ' / 5', num(l.n), pts(l.obs), pts(l.pred)]; }), [1, 2, 3]);
    renderNet();
    renderOffers();
  }
  function renderNet() {
    var up = M_('uplift'); if (!up) { waiting('p2-net-tiles'); return; }
    var c = S.ui.cost, pr = S.ui.profit, im = S.ui.imp;
    $('cost-out').textContent = 'AED ' + c; $('profit-out').textContent = 'AED ' + pr; $('imp-out').textContent = 'AED ' + im.toFixed(2);
    var nv = [], tot = up.rows.length, everyone = 0, incEvery = 0;
    for (var i = 0; i < tot; i++) { var u = up.u.uplift[i], v = u * pr - up.u.pT[i] * c - im; nv.push({ v: v, u: u }); everyone += v; incEvery += u; }
    var tgt = nv.filter(function (o) { return o.v > 0; }), net = tgt.reduce(function (s, o) { return s + o.v; }, 0), inc = tgt.reduce(function (s, o) { return s + o.u; }, 0);
    $('p2-net-tiles').innerHTML =
      '<div class="tile"><div class="lab">Customers to target</div><div class="val">' + num(tgt.length) + '</div><div class="sub">' + pct(tgt.length / tot, 0) + ' of ' + num(tot) + '</div></div>' +
      '<div class="tile"><div class="lab">Extra orders expected</div><div class="val">' + num(inc) + '</div><div class="sub">vs ' + num(incEvery) + ' if everyone gets one</div></div>' +
      '<div class="tile"><div class="lab">Net value: targeted</div><div class="val">' + aed(net) + '</div><div class="sub">profit from extra orders − voucher − impression cost</div></div>' +
      '<div class="tile"><div class="lab">Net value: voucher for everyone</div><div class="val ' + (everyone < 0 ? 'up-bad' : '') + '">' + aed(everyone) + '</div><div class="sub">Gain from targeting: ' + aed(net - everyone) + '</div></div>';
    nv.sort(function (a, b) { return b.v - a.v; });
    var cum = 0, curve = [[0, 0]], step = Math.max(1, Math.floor(tot / 60)), bestX = 0, best = 0;
    for (i = 0; i < tot; i++) { cum += nv[i].v; if (cum > best) { best = cum; bestX = (i + 1) / tot; } if ((i + 1) % step === 0 || i === tot - 1) curve.push([(i + 1) / tot, cum]); }
    Ch.line($('p2-net-curve'), { series: [{ name: 'Cumulative net value', color: col('s1'), pts: curve, area: true }], x: [0, 1], xFmt: Ch.pctAxis, xLabel: 'Share of customers given a voucher (ranked by net value)', yLabel: 'Cumulative net value, AED', vlines: [{ x: bestX, label: 'Best: ' + pct(bestX, 0) }], h: 240, tipFmt: function (v) { return aed(v); } });
  }
  function renderOffers() {
    var up = M_('uplift'); if (!up) return;
    var gs = groups(up), offers = G.C.offers;
    var per = up.rows.filter(function (_, i) { return gs.g[i] === 'Persuadable'; });
    $('p2-offers').innerHTML = table(['Preferred offer (E4)', 'All respondents', 'Persuadables'], offers.map(function (o) { return [esc(o), pct(share(up.rows, function (r) { return r.preferred_offer === o; }), 0), pct(share(per, function (r) { return r.preferred_offer === o; }), 0)]; }), [1, 2]);
  }

  /* ---------- Problem 3: Grocery ---------- */
  function renderP3Kpis() {
    var rows = S.rows.slice(-ROLL), ru = M_('rules');
    var top = ru ? ML.rules(ru.ap, S.ui.minConf, S.ui.minLift)[0] : null;
    $('p3-kpis').innerHTML =
      kpi('talabat mart interest', pct(share(rows, function (r) { return r.mart_interested; })), 'Answered 4–5 on G4, latest 300', hist('mart'), col('s3')) +
      kpi('Use talabat mart today', pct(share(rows, function (r) { return r.used_mart; })), 'C4, latest 300') +
      kpi('Monthly grocery spend', aed(mean(rows.map(function (r) { return r.monthly_grocery_spend_aed; }))), 'H2 household average') +
      kpi('Grocery spend movable to app', pct(mean(rows.map(function (r) { return r.grocery_shift_pct; })) / 100, 0), 'H3 average') +
      kpi('Strongest rule lift', top ? '×' + top.lift.toFixed(2) : '…', top ? esc(top.ante.map(function (i) { return SVC_NAMES[i]; }).join(' + ')) + ' → ' + esc(SVC_NAMES[top.cons]) : 'Mining…');
  }
  function renderRules() {
    var ru = M_('rules'); if (!ru) { waiting('p3-rules'); return; }
    $('sup-out').textContent = pct(S.ui.minSup, 0); $('conf-out').textContent = pct(S.ui.minConf, 0); $('lift-out').textContent = S.ui.minLift.toFixed(1);
    var rules = ML.rules(ru.ap, S.ui.minConf, S.ui.minLift);
    $('p3-rules-stats').innerHTML = '<span>Respondents <b>' + num(ru.n) + '</b></span><span>Candidate itemsets counted <b>' + ru.ap.candidatesCounted + '</b></span><span>Frequent itemsets <b>' + ru.ap.itemsets.length + '</b></span><span>Rules passing filters <b>' + rules.length + '</b></span><span>Two-service rules <b>' + rules.filter(function (r) { return r.ante.length === 2; }).length + '</b></span>';
    $('p3-rules').innerHTML = rules.length ? table(['If interested in…', '…then also interested in', 'Type', 'Support', 'Confidence', 'Lift'],
      rules.slice(0, 14).map(function (r) { return [esc(r.ante.map(function (i) { return SVC_NAMES[i]; }).join(' + ')), esc(SVC_NAMES[r.cons]), '<span class="chip">' + r.ante.length + ' → 1</span>', pct(r.support), pct(r.conf, 0), '×' + r.lift.toFixed(2)]; }), [3, 4, 5]) : '<p class="placeholder">No rules pass these thresholds. Lower the minimum confidence or lift.</p>';
    var lo = col('div-mid'), hi = col('seq-hi'), neg = col('s8');
    Ch.heat($('p3-heat'), { rows: SVC_NAMES, cols: SVC_NAMES, m: ru.lift, fmt: function (v) { return v.toFixed(1); }, labelW: 170,
      color: function (v) { return v >= 1 ? mix(lo, hi, (v - 1) / 1.6) : mix(lo, neg, (1 - v) / 0.6); }, isDark: function (v) { return v >= 1 ? lum(mix(lo, hi, (v - 1) / 1.6)) < 0.5 : lum(mix(lo, neg, (1 - v) / 0.6)) < 0.5; },
      tip: function (i, j, v) { return esc(SVC_NAMES[i]) + ' → ' + esc(SVC_NAMES[j]) + '<br>Lift <b>×' + v.toFixed(2) + '</b>, confidence ' + pct(ru.conf[i][j], 0); } });
    renderReco();
  }
  function renderReco() {
    var ru = M_('rules'); if (!ru) return;
    var sel = SVC_KEYS.map(function (k, i) { return S.ui.sel[k] ? i : -1; }).filter(function (i) { return i >= 0; });
    $('p3-svc').innerHTML = SVC_KEYS.map(function (k, i) { return '<button data-svc="' + k + '" aria-pressed="' + (S.ui.sel[k] ? 'true' : 'false') + '">' + esc(SVC_NAMES[i]) + '</button>'; }).join('');
    var all = ML.rules(ru.ap, 0, 0), best = {};
    all.forEach(function (r) {
      if (sel.indexOf(r.cons) >= 0) return;
      if (!r.ante.every(function (a) { return sel.indexOf(a) >= 0; })) return;
      if (!best[r.cons] || r.conf > best[r.cons].conf) best[r.cons] = r;
    });
    var recs = Object.keys(best).map(function (k) { return best[k]; }).filter(function (r) { return r.lift > 1.05; }).sort(function (a, b) { return b.conf - a.conf; }).slice(0, 4);
    $('p3-reco').innerHTML = !sel.length ? '<p class="placeholder">Pick one or more services this customer wants.</p>' : recs.length ? recs.map(function (r) {
      return '<div class="reco-item"><div><b>' + esc(SVC_NAMES[r.cons]) + '</b><br><span class="note">because of ' + esc(r.ante.map(function (i) { return SVC_NAMES[i]; }).join(' + ')) + ' · lift ×' + r.lift.toFixed(2) + '</span></div><div class="meter" data-tip="Confidence ' + pct(r.conf, 0) + '"><i style="width:' + Math.round(r.conf * 100) + '%"></i></div><b>' + pct(r.conf, 0) + '</b></div>';
    }).join('') : '<p class="placeholder">No frequent rule covers this combination yet. Try fewer services.</p>';
  }
  function renderMart() {
    var m = M_('mart'); if (!m) { waiting('p3-models'); return; }
    modelTable('p3-models', m, 'Target G4 mart order intent 4–5. talabat mart interest (F1) is left out because it repeats the target.');
    rocChart('p3-roc', 'p3-roc-legend', m);
    Ch.barH($('p3-imp'), { items: m.imp.slice(0, 8).map(function (d) { return { label: d.label, value: d.value, color: col('s3') }; }), fmt: function (v) { return pct(v); }, labelW: 200 });
    $('p3-prospects').innerHTML = table(['Customer', 'Household', 'Grocery spend', 'Orders / month', 'Wants fresh produce', 'P(tries mart)'],
      m.prospects.slice(0, 8).map(function (o) { return [esc(o.r.respondent_id), esc(o.r.household), aed(o.r.monthly_grocery_spend_aed), o.r.orders_per_month, o.r.int_fresh_produce ? 'Yes' : 'No', '<b>' + pct(o.p, 0) + '</b>']; }), [2, 3, 5]) +
      '<p class="note">Current non-users of talabat mart ranked by XGBoost probability: ' + num(m.prospects.filter(function (o) { return o.p >= 0.5; }).length) + ' of ' + num(m.prospects.length) + ' non-users score 50% or more.</p>';
  }
  function renderSpend() {
    var s = M_('spend'); if (!s) { waiting('p3-reg-models'); return; }
    $('p3-reg-models').innerHTML = table(['Model', 'R²', 'MAE', 'RMSE', 'Train time'], s.models.map(function (m) { return [esc(m.name) + (m === s.best ? ' ' + pill('good', 'best R²') : ''), m.met.r2.toFixed(3), aed(m.met.mae), aed(m.met.rmse), Math.round(m.ms) + ' ms']; }), [1, 2, 3, 4], function (i) { return s.models[i] === s.best ? 'best' : ''; }) +
      '<p class="note">Target H4 willing monthly spend on talabat. Test set ' + num(s.sp.test.length) + ' respondents.</p>';
    var pts = s.sp.test.map(function (i) { var r = s.rows[i]; return { x: s.y[i], y: s.xgb.pred[i], c: col('s1'), tip: esc(r.respondent_id) + '<br>Actual ' + esc(aed(s.y[i])) + '<br>Predicted <b>' + esc(aed(s.xgb.pred[i])) + '</b>' }; });
    var mx = quantile(s.sp.test.map(function (i) { return s.y[i]; }), 0.98);
    Ch.scatter($('p3-pva'), { pts: pts, x: [0, mx], y: [0, mx], diag: true, xLabel: 'Actual willing spend (H4), AED', yLabel: 'XGBoost prediction, AED', h: 270 });
    var res = s.sp.test.map(function (i) { return s.y[i] - s.xgb.pred[i]; }), lim = quantile(res.map(Math.abs), 0.97);
    Ch.hist($('p3-resid'), { values: res, bins: 26, x: [-lim, lim], color: col('s1'), xLabel: 'Residual: actual − predicted, AED', refs: [{ x: 0 }], h: 200 });
    Ch.barH($('p3-reg-imp'), { items: s.imp.slice(0, 8).map(function (d) { return { label: d.label, value: d.value, color: col('s1') }; }), fmt: function (v) { return pct(v); }, labelW: 200 });
    $('p3-coefs').innerHTML = table(['Linear model input', 'AED per +1 SD'], s.coefs.slice(0, 8).map(function (c) { return [esc(c.label), '<span class="' + (c.w >= 0 ? 'up-good' : 'up-bad') + '">' + (c.w >= 0 ? '+' : '−') + num(Math.abs(c.w)) + '</span>']; }), [1]);
    renderWhatIf();
  }
  var WI = [
    { k: 'income', label: 'Income band (B4)', type: 'select', opts: G.C.incomes.map(function (v, i) { return [i, v]; }), def: 2 },
    { k: 'hh', label: 'Household (B3)', type: 'select', opts: [[0, 'Living alone'], [1, 'Couple'], [2, 'Family with children'], [3, 'Shared accommodation']], def: 2 },
    { k: 'age', label: 'Age group (B1)', type: 'select', opts: G.C.ages.map(function (v, i) { return [i, v]; }), def: 1 },
    { k: 'orders', label: 'Orders per month (C2)', type: 'range', min: 0, max: 30, step: 1, def: 5 },
    { k: 'aov', label: 'Avg order value, AED (C3)', type: 'range', min: 15, max: 200, step: 5, def: 55 },
    { k: 'pro', label: 'talabat pro member (C5)', type: 'select', opts: [[0, 'No'], [1, 'Yes']], def: 0 },
    { k: 'satisfaction', label: 'Satisfaction (D1)', type: 'range', min: 1, max: 5, step: 1, def: 4 },
    { k: 'services', label: 'Services of interest (F1)', type: 'range', min: 0, max: 10, step: 1, def: 4 },
    { k: 'grocerySpend', label: 'Monthly grocery spend, AED (H2)', type: 'range', min: 200, max: 8000, step: 100, def: 2500 },
    { k: 'martIntent', label: 'talabat mart intent (G4)', type: 'range', min: 1, max: 5, step: 1, def: 3 },
    { k: 'groceryShift', label: 'Grocery share movable, % (H3)', type: 'range', min: 0, max: 100, step: 5, def: 30 },
    { k: 'discountImp', label: 'Discount importance (E1)', type: 'range', min: 1, max: 5, step: 1, def: 3 }
  ];
  function buildWhatIf() {
    if (!S.ui.wi) { S.ui.wi = {}; WI.forEach(function (w) { S.ui.wi[w.k] = w.def; }); }
    $('p3-whatif-form').innerHTML = WI.map(function (w) {
      var id = 'wi-' + w.k;
      if (w.type === 'select') return '<label for="' + id + '"><span>' + esc(w.label) + '</span><select id="' + id + '" data-wi="' + w.k + '">' + w.opts.map(function (o) { return '<option value="' + o[0] + '"' + (+o[0] === +S.ui.wi[w.k] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
      return '<label for="' + id + '"><span>' + esc(w.label) + '<output id="' + id + '-o">' + S.ui.wi[w.k] + '</output></span><input type="range" id="' + id + '" data-wi="' + w.k + '" min="' + w.min + '" max="' + w.max + '" step="' + w.step + '" value="' + S.ui.wi[w.k] + '"></label>';
    }).join('');
  }
  function renderWhatIf() {
    var s = M_('spend'); if (!s || !S.ui.wi) return;
    var w = S.ui.wi, v = {
      income: +w.income, family: +w.hh === 2 ? 1 : 0, alone: +w.hh === 0 ? 1 : 0, age: +w.age, orders: +w.orders, aov: +w.aov, spend: (+w.orders) * (+w.aov),
      pro: +w.pro, satisfaction: +w.satisfaction, services: +w.services, grocerySpend: +w.grocerySpend, martIntent: +w.martIntent, groceryShift: +w.groceryShift, discountImp: +w.discountImp
    };
    var x = s.keys.map(function (k) { return v[k]; });
    var px = s.xgb.m.predictVec(x), pl = s.lin.m.predictVec(x);
    $('p3-whatif-out').innerHTML = '<div class="out"><span>Predicted willingness to spend on talabat per month</span><span class="big">' + aed(px) + '</span><span>XGBoost · linear regression says ' + aed(pl) + '</span><span>Current talabat spend implied by C2 × C3: ' + aed(v.spend) + '</span><span>Headroom: <b>' + aed(px - v.spend) + '</b> a month</span></div>';
  }
  function renderWindows() {
    var rows = S.rows.slice(-1500).filter(function (r) { return r.mart_interested; });
    var map = { 'Every 1-3 days': '0–7 days', 'Weekly': '0–7 days', 'Every 2 weeks': '8–20 days', 'Monthly or less': '21+ days' };
    var bins = ['0–7 days', '8–20 days', '21+ days'], c = { '0–7 days': 0, '8–20 days': 0, '21+ days': 0 };
    rows.forEach(function (r) { c[map[r.grocery_frequency]]++; });
    var tot = rows.length || 1;
    Ch.columns($('p3-windows'), { items: bins.map(function (b, i) { return { label: b, value: c[b] / tot, color: col(['s3', 's1', 's4'][i]), tip: b + ': <b>' + num(c[b]) + '</b> mart-interested customers' }; }), yFmt: Ch.pctAxis, fmt: function (v) { return pct(v, 0); }, h: 200, yLabel: 'Share of mart-interested customers' });
    $('p3-windows-note').innerHTML = '<b>Reminder timing:</b> ' + pct(c['0–7 days'] / tot, 0) + ' of interested customers buy groceries at least weekly, so "your usual basket" reminders go out every 5–6 days for them, every 12–14 days for the 8–20 day group, and monthly for the rest. Based on G5 among the latest ' + num(Math.min(1500, S.rows.length)) + ' responses.';
  }

  /* ---------- Data tab ---------- */
  var SHOW = ['respondent_id', 'response_time', 'country', 'age_group', 'household', 'income_band', 'orders_per_month', 'avg_order_value_aed', 'pro_status', 'satisfaction', 'churn_intent', 'scenario_group', 'scenario_order_intent', 'mart_order_intent', 'willing_monthly_spend_aed', 'top_improvement'];
  function renderData() {
    var rows = S.rows, missing = 0;
    var sample = rows.slice(-500);
    sample.forEach(function (r) { G.COLUMNS.forEach(function (c) { if (r[c] === undefined || r[c] === null || r[c] === '') missing++; }); });
    $('dt-tiles').innerHTML = '<div class="tile"><div class="lab">Respondents</div><div class="val">' + num(rows.length) + '</div><div class="sub">' + num(SEED_N) + ' seed + ' + num(rows.length - SEED_N) + ' streamed</div></div>' +
      '<div class="tile"><div class="lab">Columns</div><div class="val">' + G.COLUMNS.length + '</div><div class="sub">matches the questionnaire variable map</div></div>' +
      '<div class="tile"><div class="lab">Missing values</div><div class="val">' + missing + '</div><div class="sub">in the latest 500 rows</div></div>' +
      '<div class="tile"><div class="lab">Collection period</div><div class="val">' + esc(rows[0].response_time.slice(0, 10)) + '</div><div class="sub">to ' + esc(rows[rows.length - 1].response_time.slice(0, 16)) + ' UTC</div></div>';
    $('dt-table').innerHTML = table(SHOW, rows.slice(-25).reverse().map(function (r) { return SHOW.map(function (c) { return esc(r[c]); }); }), [6, 7, 9, 10, 12, 13, 14]);
  }
  var VMAP = [
    ['A2', 'country'], ['B1–B5', 'age_group, gender, household, income_band, occupation'], ['C1', 'recency_days'], ['C2', 'orders_per_month'], ['C3', 'avg_order_value_aed'],
    ['C2 × C3', 'talabat_monthly_spend_aed (derived)'], ['C4', 'used_food, used_mart, used_pharmacy'], ['C5', 'pro_status'], ['C6', 'uses_keeta, uses_careem, uses_deliveroo, uses_noon, other_apps_count'],
    ['C7', 'talabat_share_pct'], ['D1–D4', 'satisfaction, delivery_speed_rating, issues_3m, nps'], ['E1–E2', 'discount_importance, voucher_orders_of_10'],
    ['E3', 'scenario_group, scenario_order_intent, scenario_converted (derived)'], ['E4', 'preferred_offer'], ['F1', SVC_KEYS.join(', ')],
    ['G1', 'churn_intent, churn_risk (derived)'], ['G2–G3', 'pro_interest, pro_max_fee_aed'], ['G4', 'mart_order_intent, mart_interested (derived)'], ['G5', 'grocery_frequency'],
    ['H1–H3', 'monthly_food_delivery_spend_aed, monthly_grocery_spend_aed, grocery_shift_pct'], ['H4', 'willing_monthly_spend_aed'], ['I1', 'top_improvement']
  ];

  /* ---------- Profit & loss ---------- */
  var P0 = { comm: 19, rider: 8.5, vval: 10, vshare: 50, cac: 60, pay: 2, fees: 8.9, ads: 3.4, refund: 40, churnDiv: 6, s1: 20, s1cost: 0.05, s2: 18, s3: 5, s3m: 3 };
  var P = Object.assign({}, P0);
  var GMV26 = 11.5e9, TARGET = 0.05, PPP_F = 0.55;
  var LOW_PPP = { Jordan: 1, Egypt: 1, Iraq: 1 }, KEETA_M = { UAE: 1, Kuwait: 1, Qatar: 1, Bahrain: 1 }, ROO_M = { UAE: 1, Kuwait: 1 };
  function unit(rows) {
    // cost lines use each respondent's price-level factor (Egypt, Jordan, Iraq at 55% of Gulf costs)
    var n = rows.length || 1, aov = 0, ord = 0, vr = 0, vrf = 0, iss = 0, ex = 0, ch = 0, ff = 0, chf = 0;
    rows.forEach(function (r) {
      var f = LOW_PPP[r.country] ? PPP_F : 1;
      aov += r.avg_order_value_aed; ord += r.orders_per_month; vr += r.voucher_orders_of_10; vrf += r.voucher_orders_of_10 * f;
      iss += r.issues_3m; ex += 3 * Math.max(r.orders_per_month, 0.33); ch += r.churn_risk; chf += r.churn_risk * f; ff += f;
    });
    aov /= n; ord /= n;
    var u = { aov: aov, orders: Math.max(ord, 0.33), vrate: vr / n / 10, issueRate: iss / (ex || 1), churn: ch / n, f: ff / n, n: rows.length };
    u.commission = aov * P.comm / 100; u.fees = aov * P.fees / 100; u.ads = aov * P.ads / 100; u.revenue = u.commission + u.fees + u.ads;
    u.rider = P.rider * u.f; u.voucher = (vrf / n / 10) * P.vval * P.vshare / 100; u.payment = aov * P.pay / 100; u.refunds = u.issueRate * aov * P.refund / 100;
    u.cacL = (chf / n / P.churnDiv) * P.cac / u.orders;
    u.gross = u.revenue - u.rider - u.voucher - u.payment - u.refunds;
    u.contrib = u.gross - u.cacL;
    u.other = (S.plugPct || 0) * aov; u.ebitda = u.contrib - u.other; u.margin = aov ? u.ebitda / aov : 0;
    return u;
  }
  function calibrate() { // other operating costs (% of GMV) chosen so the seed data reproduces the reported 5.0% Adj. EBITDA margin (Q2 2026)
    var keep = P; P = Object.assign({}, P0); S.plugPct = 0;
    var u = unit(S.seed); S.plugPct = (u.contrib - TARGET * u.aov) / u.aov; P = keep;
  }
  function bridge(u) {
    var base = u.margin * GMV26, cacPct = u.cacL / u.aov, vPct = u.voucher / u.aov;
    var d1 = (cacPct * P.s1 / 100 - P.s1cost / u.aov) * GMV26, d2 = vPct * P.s2 / 100 * GMV26;
    var dG = (P.s3 / 100) * 0.25 * 4, d3 = dG * GMV26 * P.s3m / 100, after = base + d1 + d2 + d3, gA = GMV26 * (1 + dG);
    return { base: base, d1: d1, d2: d2, d3: d3, after: after, gmvAfter: gA, mBase: base / GMV26, mAfter: after / gA, dG: dG };
  }
  function usdM(v) { return (v < 0 ? '−' : '') + 'USD ' + Math.abs(v / 1e6).toFixed(0) + ' M'; }
  function aed2(v) { return 'AED ' + v.toFixed(2); }
  var REP_Q = [['Q1 2025', 0.067], ['Q2 2025', 0.068], ['Q3 2025', 0.064], ['Q4 2025', 0.063], ['Q1 2026', 0.048], ['Q2 2026', 0.050]];
  var COMP = [
    { name: 'talabat', scope: 'Group, 8 MENA markets', period: 'Q2 2026', rev: 'USD 1.14 bn', profit: 'Adj. EBITDA USD 147 m', m: 147 / 1141, gmv: '5.0% of GMV' },
    { name: 'Deliveroo', scope: 'Whole group incl. UAE, Kuwait, Qatar. Last report before DoorDash bought it (Oct 2025)', period: 'FY 2024', rev: 'GBP 2.07 bn', profit: 'Adj. EBITDA GBP 130 m', m: 129.6 / 2071.9, gmv: '1.7% of GTV' },
    { name: 'Meituan New Initiatives (incl. Keeta)', scope: 'Keeta worldwide plus grocery retail. Keeta\'s Middle East P&L is not disclosed', period: 'Q1 2026', rev: 'RMB 27 bn', profit: 'Operating loss RMB 2.1 bn', m: -0.078, gmv: 'not disclosed' },
    { name: 'Careem Technologies', scope: 'Super app without ride-hailing: food, grocery, payments, courier', period: 'H1 2026', rev: 'USD 241 m', profit: 'Operating loss USD 122 m', m: -122 / 241, gmv: 'not disclosed' }
  ];
  var PSL = [
    ['comm', 'Restaurant commission', 8, 30, 0.5, '%', 'Assumed share of each food order'],
    ['rider', 'Rider cost per order', 3, 15, 0.5, 'AED', 'Assumed; scaled to 55% in Egypt, Jordan, Iraq'],
    ['vval', 'Average voucher value', 0, 30, 1, 'AED', 'Assumed; usage comes from survey E2'],
    ['vshare', 'Share of vouchers talabat pays for', 0, 100, 5, '%', 'Rest is funded by restaurants'],
    ['cac', 'Cost to acquire a customer', 10, 200, 5, 'AED', 'Used to replace churned customers (G1)']
  ];
  var SSL = [
    ['s1', 'Solution 1: churn cut among at-risk customers', 0, 50, 1, '%', 'Retention programme from Problem 1'],
    ['s1cost', 'Solution 1: programme cost per order', 0, 1, 0.05, 'AED', 'pro trials, credits, priority support'],
    ['s2', 'Solution 2: cut in talabat-funded voucher spend', 0, 60, 1, '%', 'Smart incentive engine; MOM target 15–20%'],
    ['s3', 'Solution 3: food-only customers converted to grocery', 0, 20, 0.5, '%', 'Food + grocery customers spend about 5×'],
    ['s3m', 'Solution 3: Adj. EBITDA margin on extra grocery GMV', 0, 10, 0.5, '%', 'Assumed; talabat mart sells its own stock at lower margins']
  ];
  function pfmt(k, v) { var d = [].concat(PSL, SSL).filter(function (x) { return x[0] === k; })[0]; return d[5] === 'AED' ? 'AED ' + (+v).toFixed(v % 1 ? 2 : 0) : (+v) + '%'; }
  function psliders(list) {
    return '<div class="assume">' + list.map(function (d) {
      return '<label for="pl-' + d[0] + '"><span>' + esc(d[1]) + '<output id="pl-' + d[0] + '-o">' + pfmt(d[0], P[d[0]]) + '</output></span><input type="range" id="pl-' + d[0] + '" data-pnl="' + d[0] + '" min="' + d[2] + '" max="' + d[3] + '" step="' + d[4] + '" value="' + P[d[0]] + '"><small>' + esc(d[6]) + '</small></label>';
    }).join('') + '</div>';
  }
  function markets() {
    var rows = S.rows.slice(-2000);
    return G.C.countries.map(function (c) { var g = rows.filter(function (r) { return r.country === c; }); return { c: c, n: g.length, u: unit(g), keeta: !!KEETA_M[c], roo: !!ROO_M[c] }; });
  }
  function renderPnlReported() {
    $('pl-rep').innerHTML = table(['USD', 'FY 2025', 'Q2 2026', 'H1 2026', 'FY 2026 guidance'], [
      ['GMV', '9.5 bn', '2.92 bn', '5.6 bn', '11.4–11.6 bn'],
      ['Revenue', '3.92 bn', '1.14 bn', '2.19 bn', '+16–18%'],
      ['Revenue as % of GMV', '41%', '39%', '39%', '–'],
      ['Adj. EBITDA', '615 m', '147 m', '277 m', '535–565 m'],
      ['Adj. EBITDA, % of GMV', '<b>6.5%</b>', '<b>5.0%</b>', '4.9%', 'about 4.7–4.9%'],
      ['Net income', '464 m', '100 m', '186 m', '325–355 m'],
      ['Net income, % of GMV', '4.9%', '3.4%', '3.3%', '–']
    ], [1, 2, 3, 4]) + '<p class="note">Guidance margin is guided EBITDA divided by guided GMV. Q2 2026 gross profit fell to 9.8% of GMV from 11.2% a year earlier. Q3 2026 results were not yet published at the time of writing.</p>';
    Ch.line($('pl-trend'), { series: [{ name: 'Adj. EBITDA margin', color: col('s1'), pts: REP_Q.map(function (q, i) { return [i, q[1]]; }), tip: function (p) { return REP_Q[p[0]][0] + '<br>Adj. EBITDA <b>' + pct(p[1]) + '</b> of GMV'; } }],
      x: [0, 5], y: [0.03, 0.075], xTicks: [0, 1, 2, 3, 4, 5], xFmt: function (v) { return REP_Q[Math.round(v)] ? REP_Q[Math.round(v)][0] : ''; }, yFmt: function (v) { return (v * 100).toFixed(1) + '%'; }, yLabel: 'Adj. EBITDA, % of GMV (reported)', h: 230 });
    Ch.barDiv($('pl-comp-chart'), { items: COMP.map(function (c) { return { label: c.name, value: c.m, tip: '<b>' + esc(c.name) + '</b> · ' + esc(c.period) + '<br>' + esc(c.profit) + ' on revenue ' + esc(c.rev) + '<br>Margin on revenue <b>' + pct(c.m) + '</b>' }; }),
      pos: col('s1'), neg: col('s8'), fmt: function (v) { return pct(v); }, axisFmt: function (v) { return Math.round(v * 100) + '%'; }, labelW: 210, rowH: 34 });
    $('pl-comp').innerHTML = table(['Player', 'Period', 'Revenue', 'Profit measure', 'On revenue', 'On GMV'], COMP.map(function (c) { return ['<b>' + esc(c.name) + '</b><br><span class="note">' + esc(c.scope) + '</span>', esc(c.period), esc(c.rev), esc(c.profit), pct(c.m), esc(c.gmv)]; }), [2, 4]);
    $('pl-comp-note').innerHTML = '<b>Reading:</b> talabat is the only one of the four with a double-digit profit margin on revenue. Keeta (Meituan) is still losing money and expects its first profitable month in Saudi Arabia only by the end of 2026. Careem\'s super app lost about USD 20 m a month in H1 2026. DoorDash shut Deliveroo in Qatar in February 2026. Rivals are buying share with subsidies, which is why talabat\'s margin fell from 6.8% to 5.0% of GMV: Problems 1 and 2 in money terms.';
  }
  function renderPnlModel() {
    var live = unit(S.rows.slice(-500)), seed = unit(S.seed), b = bridge(live);
    PSL.concat(SSL).forEach(function (d) { var o = $('pl-' + d[0] + '-o'); if (o) o.textContent = pfmt(d[0], P[d[0]]); });
    $('pl-kpis').innerHTML =
      kpi('Adj. EBITDA margin, live model', pct(live.margin), delta(live.margin, seed.margin, true, function (d) { return (d >= 0 ? '+' : '−') + Math.abs(d * 100).toFixed(2) + ' pts'; }) + ' vs seed (5.0%, = reported Q2 2026)', hist('margin'), col('s1')) +
      kpi('Adj. EBITDA per food order', aed2(live.ebitda), 'on an average order of ' + aed(live.aov)) +
      kpi('Annual Adj. EBITDA, modelled', usdM(b.base), 'at USD 11.5 bn GMV; talabat guides USD 535–565 m') +
      kpi('With our three solutions', usdM(b.after), '<span class="up-good">+' + usdM(b.after - b.base).replace('USD ', 'USD ') + '</span> · margin ' + pct(b.mAfter));
    var colors = { up: col('s1'), down: col('s8'), total: col('ink2'), neg: col('crit') };
    Ch.waterfall($('pl-wf'), { steps: [
      { label: 'Commission (' + P.comm + '%)', value: live.commission, kind: 'up' }, { label: 'Delivery and service fees', value: live.fees, kind: 'up', tip: '8.9% of GMV (reported FY 2025)' }, { label: 'Advertising', value: live.ads, kind: 'up', tip: '3.4% of GMV (reported Q2 2026)' },
      { label: 'Revenue per order', kind: 'total' }, { label: 'Rider cost', value: live.rider, kind: 'down' }, { label: 'talabat-funded vouchers', value: live.voucher, kind: 'down', tip: pct(live.vrate, 0) + ' of orders use a voucher (E2)' },
      { label: 'Payment fees', value: live.payment, kind: 'down' }, { label: 'Refunds, late or wrong orders', value: live.refunds, kind: 'down', tip: pct(live.issueRate) + ' of orders have an issue (D3)' },
      { label: 'Replacing churned customers', value: live.cacL, kind: 'down', tip: pct(live.churn) + ' at churn risk (G1)' }, { label: 'Tech, G&A and other', value: live.other, kind: 'down', tip: 'Calibrated: ' + pct(S.plugPct) + ' of GMV' },
      { label: 'Adj. EBITDA per order', kind: 'total' }
    ], colors: colors, fmt: aed2, axisFmt: function (v) { return v.toFixed(0); }, labelW: 200 });
    var lines = [['Average order value', 'aov'], ['Revenue per order', 'revenue'], ['Gross profit per order', 'gross'], ['Rider cost', 'rider'], ['talabat-funded vouchers', 'voucher'], ['Refunds', 'refunds'], ['Replacing churned customers', 'cacL'], ['Tech, G&A and other', 'other'], ['Adj. EBITDA per order', 'ebitda']];
    $('pl-cmp').innerHTML = table(['Line (AED per order)', 'Seed data', 'Latest 500', 'Change'], lines.map(function (l) {
      var a = seed[l[1]], c = live[l[1]], d = c - a, costLine = ['rider', 'voucher', 'refunds', 'cacL', 'other'].indexOf(l[1]) >= 0;
      var cls = Math.abs(d) < 0.005 ? '' : ((d > 0) !== costLine ? 'up-good' : 'up-bad');
      return [l[1] === 'ebitda' ? '<b>' + l[0] + '</b>' : l[0], a.toFixed(2), c.toFixed(2), '<span class="' + cls + '">' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2) + '</span>'];
    }).concat([['Orders with a voucher (E2)', pct(seed.vrate, 0), pct(live.vrate, 0), pts(live.vrate - seed.vrate)], ['Churn risk (G1)', pct(seed.churn, 0), pct(live.churn, 0), pts(live.churn - seed.churn)], ['Adj. EBITDA, % of GMV', pct(seed.margin), '<b>' + pct(live.margin) + '</b>', pts(live.margin - seed.margin)]]), [1, 2, 3]) +
      '<p class="note">Check: the model\'s gross profit is ' + pct(seed.gross / seed.aov) + ' of GMV on the seed data; talabat reported 9.8% for Q2 2026. Turn on a scenario shock to watch vouchers, refunds and churn costs eat the margin.</p>';
    var mk = markets(), wsum = function (arr) { var g = 0, e = 0; arr.forEach(function (m) { var w = m.n * m.u.orders * m.u.aov; g += w; e += w * m.u.margin; }); return g ? e / g : 0; };
    Ch.barDiv($('pl-mkt-chart'), { items: mk.map(function (m) { return { label: m.c + (m.keeta ? ' · Keeta' : ''), value: m.u.margin, tip: '<b>' + esc(m.c) + '</b> (' + m.n + ' respondents)<br>Adj. EBITDA ' + esc(aed2(m.u.ebitda)) + ' per order, <b>' + pct(m.u.margin) + '</b> of GMV<br>Vouchers on ' + pct(m.u.vrate, 0) + ' of orders · churn risk ' + pct(m.u.churn, 0) }; }),
      pos: col('s1'), neg: col('s8'), fmt: function (v) { return pct(v); }, axisFmt: function (v) { return Math.round(v * 100) + '%'; }, labelW: 130 });
    $('pl-mkt').innerHTML = table(['Market', 'Rivals', 'Resp.', 'Order AED', 'Orders / mo', 'Voucher use', 'Churn risk', 'EBITDA / order', '% of GMV', 'Per 1,000 customers / mo'],
      mk.map(function (m) { return ['<b>' + esc(m.c) + '</b>', (m.keeta ? '<span class="tag">Keeta</span> ' : '') + (m.roo ? '<span class="tag">Deliveroo</span>' : ''), m.n, num(m.u.aov), m.u.orders.toFixed(1), pct(m.u.vrate, 0), pct(m.u.churn, 0), aed2(m.u.ebitda), pct(m.u.margin), aed(m.u.ebitda * m.u.orders * 1000)]; }), [2, 3, 4, 5, 6, 7, 8, 9]);
    var kM = mk.filter(function (m) { return m.keeta; }), oM = mk.filter(function (m) { return !m.keeta; });
    var vr = function (arr) { var n = 0, s = 0; arr.forEach(function (m) { n += m.n; s += m.n * m.u.vrate; }); return n ? s / n : 0; }, cr = function (arr) { var n = 0, s = 0; arr.forEach(function (m) { n += m.n; s += m.n * m.u.churn; }); return n ? s / n : 0; };
    $('pl-mkt-note').innerHTML = '<b>Keeta markets vs the rest:</b> in the four markets where Keeta operates (UAE, Kuwait, Qatar, Bahrain) the modelled Adj. EBITDA margin is <b>' + pct(wsum(kM)) + '</b> of GMV against <b>' + pct(wsum(oM)) + '</b> elsewhere, with churn risk at ' + pct(cr(kM), 0) + ' vs ' + pct(cr(oM), 0) + ' and vouchers on ' + pct(vr(kM), 0) + ' vs ' + pct(vr(oM), 0) + ' of orders. Larger orders in the Gulf carry fixed rider and tech costs better; competition shows up in churn and voucher costs.';
    var steps = [{ label: 'Adj. EBITDA today (modelled)', kind: 'total', value: b.base }];
    [['Solution 1: retention programme', b.d1], ['Solution 2: smart incentive engine', b.d2], ['Solution 3: grocery cross-sell', b.d3]].forEach(function (x) { steps.push({ label: x[0], value: Math.abs(x[1]), kind: x[1] >= 0 ? 'up' : 'down' }); });
    steps.push({ label: 'Adj. EBITDA with solutions', kind: 'total' });
    Ch.waterfall($('pl-bridge'), { steps: steps, colors: { up: col('good'), down: col('s8'), total: col('s1'), neg: col('crit') }, fmt: usdM, axisFmt: function (v) { return Math.round(v / 1e6); }, labelW: 230, rowH: 34 });
    $('pl-sol-tiles').innerHTML =
      '<div class="tile"><div class="lab">Extra Adj. EBITDA a year</div><div class="val up-good">+' + usdM(b.after - b.base) + '</div><div class="sub">' + pct((b.after - b.base) / Math.max(1, b.base), 0) + ' more than today</div></div>' +
      '<div class="tile"><div class="lab">Margin, % of GMV</div><div class="val">' + pct(b.mBase) + ' → ' + pct(b.mAfter) + '</div><div class="sub">back towards the 6.5% of FY 2025</div></div>' +
      '<div class="tile"><div class="lab">GMV with grocery cross-sell</div><div class="val">USD ' + (b.gmvAfter / 1e9).toFixed(2) + ' bn</div><div class="sub">+' + pct(b.dG, 1) + ' on the USD 11.5 bn base</div></div>' +
      '<div class="tile"><div class="lab">Biggest lever</div><div class="val">' + (b.d2 >= b.d1 && b.d2 >= b.d3 ? 'Vouchers' : b.d1 >= b.d3 ? 'Retention' : 'Grocery') + '</div><div class="sub">' + usdM(Math.max(b.d1, b.d2, b.d3)) + ' a year</div></div>';
    var hints = [];
    var up = M_('uplift');
    if (up) { var c = 0; for (var i = 0; i < up.rows.length; i++) { if (up.u.uplift[i] * S.ui.profit - up.u.pT[i] * S.ui.cost - S.ui.imp <= 0) c++; } hints.push('Solution 2 check: at the voucher cost and profit set on the Problem 2 tab, the net-value model would withhold vouchers from ' + pct(c / Math.max(1, up.rows.length), 0) + ' of customers, so cutting talabat-funded voucher spend by 18% is conservative.'); }
    var mt = M_('mart');
    if (mt) hints.push('Solution 3 check: ' + pct(mt.prospects.filter(function (o) { return o.p >= 0.5; }).length / Math.max(1, mt.prospects.length), 0) + ' of current non-users score 50%+ on the talabat mart classifier.');
    hints.push('Solution 1 counts only saved acquisition cost; it ignores extra orders from customers who stay, so it understates the gain.');
    $('pl-hints').innerHTML = hints.join(' ');
  }

  /* ---------- tab templates ---------- */
  function card(step, title, desc, body, ctrls, id) {
    return '<section class="card"' + (id ? ' id="' + id + '"' : '') + '><div class="card-h"><div><h3>' + (step ? '<span class="step">' + step + '</span>' : '') + esc(title) + '</h3>' + (desc ? '<p>' + desc + '</p>' : '') + '</div>' + (ctrls ? '<div class="ctrls">' + ctrls + '</div>' : '') + '</div>' + body + '</section>';
  }
  function banner(n, title, q, algos) {
    return '<div class="banner"><div><span class="pnum">Problem ' + n + '</span><h2>' + esc(title) + '</h2><p>' + esc(q) + '</p></div><div class="chips">' + algos.map(function (a) { return '<span class="chip">' + esc(a) + '</span>'; }).join('') + '</div></div>';
  }
  function range(id, min, max, step, val, label, outId) { return '<label for="' + id + '">' + label + ' <input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output id="' + outId + '"></output></label>'; }
  function buildTabs() {
    $('tab-overview').innerHTML = '<div class="kpis" id="ov-kpis"></div><h2 class="sec">The three problems <span>Select a problem to open its live analysis</span></h2><div class="cards3" id="ov-problems"></div>' +
      '<div class="grid2">' + card('', 'Live signals from the latest 300 responses', 'Rolling share of respondents. Turn on a scenario shock in the toolbar and watch the lines move.', '<div class="legend" id="ov-trend-legend"></div><div id="ov-trend" class="chartbox"></div>') +
      card('', 'Live response feed', 'Newest survey responses as they arrive', '<div id="ov-feed" class="tablewrap"></div>') + '</div>' +
      card('', 'Algorithms running', 'Every model retrains automatically on the latest responses (up to 4,000). Metrics are measured on a held-out 25% test set.', '<div id="ov-board" class="tablewrap"></div>');

    $('tab-retention').innerHTML = banner(1, 'Low-value customers are leaving for discount-led rivals', 'Who is at risk, what are they worth, and which customers are worth saving?', ['K-means', 'Logistic regression', 'Decision tree', 'Gradient boosting', 'XGBoost', 'Regression', 'A/B test']) +
      '<div class="kpis" id="p1-kpis"></div>' +
      card('A', 'Clustering · K-means on recency, frequency and monetary value', 'Groups customers into most, medium and least probable to keep ordering and spend more (Blog 2). Segments are ranked by average monthly spend.',
        '<div class="grid2"><div><div class="legend" id="p1-seg-legend"></div><div id="p1-seg-scatter"></div></div><div><div id="p1-elbow"></div><p class="note" id="p1-sil"></p></div></div><div id="p1-seg-table" class="tablewrap"></div><p class="insight" id="p1-seg-insight"></p>',
        '<label for="k">Clusters (k) <select id="k">' + [2, 3, 4, 5].map(function (k) { return '<option' + (k === 3 ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>') +
      card('B', 'Classification · who will reduce or stop using talabat', 'Target: churn risk (G1 answered 4–5). Four models compete on the same 75/25 split (Blog 4).',
        '<div id="p1-models" class="tablewrap"></div><div class="grid2"><div><div class="legend" id="p1-roc-legend"></div><div id="p1-roc"></div></div><div><div class="ctrls" style="margin-bottom:10px">' + range('thr', 0.1, 0.9, 0.05, 0.5, 'XGBoost decision threshold', 'thr-out') + '</div><div id="p1-cm"></div></div></div><h4>What drives churn risk (XGBoost gain share)</h4><div id="p1-imp"></div>') +
      card('C', 'Regression × classification · value–risk action grid', 'Each customer\'s predicted willingness to spend (XGBoost regression) against predicted churn risk (XGBoost classifier). Moves with the threshold above.',
        '<div id="p1-grid-cells" class="vr-grid"></div><h4>Top 10 high-value customers at risk</h4><div id="p1-top" class="tablewrap"></div>') +
      card('D', 'Test before scaling · retention experiment planner', 'How many at-risk customers must be in each group to prove a retention action works (Blog 9)?',
        '<div class="planner"><div class="ctrls" style="flex-direction:column;align-items:flex-start">' + range('red', 5, 50, 5, 25, 'Expected relative drop in churn', 'red-out') + '<button class="btn primary" id="btnSim">Simulate the experiment</button><p class="note">The simulation draws customers at the baseline and expected churn rates, then runs a two-proportion z-test.</p></div><div id="p1-plan-out" class="grid3"></div></div>');

    $('tab-discounts').innerHTML = banner(2, 'Discounts and vouchers are squeezing margins', 'Does a voucher change this customer\'s decision, or would they order anyway?', ['A/B test', 'z-test', 't-test', 'Two-model uplift', 'XGBoost', 'Market response']) +
      '<div class="kpis" id="p2-kpis"></div>' +
      card('A', 'A/B test · randomised voucher scenario (E3)', 'Half the respondents saw an AED 15 voucher, half did not. Random assignment makes the gap the voucher\'s true effect (Blogs 7 and 9).',
        '<div class="grid2"><div id="p2-ab-chart"></div><div id="p2-ab-stats" class="tablewrap"></div></div><h4>Same test inside each segment</h4><div id="p2-ab-segs" class="tablewrap"></div>') +
      card('B', 'Uplift model · two-model XGBoost', 'Predicts, for each customer, how much the voucher changes their chance of ordering, then sorts them into four groups (Blog 8).',
        '<div class="grid2"><div><div id="p2-up-hist"></div></div><div><div id="p2-groups"></div><p class="note" id="p2-groups-note" style="margin-top:8px"></p></div></div><div class="grid2"><div><div class="legend" id="p2-curve-legend"></div><div id="p2-curve"></div></div><div><h4>Observed vs predicted uplift by price sensitivity</h4><div id="p2-levels" class="tablewrap"></div><p class="note" id="p2-up-check" style="margin-top:8px"></p></div></div>',
        range('delta', 0.02, 0.25, 0.01, 0.1, 'Group cut-off', 'delta-out')) +
      card('C', 'Net-value targeting · who should get a voucher', 'Net value = uplift × profit per order − P(order with voucher) × voucher cost − cost of showing the offer. Give a voucher only when it is positive.',
        '<div class="ctrls">' + range('cost', 5, 30, 1, 15, 'Voucher cost', 'cost-out') + range('profit', 5, 60, 1, 22, 'Profit per extra order', 'profit-out') + range('imp', 0, 1, 0.05, 0.1, 'Impression cost', 'imp-out') + '</div><div class="tiles" id="p2-net-tiles"></div><div id="p2-net-curve"></div>') +
      card('D', 'Offer design · what persuadables want', 'Preferred offer (E4) for persuadables compared with everyone.', '<div id="p2-offers" class="tablewrap"></div>');

    $('tab-grocery').innerHTML = banner(3, 'Food-only customers rarely buy groceries', 'Which services go together, who will try talabat mart, and how much will they spend?', ['Apriori', 'Logistic regression', 'Decision tree', 'Gradient boosting', 'XGBoost', 'Linear regression']) +
      '<div class="kpis" id="p3-kpis"></div>' +
      card('A', 'Association rules · Apriori on 10 services (F1)', 'If a customer wants these services, which other service will they also want? Support = how common, confidence = how often the rule holds, lift = how much better than chance.',
        '<div class="metrics" id="p3-rules-stats" style="margin-top:0"></div><div class="grid2"><div id="p3-rules" class="tablewrap"></div><div><h4>Pairwise lift between services (row → column)</h4><div id="p3-heat"></div></div></div><h4>Cross-sell recommender</h4><div class="grid2"><div><p class="note" style="margin-bottom:8px">Services this customer wants</p><div class="svc" id="p3-svc"></div></div><div class="reco" id="p3-reco"></div></div>',
        range('sup', 0.02, 0.2, 0.01, 0.05, 'Min support', 'sup-out') + range('conf', 0.1, 0.9, 0.05, 0.3, 'Min confidence', 'conf-out') + range('lift', 1, 3, 0.1, 1.2, 'Min lift', 'lift-out')) +
      card('B', 'Classification · who will try talabat mart', 'Target: talabat mart order intent (G4 answered 4–5).',
        '<div id="p3-models" class="tablewrap"></div><div class="grid2"><div><div class="legend" id="p3-roc-legend"></div><div id="p3-roc"></div></div><div><h4>What predicts grocery interest (XGBoost gain share)</h4><div id="p3-imp"></div></div></div><h4>Best prospects among current non-users</h4><div id="p3-prospects" class="tablewrap"></div>') +
      card('C', 'Regression · how much will they spend', 'Target: willingness to spend on talabat per month (H4). Linear regression against boosted trees.',
        '<div id="p3-reg-models" class="tablewrap"></div><div class="grid2"><div><div id="p3-pva"></div></div><div><div id="p3-resid"></div></div></div><div class="grid2"><div><h4>What drives willingness to spend (XGBoost gain share)</h4><div id="p3-reg-imp"></div></div><div><h4>Linear regression coefficients</h4><div id="p3-coefs" class="tablewrap"></div></div></div><h4>What-if calculator</h4><div class="grid2"><div class="whatif" id="p3-whatif-form"></div><div id="p3-whatif-out"></div></div>') +
      card('D', 'Next purchase windows · when to remind', 'Grocery shopping frequency (G5) of mart-interested customers, grouped into the next-purchase windows from Blog 5.', '<div class="grid2"><div id="p3-windows"></div><p class="insight" id="p3-windows-note"></p></div>');

    $('tab-pnl').innerHTML = '<div class="banner"><div><span class="pnum">Profit and loss</span><h2>What the problems cost, and what the solutions are worth</h2><p>talabat\'s reported P&amp;L, competitor benchmarks, and a live P&amp;L model driven by the survey.</p></div><div class="chips"><span class="tag rep">Reported</span><span class="note">published figures</span><span class="tag mod">Modelled</span><span class="note">our model, assumptions editable</span></div></div>' +
      '<div class="kpis" id="pl-kpis"></div>' +
      card('1', 'talabat reported P&L', '<span class="tag rep">Reported</span> Published results in US dollars. Adj. EBITDA fell from 6.8% to 5.0% of GMV in a year as talabat spent more on incentives, grocery and loyalty.', '<div class="grid2"><div id="pl-rep" class="tablewrap"></div><div id="pl-trend"></div></div>') +
      card('2', 'Competitor benchmark', '<span class="tag rep">Reported</span> Latest published profitability of delivery players in talabat\'s markets. Scopes and measures differ, so compare direction, not decimals.', '<div class="grid2"><div id="pl-comp-chart"></div><div id="pl-comp" class="tablewrap"></div></div><p class="insight" id="pl-comp-note"></p>') +
      card('3', 'Live P&L of one talabat food order', '<span class="tag mod">Modelled</span> Built from the latest 500 survey responses plus talabat\'s reported revenue ratios, then calibrated so the seed data gives the reported 5.0% Adj. EBITDA margin.',
        psliders(PSL) + '<div class="grid2"><div><h4>Latest 500 responses, AED per order</h4><div id="pl-wf"></div></div><div><h4>Seed data vs live</h4><div id="pl-cmp" class="tablewrap"></div></div></div>') +
      card('4', 'Market P&L across talabat\'s 8 markets', '<span class="tag mod">Modelled</span> The same model run on each country\'s respondents (latest 2,000). Costs in Egypt, Jordan and Iraq are scaled to local price levels.', '<div class="grid2"><div id="pl-mkt-chart"></div><p class="insight" id="pl-mkt-note"></p></div><div id="pl-mkt" class="tablewrap"></div>') +
      card('5', 'Profit impact of our three solutions', '<span class="tag mod">Modelled</span> Annual Adj. EBITDA at talabat\'s 2026 GMV guidance midpoint of USD 11.5 bn, starting from the live margin above.',
        psliders(SSL) + '<div class="grid2"><div id="pl-bridge"></div><div class="tiles" id="pl-sol-tiles"></div></div><p class="note" id="pl-hints"></p>') +
      card('', 'Assumptions and sources', 'Reported figures come from company releases; modelled lines combine those ratios with the survey and the assumptions below.',
        '<ul class="src"><li><b>Reported ratios used in the model:</b> delivery and service fees 8.9% of GMV (FY 2025), advertising 3.4% of GMV (Q2 2026), multi-vertical customers 75% of GMV (Q2 2026), food + grocery customers spend about 5× food-only customers.</li>' +
        '<li><b>Assumptions:</b> commission, rider cost, voucher value and funding share, acquisition cost, payment fees 2% of GMV, refunds at 40% of an order with an issue, one sixth of stated churn intent becoming monthly churn, low-price markets at 55% of Gulf costs, 3% margin on extra grocery GMV.</li>' +
        '<li><b>Calibration:</b> tech, G&amp;A and other costs are set to ' + pct(S.plugPct) + ' of GMV so the seed data matches the reported 5.0%.</li></ul>' +
        '<h4>Sources</h4><ul class="src">' + [
          ['talabat Q4 and FY 2025 results (Zawya)', 'https://www.zawya.com/en/press-release/companies-news/talabat-reports-resilient-results-for-q4-2025-announces-disciplined-investment-cycle-to-drive-long-term-growth-c4pr7zg2'],
          ['talabat Q2 and H1 2026 results release (DFM)', 'https://feeds.dfm.ae/documents/2026/Aug/12/b0649495-e71c-4144-8467-b530d14c556e/Press%20Release%20En%2020260812%20Talabat%20Q2%2026%20Results.Pd.pdf'],
          ['talabat Q2 2026 results and guidance (Gulf News)', 'https://gulfnews.com/business/markets/talabat-lifts-2026-outlook-after-orders-grow-but-q2-profit-falls-18-1.500638132'],
          ['talabat Q2 2026 earnings summary: H1 figures, gross margin, GMV guidance (Quartr)', 'https://quartr.com/events/talabat-holding-plc-talabat-q2-2026_Fg77FQWK'],
          ['talabat Q1 2026 margin (Kuwait Times)', 'https://kuwaittimes.com/article/43542/business/talabat-delivers-strong-q1-2026-performance/'],
          ['talabat Q3 2025 margin (MENews247)', 'https://menews247.com/talabat-reports-strong-results-for-q3-2025-and-reiterates-guidance-for-the-full-year/'],
          ['talabat Q2 2025 margin (Zawya)', 'https://www.zawya.com/press-release/companies-news/talabat-reports-strong-results-for-q2-2025-and-revises-guidance-upwards-for-the-full-year-su5rhnpg'],
          ['talabat Q1 2025 margin (Quartr)', 'https://quartr.com/events/talabat-holding-plc-talabat-q1-2025_Fg77oG4n'],
          ['FAB Securities on talabat 4Q25: fees as % of GMV', 'https://fabsresearch.bankfab.com/ResearchPortal/Download/Index/1370'],
          ['FAB Securities on talabat 2Q26: food + grocery spend', 'https://fabsresearch.bankfab.com/ResearchPortal/Download/Index/1582'],
          ['Deliveroo FY 2024 results (FCA)', 'https://data.fca.org.uk/artefacts/NSM/RNS/5572277.html'],
          ['DoorDash exits Qatar (The Peninsula)', 'https://thepeninsulaqatar.com/article/26/02/2026/doordash-to-wind-down-deliveroo-and-wolt-operations-in-four-countries'],
          ['Careem Technologies H1 2026 (tbreak)', 'https://tbreak.com/careem-first-public-financials-h1-2026/'],
          ['Meituan Q1 2026 New Initiatives (Tiger Brokers)', 'https://www.itiger.com/news/1106563679'],
          ['Keeta markets (SCMP)', 'https://www.scmp.com/tech/big-tech/article/3355556/meituan-reports-third-consecutive-quarterly-loss-rivalry-food-delivery-hits-margins'],
          ['Keeta Saudi unit economics target (KrASIA)', 'https://kr-asia.com/meituans-overseas-push-steadies-investors-despite-second-consecutive-loss']
        ].map(function (x) { return '<li><a href="' + x[1] + '" target="_blank" rel="noopener">' + esc(x[0]) + '</a></li>'; }).join('') + '</ul>');

    $('tab-data').innerHTML = card('', 'Survey dataset', 'Synthetic responses generated from the questionnaire logic. The seed is reproducible; streamed rows follow the active scenario shocks.',
      '<div class="tiles" id="dt-tiles"></div><div class="ctrls"><button class="btn primary" id="btnCopy">Copy all data as CSV</button><span class="note" id="copy-note">Copy, then paste into a .csv file or Excel. On the Streamlit version, the Python ML lab page has a Download button.</span></div>') +
      card('', 'Latest 25 responses', 'Selected columns; the CSV has all ' + G.COLUMNS.length + '.', '<div id="dt-table" class="tablewrap"></div>') +
      card('', 'Variable map', 'Questionnaire item to dataset column.', '<div class="tablewrap">' + table(['Question', 'Column(s)'], VMAP.map(function (v) { return [esc(v[0]), '<code>' + esc(v[1]) + '</code>']; })) + '</div>');
    buildWhatIf();
  }

  /* ---------- tab switching and render dispatch ---------- */
  var TABS = ['overview', 'retention', 'discounts', 'grocery', 'pnl', 'data'];
  function renderTab() {
    CS = null;
    if (S.tab === 'overview') renderOverview();
    if (S.tab === 'retention') { renderP1Kpis(); renderSegments(); renderChurn(); renderGrid(); renderPlanner(); }
    if (S.tab === 'discounts') { renderP2Kpis(); renderAB(); renderUplift(); }
    if (S.tab === 'grocery') { renderP3Kpis(); renderRules(); renderMart(); renderSpend(); renderWindows(); }
    if (S.tab === 'pnl') { renderPnlReported(); renderPnlModel(); }
    if (S.tab === 'data') renderData();
    renderStatus();
  }
  function onModel(name) {
    CS = null; renderStatus();
    if (S.tab === 'overview') { renderOverview(); return; }
    if (S.tab === 'retention') { if (name === 'segments') { renderSegments(); renderP1Kpis(); } if (name === 'churn') renderChurn(); if (name === 'churn' || name === 'spend' || name === 'segments') { renderGrid(); renderPlanner(); } }
    if (S.tab === 'discounts') { if (name === 'ab') { renderAB(); renderP2Kpis(); } if (name === 'uplift') { renderUplift(); renderP2Kpis(); } }
    if (S.tab === 'grocery') { if (name === 'rules') { renderRules(); renderP3Kpis(); } if (name === 'mart') renderMart(); if (name === 'spend') renderSpend(); }
    if (S.tab === 'pnl' && (name === 'uplift' || name === 'mart')) renderPnlModel();
  }
  function renderLive() {
    CS = null; renderStatus();
    if (S.tab === 'overview') { renderOverviewLive(); }
    if (S.tab === 'retention') renderP1Kpis();
    if (S.tab === 'discounts') renderP2Kpis();
    if (S.tab === 'grocery') { renderP3Kpis(); }
    if (S.tab === 'pnl') renderPnlModel();
    if (S.tab === 'data') renderData();
  }
  var lastFull = 0;
  function renderOverviewLive() { if (Date.now() - lastFull > 1500) { lastFull = Date.now(); renderOverview(); } else renderFeed(); }
  function setTab(t) {
    if (TABS.indexOf(t) < 0) t = 'overview';
    S.tab = t;
    TABS.forEach(function (x) { $('tab-' + x).classList.toggle('on', x === t); });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === t); if (a.getAttribute('data-tab') === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    renderTab();
    schedule();
  }
  function hashTab() { return (location.hash || '#overview').slice(1); }

  /* ---------- events ---------- */
  function wire() {
    window.addEventListener('hashchange', function () { setTab(hashTab()); });
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto], #tabs a[data-tab]');
      if (g) { e.preventDefault(); var tgt = g.getAttribute('data-goto') || g.getAttribute('data-tab'); setTab(tgt); try { history.replaceState(null, '', '#' + tgt); } catch (err) { /* hash not available in this frame */ } window.scrollTo(0, 0); return; }
      var sh = e.target.closest('[data-shock]');
      if (sh) { var k = sh.getAttribute('data-shock'); S.params[k] = !S.params[k]; sh.setAttribute('aria-pressed', S.params[k] ? 'true' : 'false'); if (!S.playing) togglePlay(); return; }
      var sv = e.target.closest('[data-svc]'); if (sv) { var key = sv.getAttribute('data-svc'); if (S.ui.sel[key]) delete S.ui.sel[key]; else S.ui.sel[key] = 1; renderReco(); return; }
      if (e.target.id === 'btnPlay') togglePlay();
      if (e.target.id === 'btnRetrain') { Object.keys(S.models).forEach(function (k) { S.models[k].dirty = true; }); schedule(); }
      if (e.target.id === 'btnReset') { reset(); S.params = { keetaPromo: false, serviceIssues: false, ramadan: false }; Array.prototype.forEach.call(document.querySelectorAll('[data-shock]'), function (b) { b.setAttribute('aria-pressed', 'false'); }); renderTab(); schedule(); }
      if (e.target.id === 'btnSim') simulateTest();
      if (e.target.id === 'btnCopy') {
        var csv = G.toCSV(S.rows), note = $('copy-note');
        try { navigator.clipboard.writeText(csv).then(function () { note.textContent = 'Copied ' + num(S.rows.length) + ' rows (' + G.COLUMNS.length + ' columns). Paste into a .csv file or Excel.'; }, function () { note.textContent = 'Clipboard access was refused by the browser. Use the CSV file shared in the chat instead.'; }); }
        catch (err) { note.textContent = 'Clipboard is not available here. Use the CSV file shared in the chat instead.'; }
      }
    });
    $('speed').addEventListener('change', function (e) { S.speed = +e.target.value; });
    document.addEventListener('input', function (e) {
      var t = e.target, id = t.id;
      if (id === 'thr') { S.ui.thr = +t.value; renderThreshold(); renderPlanner(); }
      else if (id === 'red') { S.ui.reduction = +t.value; S.ui.sim = null; renderPlanner(); }
      else if (id === 'delta') { S.ui.delta = +t.value; renderUplift(); renderP2Kpis(); }
      else if (id === 'cost' || id === 'profit' || id === 'imp') { S.ui[id] = +t.value; renderNet(); }
      else if (id === 'conf') { S.ui.minConf = +t.value; renderRules(); renderP3Kpis(); }
      else if (id === 'lift') { S.ui.minLift = +t.value; renderRules(); renderP3Kpis(); }
      else if (id === 'sup') { S.ui.minSup = +t.value; $('sup-out').textContent = pct(S.ui.minSup, 0); if (S.models.rules) S.models.rules.dirty = true; schedule(); }
      else if (t.getAttribute('data-pnl')) { P[t.getAttribute('data-pnl')] = +t.value; renderPnlModel(); }
      else if (t.getAttribute('data-wi')) { S.ui.wi[t.getAttribute('data-wi')] = +t.value; var o = $(id + '-o'); if (o) o.textContent = t.value; renderWhatIf(); }
    });
    $('main').addEventListener('change', function (e) { if (e.target.id === 'k') { S.ui.k = +e.target.value; if (S.models.segments) S.models.segments.dirty = true; waiting('p1-seg-scatter'); schedule(); } });
    var rt = null;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(renderTab, 200); });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { setTimeout(renderTab, 50); });
    new MutationObserver(function () { setTimeout(renderTab, 50); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function togglePlay() { S.playing = !S.playing; $('btnPlay').textContent = S.playing ? 'Pause stream' : 'Resume stream'; renderStatus(); }

  /* ---------- start ---------- */
  function init() {
    Ch.initTips();
    reset();
    buildTabs();
    // initial output values
    $('thr-out').textContent = '0.50'; $('red-out').textContent = '25%'; $('delta-out').textContent = '±10 pts';
    $('cost-out').textContent = 'AED 15'; $('profit-out').textContent = 'AED 22'; $('imp-out').textContent = 'AED 0.10';
    $('sup-out').textContent = '5%'; $('conf-out').textContent = '30%'; $('lift-out').textContent = '1.2';
    wire();
    setTab(hashTab());
    setInterval(function () {
      if (!S.playing) { renderStatus(); return; }
      S.acc += S.speed * 0.5; var k = Math.floor(S.acc);
      if (k > 0) { S.acc -= k; addRows(k); renderLive(); }
    }, 500);
    setInterval(schedule, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
