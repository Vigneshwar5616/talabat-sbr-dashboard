/* In-browser machine learning for the SBR simulator.
   Classification: logistic regression, CART decision tree, gradient boosting, XGBoost-style boosting.
   Clustering: k-means (k-means++), elbow, silhouette.  Association: Apriori.  Regression: ridge linear, boosted trees.
   Testing: two-proportion z-test, Welch t-test, sample size.  Uplift: two-model (T-learner).
   Data layout: column-major matrices, X[j] = Float64Array over all rows; models train on a list of row indices. */
(function (root) {
  'use strict';
  var ML = {};

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  ML.rand = mulberry32;
  function sigmoid(z) { return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }
  ML.sigmoid = sigmoid;

  ML.split = function (n, testFrac, seed) {
    var r = mulberry32(seed || 42), idx = new Array(n), i;
    for (i = 0; i < n; i++) idx[i] = i;
    for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    var nt = Math.round(n * testFrac);
    return { test: idx.slice(0, nt).sort(function (a, b) { return a - b; }), train: idx.slice(nt).sort(function (a, b) { return a - b; }) };
  };

  /* features: [{key,label,get(row)}] -> {X: [Float64Array], names, labels, n} */
  ML.matrix = function (rows, features) {
    var n = rows.length, X = [];
    for (var j = 0; j < features.length; j++) {
      var col = new Float64Array(n), g = features[j].get;
      for (var i = 0; i < n; i++) col[i] = +g(rows[i]) || 0;
      X.push(col);
    }
    return { X: X, n: n, keys: features.map(function (f) { return f.key; }), labels: features.map(function (f) { return f.label || f.key; }) };
  };
  ML.vector = function (rows, get) { var v = new Float64Array(rows.length); for (var i = 0; i < rows.length; i++) v[i] = +get(rows[i]) || 0; return v; };

  function colStats(X, idx) {
    var p = X.length, m = new Float64Array(p), s = new Float64Array(p);
    for (var j = 0; j < p; j++) {
      var col = X[j], sum = 0, sq = 0;
      for (var k = 0; k < idx.length; k++) { var v = col[idx[k]]; sum += v; sq += v * v; }
      m[j] = sum / idx.length;
      s[j] = Math.sqrt(Math.max(sq / idx.length - m[j] * m[j], 1e-12));
      if (s[j] < 1e-9) s[j] = 1;
    }
    return { mean: m, sd: s };
  }
  ML.colStats = colStats;

  /* ---------- Logistic regression (full-batch gradient descent, L2) ---------- */
  ML.logistic = function (M, y, idx, opts) {
    opts = opts || {};
    var X = M.X, p = X.length, st = colStats(X, idx), n = idx.length;
    var iters = opts.iters || 250, lr = opts.lr || 0.8, l2 = opts.l2 === undefined ? 1e-3 : opts.l2;
    var w = new Float64Array(p), pos = 0, k, j;
    for (k = 0; k < n; k++) pos += y[idx[k]];
    var prior = Math.min(Math.max(pos / n, 1e-3), 1 - 1e-3), b = Math.log(prior / (1 - prior));
    var Z = []; // standardized copy of training columns
    for (j = 0; j < p; j++) { var z = new Float64Array(n), col = X[j]; for (k = 0; k < n; k++) z[k] = (col[idx[k]] - st.mean[j]) / st.sd[j]; Z.push(z); }
    var eta = new Float64Array(n), grad = new Float64Array(p);
    for (var it = 0; it < iters; it++) {
      eta.fill(b);
      for (j = 0; j < p; j++) { var wj = w[j], zj = Z[j]; if (wj !== 0) for (k = 0; k < n; k++) eta[k] += wj * zj[k]; }
      var gb = 0; grad.fill(0);
      for (k = 0; k < n; k++) { var r = sigmoid(eta[k]) - y[idx[k]]; eta[k] = r; gb += r; }
      for (j = 0; j < p; j++) { var s = 0, zj2 = Z[j]; for (k = 0; k < n; k++) s += eta[k] * zj2[k]; grad[j] = s / n + l2 * w[j]; }
      b -= lr * gb / n;
      for (j = 0; j < p; j++) w[j] -= lr * grad[j];
    }
    return {
      type: 'Logistic regression', w: w, b: b, st: st,
      predictIdx: function (i) { var s = b; for (var j = 0; j < p; j++) s += w[j] * (X[j][i] - st.mean[j]) / st.sd[j]; return sigmoid(s); },
      predictVec: function (x) { var s = b; for (var j = 0; j < p; j++) s += w[j] * (x[j] - st.mean[j]) / st.sd[j]; return sigmoid(s); },
      importance: Array.prototype.map.call(w, function (v) { return Math.abs(v); })
    };
  };

  /* ---------- Ridge linear regression (closed form on standardized inputs) ---------- */
  function solve(A, bvec) { // Gaussian elimination with partial pivoting
    var n = bvec.length, i, j, k;
    var M = A.map(function (row, r) { return row.concat([bvec[r]]); });
    for (i = 0; i < n; i++) {
      var piv = i;
      for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      var t = M[i]; M[i] = M[piv]; M[piv] = t;
      var d = M[i][i] || 1e-12;
      for (k = i + 1; k < n; k++) { var f = M[k][i] / d; if (f !== 0) for (j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
    }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (M[i][i] || 1e-12); }
    return x;
  }
  ML.linear = function (M, y, idx, opts) {
    opts = opts || {};
    var X = M.X, p = X.length, st = colStats(X, idx), n = idx.length, lam = opts.l2 === undefined ? 1 : opts.l2, j, k, l;
    var ym = 0; for (k = 0; k < n; k++) ym += y[idx[k]]; ym /= n;
    var A = [], bv = new Array(p).fill(0);
    for (j = 0; j < p; j++) A.push(new Array(p).fill(0));
    var row = new Float64Array(p);
    for (k = 0; k < n; k++) {
      var i = idx[k];
      for (j = 0; j < p; j++) row[j] = (X[j][i] - st.mean[j]) / st.sd[j];
      var yc = y[i] - ym;
      for (j = 0; j < p; j++) { bv[j] += row[j] * yc; var rj = row[j]; for (l = j; l < p; l++) A[j][l] += rj * row[l]; }
    }
    for (j = 0; j < p; j++) { for (l = 0; l < j; l++) A[j][l] = A[l][j]; A[j][j] += lam; }
    var w = solve(A, bv);
    return {
      type: 'Linear regression', w: w, b: ym, st: st,
      predictIdx: function (i) { var s = ym; for (var j = 0; j < p; j++) s += w[j] * (X[j][i] - st.mean[j]) / st.sd[j]; return s; },
      predictVec: function (x) { var s = ym; for (var j = 0; j < p; j++) s += w[j] * (x[j] - st.mean[j]) / st.sd[j]; return s; },
      importance: w.map(Math.abs)
    };
  };

  /* ---------- Feature binning shared by all tree models ---------- */
  ML.bins = function (M, idx, nBins) {
    nBins = nBins || 32;
    var X = M.X, thr = [], B = [];
    for (var j = 0; j < X.length; j++) {
      var col = X[j], vals = new Float64Array(idx.length);
      for (var k = 0; k < idx.length; k++) vals[k] = col[idx[k]];
      vals.sort();
      var uniq = [];
      for (k = 0; k < vals.length; k++) if (k === 0 || vals[k] !== vals[k - 1]) uniq.push(vals[k]);
      var t = [];
      if (uniq.length <= nBins) { for (k = 0; k + 1 < uniq.length; k++) t.push((uniq[k] + uniq[k + 1]) / 2); }
      else {
        for (var q = 1; q < nBins; q++) {
          var v = vals[Math.floor(q * vals.length / nBins)];
          if (!t.length || v > t[t.length - 1]) t.push(v);
        }
        if (t.length && t[t.length - 1] >= uniq[uniq.length - 1]) t.pop();
      }
      thr.push(t);
      var b = new Uint8Array(M.n);
      for (var i = 0; i < M.n; i++) { // binary search: first threshold >= value
        var x = col[i], lo = 0, hi = t.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (x <= t[mid]) hi = mid; else lo = mid + 1; }
        b[i] = lo;
      }
      B.push(b);
    }
    return { B: B, thr: thr };
  };

  /* Tree on gradients: g, hSplit (hessian used for split search), hLeaf (hessian for leaf value) */
  function buildTree(bin, g, hS, hL, rows, depth, o, feats, imp) {
    var G = 0, HS = 0, HL = 0, n = rows.length, k, i;
    for (k = 0; k < n; k++) { i = rows[k]; G += g[i]; HS += hS[i]; HL += hL[i]; }
    var leaf = { v: -G / (HL + o.lambda) };
    if (depth >= o.maxDepth || n < 2 * o.minLeaf) return leaf;
    var best = { gain: 0, f: -1, t: -1 }, parent = G * G / (HS + o.lambdaSplit);
    for (var fi = 0; fi < feats.length; fi++) {
      var f = feats[fi], bf = bin.B[f], nb = bin.thr[f].length + 1;
      if (nb < 2) continue;
      var hg = new Float64Array(nb), hh = new Float64Array(nb), hc = new Int32Array(nb);
      for (k = 0; k < n; k++) { i = rows[k]; var bb = bf[i]; hg[bb] += g[i]; hh[bb] += hS[i]; hc[bb]++; }
      var GLs = 0, HLs = 0, CL = 0;
      for (var t = 0; t < nb - 1; t++) {
        GLs += hg[t]; HLs += hh[t]; CL += hc[t];
        var CR = n - CL; if (CL < o.minLeaf || CR < o.minLeaf) continue;
        var HRs = HS - HLs; if (HLs < o.minChild || HRs < o.minChild) continue;
        var GRs = G - GLs;
        var gain = GLs * GLs / (HLs + o.lambdaSplit) + GRs * GRs / (HRs + o.lambdaSplit) - parent;
        if (gain > best.gain) { best.gain = gain; best.f = f; best.t = t; }
      }
    }
    if (best.f < 0 || best.gain * 0.5 <= o.gamma) return leaf;
    imp[best.f] += best.gain;
    var left = [], right = [], bf2 = bin.B[best.f];
    for (k = 0; k < n; k++) { i = rows[k]; if (bf2[i] <= best.t) left.push(i); else right.push(i); }
    return { f: best.f, t: best.t, thr: bin.thr[best.f][best.t], l: buildTree(bin, g, hS, hL, left, depth + 1, o, feats, imp), r: buildTree(bin, g, hS, hL, right, depth + 1, o, feats, imp) };
  }
  function treeIdx(node, B, i) { while (node.v === undefined) node = B[node.f][i] <= node.t ? node.l : node.r; return node.v; }
  function treeVec(node, x) { while (node.v === undefined) node = x[node.f] <= node.thr ? node.l : node.r; return node.v; }

  /* Gradient boosting.  opts.style: 'gbm' (classic first-order split search, no regularisation)
     or 'xgb' (second-order gain with L2 lambda, gamma, row/column subsampling). opts.loss: 'logistic'|'squared'. */
  ML.boost = function (M, y, idx, opts) {
    var o = Object.assign({ style: 'xgb', loss: 'logistic', rounds: 60, eta: 0.15, maxDepth: 3, lambda: 1, gamma: 0, minLeaf: 10, minChild: 1, subsample: 0.8, colsample: 0.8, seed: 7, bins: null }, opts || {});
    if (o.style === 'gbm') { o.lambda = 0; o.gamma = 0; o.subsample = opts && opts.subsample || 1; o.colsample = 1; }
    o.lambdaSplit = o.style === 'gbm' ? 0 : o.lambda;
    if (o.style === 'gbm' && o.lambda === 0) o.lambda = 1e-6;
    var bin = o.bins || ML.bins(M, idx, 32), p = M.X.length, N = M.n, r = mulberry32(o.seed), k, i;
    var base = 0, n = idx.length;
    for (k = 0; k < n; k++) base += y[idx[k]];
    base /= n;
    if (o.loss === 'logistic') { base = Math.min(Math.max(base, 1e-3), 1 - 1e-3); base = Math.log(base / (1 - base)); }
    var F = new Float64Array(N).fill(base), g = new Float64Array(N), h = new Float64Array(N), ones = new Float64Array(N).fill(1);
    var trees = [], imp = new Float64Array(p);
    for (var m = 0; m < o.rounds; m++) {
      for (k = 0; k < n; k++) {
        i = idx[k];
        if (o.loss === 'logistic') { var pr = sigmoid(F[i]); g[i] = pr - y[i]; h[i] = Math.max(pr * (1 - pr), 1e-6); }
        else { g[i] = F[i] - y[i]; h[i] = 1; }
      }
      var rows = idx;
      if (o.subsample < 1) { rows = []; for (k = 0; k < n; k++) if (r() < o.subsample) rows.push(idx[k]); }
      var feats = [];
      for (var j = 0; j < p; j++) if (o.colsample >= 1 || r() < o.colsample) feats.push(j);
      if (!feats.length) feats.push(Math.floor(r() * p));
      var hS = (o.style === 'gbm' || o.loss === 'squared') ? ones : h;
      var tree = buildTree(bin, g, hS, h, rows, 0, o, feats, imp);
      trees.push(tree);
      for (k = 0; k < n; k++) { i = idx[k]; F[i] += o.eta * treeIdx(tree, bin.B, i); }
    }
    var link = o.loss === 'logistic' ? sigmoid : function (z) { return z; };
    return {
      type: o.style === 'gbm' ? 'Gradient boosting' : 'XGBoost', trees: trees, base: base, eta: o.eta, bins: bin,
      importance: Array.prototype.slice.call(imp),
      predictIdx: function (i) { var s = base; for (var t = 0; t < trees.length; t++) s += o.eta * treeIdx(trees[t], bin.B, i); return link(s); },
      predictVec: function (x) { var s = base; for (var t = 0; t < trees.length; t++) s += o.eta * treeVec(trees[t], x); return link(s); }
    };
  };

  /* ---------- CART decision tree classifier (Gini), as in the churn blog ---------- */
  ML.tree = function (M, y, idx, opts) {
    var o = Object.assign({ maxDepth: 3, minLeaf: 20 }, opts || {});
    var bin = o.bins || ML.bins(M, idx, 32), p = M.X.length, imp = new Float64Array(p);
    function gini(pos, n) { if (!n) return 0; var q = pos / n; return 1 - q * q - (1 - q) * (1 - q); }
    function grow(rows, depth) {
      var n = rows.length, pos = 0, k;
      for (k = 0; k < n; k++) pos += y[rows[k]];
      var leaf = { v: (pos + 1) / (n + 2), n: n };
      if (depth >= o.maxDepth || n < 2 * o.minLeaf || pos === 0 || pos === n) return leaf;
      var parent = gini(pos, n) * n, best = { gain: 1e-9, f: -1, t: -1 };
      for (var f = 0; f < p; f++) {
        var nb = bin.thr[f].length + 1; if (nb < 2) continue;
        var cp = new Int32Array(nb), cn = new Int32Array(nb), bf = bin.B[f];
        for (k = 0; k < n; k++) { var i = rows[k]; cn[bf[i]]++; cp[bf[i]] += y[i]; }
        var lp = 0, ln = 0;
        for (var t = 0; t < nb - 1; t++) {
          lp += cp[t]; ln += cn[t];
          var rn = n - ln; if (ln < o.minLeaf || rn < o.minLeaf) continue;
          var gain = parent - gini(lp, ln) * ln - gini(pos - lp, rn) * rn;
          if (gain > best.gain) { best = { gain: gain, f: f, t: t }; }
        }
      }
      if (best.f < 0) return leaf;
      imp[best.f] += best.gain;
      var L = [], R = [], bf2 = bin.B[best.f];
      for (k = 0; k < n; k++) (bf2[rows[k]] <= best.t ? L : R).push(rows[k]);
      return { f: best.f, t: best.t, thr: bin.thr[best.f][best.t], l: grow(L, depth + 1), r: grow(R, depth + 1) };
    }
    var root = grow(idx, 0);
    return {
      type: 'Decision tree', root: root, importance: Array.prototype.slice.call(imp),
      predictIdx: function (i) { return treeIdx(root, bin.B, i); },
      predictVec: function (x) { return treeVec(root, x); }
    };
  };

  /* ---------- Classification and regression metrics ---------- */
  ML.classMetrics = function (prob, y, idx, thr) {
    thr = thr === undefined ? 0.5 : thr;
    var tp = 0, fp = 0, tn = 0, fn = 0, k;
    var pairs = [];
    for (k = 0; k < idx.length; k++) {
      var i = idx[k], pr = prob[i], yy = y[i];
      pairs.push([pr, yy]);
      if (pr >= thr) { if (yy) tp++; else fp++; } else { if (yy) fn++; else tn++; }
    }
    pairs.sort(function (a, b) { return b[0] - a[0]; });
    var P = tp + fn, Nn = tn + fp, all = [[0, 0]], ctp = 0, cfp = 0, auc = 0, prevF = 0, prevT = 0;
    for (k = 0; k < pairs.length; k++) {
      if (pairs[k][1]) ctp++; else cfp++;
      var last = k === pairs.length - 1 || pairs[k + 1][0] !== pairs[k][0];
      if (last) {
        var fpr = Nn ? cfp / Nn : 0, tpr = P ? ctp / P : 0;
        auc += (fpr - prevF) * (tpr + prevT) / 2; prevF = fpr; prevT = tpr;
        all.push([fpr, tpr]);
      }
    }
    var roc = all;
    if (all.length > 80) { roc = []; var stp = (all.length - 1) / 79; for (var q = 0; q < 80; q++) roc.push(all[Math.round(q * stp)]); }
    var prec = tp + fp ? tp / (tp + fp) : 0, rec = P ? tp / P : 0;
    return { acc: (tp + tn) / Math.max(1, idx.length), prec: prec, rec: rec, f1: prec + rec ? 2 * prec * rec / (prec + rec) : 0, auc: auc, cm: { tp: tp, fp: fp, tn: tn, fn: fn }, roc: roc, n: idx.length, pos: P };
  };
  ML.regMetrics = function (pred, y, idx) {
    var n = idx.length, ym = 0, k;
    for (k = 0; k < n; k++) ym += y[idx[k]]; ym /= n;
    var ssr = 0, sst = 0, ae = 0;
    for (k = 0; k < n; k++) { var i = idx[k], e = y[i] - pred[i]; ssr += e * e; sst += (y[i] - ym) * (y[i] - ym); ae += Math.abs(e); }
    return { r2: 1 - ssr / (sst || 1), mae: ae / n, rmse: Math.sqrt(ssr / n), n: n };
  };
  ML.predictAll = function (model, n) { var out = new Float64Array(n); for (var i = 0; i < n; i++) out[i] = model.predictIdx(i); return out; };

  /* ---------- K-means (k-means++ init, Lloyd iterations) ---------- */
  function sq(a, b) { var s = 0; for (var j = 0; j < a.length; j++) { var d = a[j] - b[j]; s += d * d; } return s; }
  ML.kmeans = function (P, k, opts) { // P: array of point arrays (already scaled)
    var o = Object.assign({ nInit: 3, maxIter: 60, seed: 11 }, opts || {}), r = mulberry32(o.seed), n = P.length, best = null;
    for (var run = 0; run < o.nInit; run++) {
      var C = [P[Math.floor(r() * n)].slice()], d2 = new Float64Array(n), i, c;
      while (C.length < k) {
        var tot = 0;
        for (i = 0; i < n; i++) { var md = Infinity; for (c = 0; c < C.length; c++) md = Math.min(md, sq(P[i], C[c])); d2[i] = md; tot += md; }
        var x = r() * tot, pick = n - 1;
        for (i = 0; i < n; i++) { x -= d2[i]; if (x <= 0) { pick = i; break; } }
        C.push(P[pick].slice());
      }
      var lab = new Int32Array(n), inertia = 0;
      for (var it = 0; it < o.maxIter; it++) {
        var changed = false; inertia = 0;
        for (i = 0; i < n; i++) {
          var bd = Infinity, bc = 0;
          for (c = 0; c < k; c++) { var dd = sq(P[i], C[c]); if (dd < bd) { bd = dd; bc = c; } }
          if (lab[i] !== bc || it === 0) { changed = changed || lab[i] !== bc; lab[i] = bc; }
          inertia += bd;
        }
        var dim = P[0].length, S = [], cnt = new Int32Array(k);
        for (c = 0; c < k; c++) S.push(new Float64Array(dim));
        for (i = 0; i < n; i++) { cnt[lab[i]]++; for (var j = 0; j < dim; j++) S[lab[i]][j] += P[i][j]; }
        for (c = 0; c < k; c++) if (cnt[c]) for (j = 0; j < dim; j++) C[c][j] = S[c][j] / cnt[c];
        if (!changed && it > 0) break;
      }
      if (!best || inertia < best.inertia) best = { labels: lab, centroids: C.map(function (a) { return Array.prototype.slice.call(a); }), inertia: inertia, k: k };
    }
    return best;
  };
  ML.silhouette = function (P, labels, k, maxN, seed) {
    var n = P.length, r = mulberry32(seed || 5), take = [];
    for (var i = 0; i < n; i++) take.push(i);
    if (n > maxN) { for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = take[i]; take[i] = take[j]; take[j] = t; } take = take.slice(0, maxN); }
    var tot = 0, cnt = 0;
    for (var a = 0; a < take.length; a++) {
      var ia = take[a], sum = new Float64Array(k), c = new Int32Array(k);
      for (var b = 0; b < take.length; b++) { if (a === b) continue; var ib = take[b]; sum[labels[ib]] += Math.sqrt(sq(P[ia], P[ib])); c[labels[ib]]++; }
      var own = labels[ia]; if (c[own] === 0) continue;
      var A = sum[own] / c[own], B = Infinity;
      for (var q = 0; q < k; q++) if (q !== own && c[q]) B = Math.min(B, sum[q] / c[q]);
      if (B === Infinity) continue;
      tot += (B - A) / Math.max(A, B); cnt++;
    }
    return cnt ? tot / cnt : 0;
  };

  /* ---------- Apriori (level-wise candidate generation with subset pruning) ---------- */
  ML.apriori = function (rows, keys, minSupport, maxLen) {
    maxLen = maxLen || 3;
    var n = rows.length, m = keys.length, masks = new Int32Array(n), i, j;
    for (i = 0; i < n; i++) { var mk = 0; for (j = 0; j < m; j++) if (rows[i][keys[j]]) mk |= (1 << j); masks[i] = mk; }
    function support(set) { var bits = 0; for (var q = 0; q < set.length; q++) bits |= 1 << set[q]; var c = 0; for (var r = 0; r < n; r++) if ((masks[r] & bits) === bits) c++; return c / n; }
    var sup = {}, levels = [], L = [], counted = 0;
    for (j = 0; j < m; j++) { var s1 = support([j]); counted++; sup[j] = s1; if (s1 >= minSupport) L.push([j]); }
    levels.push(L);
    for (var kk = 2; kk <= maxLen && L.length; kk++) {
      var Lset = {}; L.forEach(function (s) { Lset[s.join(',')] = 1; });
      var cand = [];
      for (i = 0; i < L.length; i++) for (j = i + 1; j < L.length; j++) {
        var a = L[i], b = L[j], same = true;
        for (var q = 0; q < kk - 2; q++) if (a[q] !== b[q]) { same = false; break; }
        if (!same || a[kk - 2] >= b[kk - 2]) continue;
        var c = a.concat([b[kk - 2]]), ok = true;
        for (q = 0; q < c.length && ok; q++) { var sub = c.slice(0, q).concat(c.slice(q + 1)); if (!Lset[sub.join(',')]) ok = false; }
        if (ok) cand.push(c);
      }
      var next = [];
      cand.forEach(function (c) { var s = support(c); counted++; sup[c.join(',')] = s; if (s >= minSupport) next.push(c); });
      levels.push(next); L = next;
    }
    var itemsets = [];
    levels.forEach(function (lv) { lv.forEach(function (s) { itemsets.push({ items: s, support: sup[s.join(',')] }); }); });
    return { itemsets: itemsets, sup: sup, n: n, candidatesCounted: counted, itemSupport: keys.map(function (_, q) { return sup[q]; }) };
  };
  ML.rules = function (ap, minConf, minLift) {
    var out = [];
    ap.itemsets.forEach(function (it) {
      if (it.items.length < 2) return;
      it.items.forEach(function (cons, q) {
        var ante = it.items.slice(0, q).concat(it.items.slice(q + 1));
        var sa = ap.sup[ante.join(',')], sc = ap.sup[cons];
        if (!sa || !sc) return;
        var conf = it.support / sa, lift = conf / sc;
        if (conf >= minConf && lift >= minLift) out.push({ ante: ante, cons: cons, support: it.support, conf: conf, lift: lift, leverage: it.support - sa * sc });
      });
    });
    out.sort(function (a, b) { return b.lift - a.lift || b.conf - a.conf; });
    return out;
  };

  /* ---------- Statistical tests ---------- */
  function erf(x) { // Abramowitz-Stegun 7.1.26
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  ML.normCdf = function (z) { return 0.5 * (1 + erf(z / Math.SQRT2)); };
  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015; for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      var del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  ML.tTwoSidedP = function (t, df) { return ibeta(df / (df + t * t), df / 2, 0.5); };
  ML.twoPropZ = function (x1, n1, x2, n2) {
    var p1 = x1 / n1, p2 = x2 / n2, pp = (x1 + x2) / (n1 + n2);
    var se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)) || 1e-9, z = (p2 - p1) / se;
    var seU = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
    return { p1: p1, p2: p2, diff: p2 - p1, z: z, p: 2 * (1 - ML.normCdf(Math.abs(z))), lo: p2 - p1 - 1.96 * seU, hi: p2 - p1 + 1.96 * seU, n1: n1, n2: n2, se1: Math.sqrt(p1 * (1 - p1) / n1), se2: Math.sqrt(p2 * (1 - p2) / n2) };
  };
  ML.welch = function (a, b) {
    function mv(x) { var m = 0, i; for (i = 0; i < x.length; i++) m += x[i]; m /= x.length; var v = 0; for (i = 0; i < x.length; i++) v += (x[i] - m) * (x[i] - m); return [m, v / (x.length - 1)]; }
    var A = mv(a), B = mv(b), na = a.length, nb = b.length, se2 = A[1] / na + B[1] / nb, t = (B[0] - A[0]) / Math.sqrt(se2);
    var df = se2 * se2 / ((A[1] / na) * (A[1] / na) / (na - 1) + (B[1] / nb) * (B[1] / nb) / (nb - 1));
    return { m1: A[0], m2: B[0], t: t, df: df, p: ML.tTwoSidedP(Math.abs(t), df) };
  };
  ML.sampleSize = function (p1, p2, power) { // per group, alpha = 0.05 two-sided
    var za = 1.959964, zb = power >= 0.9 ? 1.281552 : 0.841621, pb = (p1 + p2) / 2, d = Math.abs(p2 - p1);
    if (d < 1e-6) return Infinity;
    var num = za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
    return Math.ceil(num * num / (d * d));
  };

  /* ---------- Uplift: two-model (T-learner) with boosted classifiers ---------- */
  ML.uplift = function (M, y, treat, trainIdx, testIdx, opts) {
    var tr = trainIdx.filter(function (i) { return treat[i]; }), co = trainIdx.filter(function (i) { return !treat[i]; });
    var bins = ML.bins(M, trainIdx, 24);
    var o = Object.assign({ style: 'xgb', rounds: 50, eta: 0.12, maxDepth: 3, lambda: 2, minLeaf: 15, bins: bins }, opts || {});
    var mT = ML.boost(M, y, tr, Object.assign({}, o, { seed: 3 })), mC = ML.boost(M, y, co, Object.assign({}, o, { seed: 4 }));
    var n = M.n, pT = new Float64Array(n), pC = new Float64Array(n), up = new Float64Array(n);
    for (var i = 0; i < n; i++) { pT[i] = mT.predictIdx(i); pC[i] = mC.predictIdx(i); up[i] = pT[i] - pC[i]; }
    // uplift (incremental gains) curve on the test set
    var order = testIdx.slice().sort(function (a, b) { return up[b] - up[a]; }), curve = [[0, 0]];
    var allT = 0, allTc = 0, allC = 0, allCc = 0;
    order.forEach(function (i) { if (treat[i]) { allT++; allTc += y[i]; } else { allC++; allCc += y[i]; } });
    var overall = (allT ? allTc / allT : 0) - (allC ? allCc / allC : 0);
    var nt = 0, ntc = 0, nc = 0, ncc = 0, steps = 10, q = 1;
    for (var k = 0; k < order.length; k++) {
      var j = order[k]; if (treat[j]) { nt++; ntc += y[j]; } else { nc++; ncc += y[j]; }
      if (k + 1 >= Math.round(q * order.length / steps)) {
        var gain = ((nt ? ntc / nt : 0) - (nc ? ncc / nc : 0)) * (k + 1);
        curve.push([(k + 1) / order.length, gain]); q++;
      }
    }
    return { pT: pT, pC: pC, uplift: up, curve: curve, overall: overall, nTest: order.length, models: [mT, mC], importance: mT.importance.map(function (v, idx) { return v + mC.importance[idx]; }) };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ML; else root.ML = ML;
})(this);
