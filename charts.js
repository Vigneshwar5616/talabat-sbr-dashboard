/* Small SVG chart kit following the dataviz mark specs: 2px lines, <=24px bars with 4px rounded data ends,
   hairline grid, text in ink tokens, hover tooltips on every mark via [data-tip]. */
(function (root) {
  'use strict';
  var C = {};
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  C.esc = esc;

  C.ticks = function (min, max, count) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (max - min < 1e-12) { max = min + 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count))), err = count / span * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var out = [], t0 = Math.floor(min / step + 1e-9) * step, t1 = Math.ceil(max / step - 1e-9) * step;
    for (var v = t0; v <= t1 + step * 1e-6; v += step) out.push(+v.toFixed(10));
    return out;
  };
  C.fmtAxis = function (v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a % 1e6 ? 1 : 0) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K';
    if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a === 0) return '0';
    if (a < 1) return String(+v.toFixed(2));
    return String(+v.toFixed(1));
  };
  C.pctAxis = function (v) { return Math.round(v * 100) + '%'; };

  function frame(W, H, inner) { return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" preserveAspectRatio="xMinYMin meet">' + inner + '</svg>'; }
  function width(el) { return Math.max(260, Math.floor(el.clientWidth || el.getBoundingClientRect().width || 520)); }

  function axes(o) { // o: W,H,m,sx,sy,xt,yt,xFmt,yFmt,xLabel,yLabel,noXGrid
    var s = '', i;
    for (i = 0; i < o.yt.length; i++) {
      var y = o.sy(o.yt[i]);
      s += '<line class="grid" x1="' + o.m.l + '" x2="' + (o.W - o.m.r) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="tick" x="' + (o.m.l - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(o.yFmt(o.yt[i])) + '</text>';
    }
    for (i = 0; i < o.xt.length; i++) {
      var x = o.sx(o.xt[i]);
      s += '<text class="tick" x="' + x + '" y="' + (o.H - o.m.b + 16) + '" text-anchor="middle">' + esc(o.xFmt(o.xt[i])) + '</text>';
    }
    s += '<line class="axis" x1="' + o.m.l + '" x2="' + (o.W - o.m.r) + '" y1="' + (o.H - o.m.b) + '" y2="' + (o.H - o.m.b) + '"/>';
    if (o.xLabel) s += '<text class="alabel" x="' + ((o.m.l + o.W - o.m.r) / 2) + '" y="' + (o.H - 4) + '" text-anchor="middle">' + esc(o.xLabel) + '</text>';
    if (o.yLabel) s += '<text class="alabel" x="' + (o.m.l) + '" y="' + 10 + '" text-anchor="start">' + esc(o.yLabel) + '</text>';
    return s;
  }
  function scale(d0, d1, r0, r1) { var k = (r1 - r0) / ((d1 - d0) || 1); return function (v) { return +(r0 + (v - d0) * k).toFixed(2); }; }

  /* Line chart. o.series:[{name,color,pts:[[x,y]],area,width}], o.x:[a,b], o.y:[a,b], o.diag, o.vlines:[{x,label}], o.endLabels */
  C.line = function (el, o) {
    var W = width(el), H = o.h || 240, m = { l: o.ml || 46, r: o.endLabels ? 104 : 14, t: o.yLabel ? 22 : 10, b: o.xLabel ? 38 : 24 };
    var xs = [], ys = [];
    o.series.forEach(function (s) { s.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    var xd = o.x || [Math.min.apply(null, xs), Math.max.apply(null, xs)];
    var yd = o.y || [Math.min(0, Math.min.apply(null, ys)), Math.max.apply(null, ys) * 1.08];
    var yt = C.ticks(yd[0], yd[1], o.yTicks || 4); if (!o.y) yd = [yt[0], yt[yt.length - 1]]; else yt = yt.filter(function (v) { return v >= yd[0] - 1e-9 && v <= yd[1] + 1e-9; });
    var xt = o.xTicks || C.ticks(xd[0], xd[1], 5).filter(function (v) { return v >= xd[0] - 1e-9 && v <= xd[1] + 1e-9; });
    var sx = scale(xd[0], xd[1], m.l, W - m.r), sy = scale(yd[0], yd[1], H - m.b, m.t);
    var s = axes({ W: W, H: H, m: m, sx: sx, sy: sy, xt: xt, yt: yt, xFmt: o.xFmt || C.fmtAxis, yFmt: o.yFmt || C.fmtAxis, xLabel: o.xLabel, yLabel: o.yLabel });
    if (o.diag) s += '<line class="ref" x1="' + sx(xd[0]) + '" y1="' + sy(yd[0]) + '" x2="' + sx(xd[1]) + '" y2="' + sy(yd[1]) + '"/>';
    (o.vlines || []).forEach(function (v) {
      var x = sx(v.x);
      s += '<line class="ref" x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
      if (v.label) s += '<text class="tick strong" x="' + (x + 4) + '" y="' + (m.t + 10) + '">' + esc(v.label) + '</text>';
    });
    var ends = [];
    o.series.forEach(function (sr) {
      if (!sr.pts.length) return;
      var d = sr.pts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]) + ' ' + sy(p[1]); }).join('');
      if (sr.area) s += '<path d="' + d + 'L' + sx(sr.pts[sr.pts.length - 1][0]) + ' ' + sy(yd[0]) + 'L' + sx(sr.pts[0][0]) + ' ' + sy(yd[0]) + 'Z" fill="' + sr.color + '" opacity="0.10"/>';
      s += '<path d="' + d + '" fill="none" stroke="' + sr.color + '" stroke-width="' + (sr.width || 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (sr.dash ? ' stroke-dasharray="4 4"' : '') + '/>';
      var last = sr.pts[sr.pts.length - 1];
      if (o.endDot !== false) s += '<circle cx="' + sx(last[0]) + '" cy="' + sy(last[1]) + '" r="4" fill="' + sr.color + '" class="ring"/>';
      ends.push({ y: sy(last[1]), x: sx(last[0]), name: sr.name, color: sr.color, val: last[1] });
      if (sr.pts.length <= 160) sr.pts.forEach(function (p) {
        var tip = (sr.tip ? sr.tip(p) : esc(sr.name) + '<br>' + esc((o.xFmt || C.fmtAxis)(p[0])) + ': <b>' + esc((o.tipFmt || o.yFmt || C.fmtAxis)(p[1])) + '</b>');
        s += '<circle class="hit" cx="' + sx(p[0]) + '" cy="' + sy(p[1]) + '" r="7" data-tip="' + esc(tip) + '"/>';
      });
    });
    if (o.endLabels) {
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].ly = (ends[i - 1].ly || ends[i - 1].y) + 14;
      ends.forEach(function (e) {
        var ly = e.ly || e.y;
        s += '<line x1="' + (e.x + 6) + '" x2="' + (W - m.r + 10) + '" y1="' + e.y + '" y2="' + ly + '" stroke="' + e.color + '" stroke-width="1"/>';
        s += '<text class="elabel" x="' + (W - m.r + 14) + '" y="' + (ly + 4) + '">' + esc(e.name) + ' ' + esc((o.tipFmt || o.yFmt || C.fmtAxis)(e.val)) + '</text>';
      });
    }
    el.innerHTML = frame(W, H, s);
  };

  function hbarPath(x0, x1, y, h) {
    var r = Math.min(4, h / 2, Math.max(0, x1 - x0));
    if (x1 - x0 < 0.5) return '';
    return 'M' + x0 + ' ' + y + 'H' + (x1 - r) + 'Q' + x1 + ' ' + y + ' ' + x1 + ' ' + (y + r) + 'V' + (y + h - r) + 'Q' + x1 + ' ' + (y + h) + ' ' + (x1 - r) + ' ' + (y + h) + 'H' + x0 + 'Z';
  }
  function vbarPath(x, w, y0, y1) { // grows up from baseline y0 to y1 (y1 < y0)
    var r = Math.min(4, w / 2, Math.max(0, y0 - y1));
    if (y0 - y1 < 0.5) return '';
    return 'M' + x + ' ' + y0 + 'V' + (y1 + r) + 'Q' + x + ' ' + y1 + ' ' + (x + r) + ' ' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y1 + ' ' + (x + w) + ' ' + (y1 + r) + 'V' + y0 + 'Z';
  }

  /* Horizontal bars: o.items [{label,value,color,tip}], o.fmt, o.labelW, o.max */
  C.barH = function (el, o) {
    var W = width(el), rowH = o.rowH || 26, bh = Math.min(16, rowH - 8), lw = o.labelW || Math.min(190, Math.floor(W * 0.42)), vw = o.valueW || 64;
    var H = o.items.length * rowH + 6, max = o.max || Math.max.apply(null, o.items.map(function (d) { return d.value; }).concat([1e-9]));
    var sx = scale(0, max, lw, W - vw), s = '';
    o.items.forEach(function (d, i) {
      var y = i * rowH + 3, x1 = sx(Math.max(0, d.value));
      s += '<text class="blabel" x="' + (lw - 8) + '" y="' + (y + bh / 2 + 4) + '" text-anchor="end">' + esc(d.label) + '</text>';
      s += '<path d="' + hbarPath(lw, x1, y, bh) + '" fill="' + (d.color || 'var(--s1)') + '"/>';
      s += '<text class="bval" x="' + (x1 + 6) + '" y="' + (y + bh / 2 + 4) + '">' + esc((o.fmt || C.fmtAxis)(d.value)) + '</text>';
      s += '<rect class="hit" x="0" y="' + (y - 3) + '" width="' + W + '" height="' + rowH + '" data-tip="' + esc(d.tip || (esc(d.label) + ': <b>' + esc((o.fmt || C.fmtAxis)(d.value)) + '</b>')) + '"/>';
    });
    s += '<line class="axis" x1="' + lw + '" x2="' + lw + '" y1="0" y2="' + (H - 3) + '"/>';
    el.innerHTML = frame(W, H, s);
  };

  /* Columns with optional 95% CI whiskers: o.items [{label,value,lo,hi,color,tip,sub}] */
  C.columns = function (el, o) {
    var W = width(el), H = o.h || 220, m = { l: o.ml || 44, r: 10, t: o.yLabel ? 24 : 12, b: o.subLabels ? 40 : 26 };
    var vals = o.items.map(function (d) { return Math.max(d.value, d.hi || 0); });
    var yd = [0, o.yMax || Math.max.apply(null, vals.concat([1e-9])) * 1.15], yt = C.ticks(yd[0], yd[1], 4); yd[1] = yt[yt.length - 1];
    var band = (W - m.l - m.r) / o.items.length, bw = Math.min(o.barW || 24, band * 0.6);
    var sy = scale(yd[0], yd[1], H - m.b, m.t), s = '';
    s += axes({ W: W, H: H, m: m, sx: function () { return 0; }, sy: sy, xt: [], yt: yt, xFmt: String, yFmt: o.yFmt || C.fmtAxis, yLabel: o.yLabel });
    o.items.forEach(function (d, i) {
      var cx = m.l + band * i + band / 2, x = cx - bw / 2, y1 = sy(d.value);
      s += '<path d="' + vbarPath(x, bw, H - m.b, y1) + '" fill="' + (d.color || 'var(--s1)') + '"/>';
      if (d.lo !== undefined) {
        var ylo = sy(d.lo), yhi = sy(d.hi);
        s += '<line class="whisk" x1="' + cx + '" x2="' + cx + '" y1="' + ylo + '" y2="' + yhi + '"/><line class="whisk" x1="' + (cx - 6) + '" x2="' + (cx + 6) + '" y1="' + yhi + '" y2="' + yhi + '"/><line class="whisk" x1="' + (cx - 6) + '" x2="' + (cx + 6) + '" y1="' + ylo + '" y2="' + ylo + '"/>';
      }
      var labY = (d.hi !== undefined ? sy(d.hi) : y1) - 6;
      if (o.valueLabels !== false) s += '<text class="bval" x="' + (cx + (d.lo !== undefined ? 10 : 0)) + '" y="' + labY + '" text-anchor="' + (d.lo !== undefined ? 'start' : 'middle') + '">' + esc((o.fmt || o.yFmt || C.fmtAxis)(d.value)) + '</text>';
      s += '<text class="tick" x="' + cx + '" y="' + (H - m.b + 15) + '" text-anchor="middle">' + esc(d.label) + '</text>';
      if (d.sub) s += '<text class="tick" x="' + cx + '" y="' + (H - m.b + 29) + '" text-anchor="middle">' + esc(d.sub) + '</text>';
      s += '<rect class="hit" x="' + (cx - band / 2) + '" y="' + m.t + '" width="' + band + '" height="' + (H - m.t - m.b) + '" data-tip="' + esc(d.tip || (esc(d.label) + ': <b>' + esc((o.fmt || o.yFmt || C.fmtAxis)(d.value)) + '</b>')) + '"/>';
    });
    el.innerHTML = frame(W, H, s);
  };

  /* Scatter: o.pts [{x,y,c,tip}], o.x, o.y, o.diag */
  C.scatter = function (el, o) {
    var W = width(el), H = o.h || 260, m = { l: o.ml || 50, r: 14, t: o.yLabel ? 22 : 10, b: o.xLabel ? 38 : 24 };
    var xs = o.pts.map(function (p) { return p.x; }), ys = o.pts.map(function (p) { return p.y; });
    var xd = o.x || [Math.min.apply(null, xs), Math.max.apply(null, xs)], yd = o.y || [Math.min.apply(null, ys), Math.max.apply(null, ys)];
    var xt = C.ticks(xd[0], xd[1], 5), yt = C.ticks(yd[0], yd[1], 4);
    if (!o.x) xd = [xt[0], xt[xt.length - 1]]; if (!o.y) yd = [yt[0], yt[yt.length - 1]];
    xt = xt.filter(function (v) { return v >= xd[0] - 1e-9 && v <= xd[1] + 1e-9; }); yt = yt.filter(function (v) { return v >= yd[0] - 1e-9 && v <= yd[1] + 1e-9; });
    var sx = scale(xd[0], xd[1], m.l, W - m.r), sy = scale(yd[0], yd[1], H - m.b, m.t);
    var s = axes({ W: W, H: H, m: m, sx: sx, sy: sy, xt: xt, yt: yt, xFmt: o.xFmt || C.fmtAxis, yFmt: o.yFmt || C.fmtAxis, xLabel: o.xLabel, yLabel: o.yLabel });
    if (o.diag) s += '<line class="ref" x1="' + sx(Math.max(xd[0], yd[0])) + '" y1="' + sy(Math.max(xd[0], yd[0])) + '" x2="' + sx(Math.min(xd[1], yd[1])) + '" y2="' + sy(Math.min(xd[1], yd[1])) + '"/>';
    var r = o.r || 3.2;
    o.pts.forEach(function (p) {
      if (p.x < xd[0] || p.x > xd[1] || p.y < yd[0] || p.y > yd[1]) return;
      var x = sx(p.x), y = sy(p.y);
      s += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + p.c + '" fill-opacity="0.72"' + (p.tip ? ' data-tip="' + esc(p.tip) + '"' : '') + '/>';
    });
    el.innerHTML = frame(W, H, s);
  };

  /* Histogram with 2px surface gaps: o.values, o.bins, o.x domain, o.color, o.refs [{x,label}] */
  C.hist = function (el, o) {
    var vals = o.values, nb = o.bins || 20;
    var xd = o.x || [Math.min.apply(null, vals), Math.max.apply(null, vals)];
    var w = (xd[1] - xd[0]) / nb, counts = new Array(nb).fill(0);
    vals.forEach(function (v) { var b = Math.floor((v - xd[0]) / w); if (b < 0) b = 0; if (b >= nb) b = nb - 1; counts[b]++; });
    var W = width(el), H = o.h || 200, m = { l: o.ml || 44, r: 12, t: o.yLabel ? 22 : 10, b: o.xLabel ? 38 : 24 };
    var yt = C.ticks(0, Math.max.apply(null, counts) * 1.1, 4), yd = [0, yt[yt.length - 1]];
    var xt = C.ticks(xd[0], xd[1], 6).filter(function (v) { return v >= xd[0] - 1e-9 && v <= xd[1] + 1e-9; });
    var sx = scale(xd[0], xd[1], m.l, W - m.r), sy = scale(yd[0], yd[1], H - m.b, m.t);
    var s = axes({ W: W, H: H, m: m, sx: sx, sy: sy, xt: xt, yt: yt, xFmt: o.xFmt || C.fmtAxis, yFmt: C.fmtAxis, xLabel: o.xLabel, yLabel: o.yLabel || 'Customers' });
    counts.forEach(function (c, i) {
      var x0 = sx(xd[0] + i * w) + 1, x1 = sx(xd[0] + (i + 1) * w) - 1, lo = xd[0] + i * w;
      var col = o.colorFn ? o.colorFn(lo + w / 2) : (o.color || 'var(--s1)');
      s += '<path d="' + vbarPath(x0, Math.max(1, x1 - x0), H - m.b, sy(c)) + '" fill="' + col + '"/>';
      s += '<rect class="hit" x="' + x0 + '" y="' + m.t + '" width="' + Math.max(1, x1 - x0) + '" height="' + (H - m.t - m.b) + '" data-tip="' + esc(esc((o.xFmt || C.fmtAxis)(lo)) + ' to ' + esc((o.xFmt || C.fmtAxis)(lo + w)) + ': <b>' + c + '</b>') + '"/>';
    });
    (o.refs || []).forEach(function (rf) {
      var x = sx(rf.x);
      s += '<line class="ref" x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
      if (rf.label) s += '<text class="tick strong" x="' + (x + 4) + '" y="' + (m.t + 10) + '">' + esc(rf.label) + '</text>';
    });
    el.innerHTML = frame(W, H, s);
  };

  /* Heatmap: o.rows, o.cols (labels), o.m[r][c] (null = blank), o.color(v), o.fmt, o.tip(r,c,v) */
  C.heat = function (el, o) {
    var W = width(el), lw = o.labelW || 150, n = o.cols.length, cw = Math.max(22, Math.floor((W - lw - 4) / n)), ch = o.cellH || 24;
    var top = o.colLabelH || 92, H = top + o.rows.length * (ch + 2) + 4, s = '';
    o.cols.forEach(function (c, j) {
      var x = lw + j * (cw + 2) + cw / 2;
      s += '<text class="tick" transform="translate(' + (x + 4) + ',' + (top - 6) + ') rotate(-50)" text-anchor="start">' + esc(c) + '</text>';
    });
    o.rows.forEach(function (rl, i) {
      var y = top + i * (ch + 2);
      s += '<text class="blabel" x="' + (lw - 8) + '" y="' + (y + ch / 2 + 4) + '" text-anchor="end">' + esc(rl) + '</text>';
      for (var j = 0; j < n; j++) {
        var v = o.m[i][j], x = lw + j * (cw + 2);
        if (v === null || v === undefined) { s += '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + ch + '" rx="3" class="blank"/>'; continue; }
        var fill = o.color(v), dark = o.isDark ? o.isDark(v) : false;
        s += '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + ch + '" rx="3" fill="' + fill + '" data-tip="' + esc(o.tip ? o.tip(i, j, v) : String(v)) + '"/>';
        if (cw >= 30) s += '<text class="cell' + (dark ? ' inv' : '') + '" x="' + (x + cw / 2) + '" y="' + (y + ch / 2 + 4) + '" text-anchor="middle" pointer-events="none">' + esc(o.fmt(v)) + '</text>';
      }
    });
    el.innerHTML = frame(Math.max(W, lw + n * (cw + 2)), H, s);
  };


  /* Horizontal waterfall (bridge): o.steps [{label, value, kind:'up'|'down'|'total'}], o.colors {up,down,total}, o.fmt */
  C.waterfall = function (el, o) {
    var W = width(el), rowH = o.rowH || 28, bh = Math.min(18, rowH - 8), lw = o.labelW || Math.min(210, Math.floor(W * 0.38)), vw = o.valueW || 86;
    var cum = 0, segs = [];
    o.steps.forEach(function (st) {
      var a, b;
      if (st.kind === 'total') { a = 0; b = st.value === undefined ? cum : st.value; cum = b; }
      else if (st.kind === 'up') { a = cum; b = cum + st.value; cum = b; }
      else { a = cum; b = cum - st.value; cum = b; }
      segs.push({ st: st, a: a, b: b });
    });
    var lo = Math.min(0, Math.min.apply(null, segs.map(function (g) { return Math.min(g.a, g.b); }))), hi = Math.max.apply(null, segs.map(function (g) { return Math.max(g.a, g.b); }));
    var H = o.steps.length * rowH + 24, sx = scale(lo, hi, lw, W - vw), s = '', fmt = o.fmt || C.fmtAxis;
    var xt = C.ticks(lo, hi, 4).filter(function (v) { return v >= lo - 1e-9 && v <= hi + 1e-9; });
    xt.forEach(function (v) { s += '<line class="grid" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="0" y2="' + (H - 20) + '"/><text class="tick" x="' + sx(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc((o.axisFmt || C.fmtAxis)(v)) + '</text>'; });
    s += '<line class="axis" x1="' + sx(0) + '" x2="' + sx(0) + '" y1="0" y2="' + (H - 20) + '"/>';
    segs.forEach(function (g, i) {
      var y = i * rowH + 4, x0 = sx(Math.min(g.a, g.b)), x1 = sx(Math.max(g.a, g.b)), colr = o.colors[g.st.kind];
      if (g.st.kind === 'total' && g.b < 0) colr = o.colors.neg || o.colors.down;
      s += '<text class="blabel' + (g.st.kind === 'total' ? ' strong' : '') + '" x="' + (lw - 8) + '" y="' + (y + bh / 2 + 4) + '" text-anchor="end">' + esc(g.st.label) + '</text>';
      s += '<rect x="' + x0 + '" y="' + y + '" width="' + Math.max(1.5, x1 - x0) + '" height="' + bh + '" rx="3" fill="' + colr + '"/>';
      if (i < segs.length - 1) { var nx = sx(g.b); s += '<line class="ref" x1="' + nx + '" x2="' + nx + '" y1="' + (y + bh) + '" y2="' + (y + rowH + 4) + '"/>'; }
      var sign = g.st.kind === 'up' ? '+' : g.st.kind === 'down' ? '−' : '';
      s += '<text class="bval' + (g.st.kind === 'total' ? ' strong' : '') + '" x="' + (x1 + 6) + '" y="' + (y + bh / 2 + 4) + '">' + sign + esc(fmt(Math.abs(g.st.kind === 'total' ? g.b : g.st.value))) + (g.st.kind === 'total' && g.b < 0 ? ' loss' : '') + '</text>';
      s += '<rect class="hit" x="0" y="' + (y - 4) + '" width="' + W + '" height="' + rowH + '" data-tip="' + esc((g.st.tip || esc(g.st.label)) + '<br><b>' + sign + esc(fmt(Math.abs(g.st.kind === 'total' ? g.b : g.st.value))) + '</b>') + '"/>';
    });
    el.innerHTML = frame(W, H, s);
  };

  /* Diverging horizontal bars around zero: o.items [{label,value,tip,sub}], o.pos, o.neg colours */
  C.barDiv = function (el, o) {
    var W = width(el), rowH = o.rowH || 28, bh = Math.min(16, rowH - 10), lw = o.labelW || Math.min(220, Math.floor(W * 0.4)), pad = 64;
    var vals = o.items.map(function (d) { return d.value; }), lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (o.domain) { lo = o.domain[0]; hi = o.domain[1]; }
    var H = o.items.length * rowH + 22, sx = scale(lo, hi, lw + (lo < 0 ? pad : 0), W - pad), s = '', fmt = o.fmt || C.fmtAxis;
    var xt = C.ticks(lo, hi, 4).filter(function (v) { return v >= lo - 1e-9 && v <= hi + 1e-9; });
    xt.forEach(function (v) { s += '<line class="grid" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="0" y2="' + (H - 18) + '"/><text class="tick" x="' + sx(v) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc((o.axisFmt || fmt)(v)) + '</text>'; });
    o.items.forEach(function (d, i) {
      var y = i * rowH + 5, x0 = sx(Math.min(0, d.value)), x1 = sx(Math.max(0, d.value)), neg = d.value < 0;
      s += '<text class="blabel" x="' + (lw - 8) + '" y="' + (y + bh / 2 + 4) + '" text-anchor="end">' + esc(d.label) + '</text>';
      var r = Math.min(4, bh / 2, Math.max(0, x1 - x0)), path;
      if (x1 - x0 < 0.5) path = '';
      else if (!neg) path = 'M' + x0 + ' ' + y + 'H' + (x1 - r) + 'Q' + x1 + ' ' + y + ' ' + x1 + ' ' + (y + r) + 'V' + (y + bh - r) + 'Q' + x1 + ' ' + (y + bh) + ' ' + (x1 - r) + ' ' + (y + bh) + 'H' + x0 + 'Z';
      else path = 'M' + x1 + ' ' + y + 'H' + (x0 + r) + 'Q' + x0 + ' ' + y + ' ' + x0 + ' ' + (y + r) + 'V' + (y + bh - r) + 'Q' + x0 + ' ' + (y + bh) + ' ' + (x0 + r) + ' ' + (y + bh) + 'H' + x1 + 'Z';
      s += '<path d="' + path + '" fill="' + (d.color || (neg ? o.neg : o.pos)) + '"/>';
      s += '<text class="bval" x="' + (neg ? x0 - 6 : x1 + 6) + '" y="' + (y + bh / 2 + 4) + '" text-anchor="' + (neg ? 'end' : 'start') + '">' + esc(fmt(d.value)) + '</text>';
      s += '<rect class="hit" x="0" y="' + (y - 5) + '" width="' + W + '" height="' + rowH + '" data-tip="' + esc(d.tip || (esc(d.label) + ': <b>' + esc(fmt(d.value)) + '</b>')) + '"/>';
    });
    s += '<line class="axis" x1="' + sx(0) + '" x2="' + sx(0) + '" y1="0" y2="' + (H - 18) + '"/>';
    el.innerHTML = frame(W, H, s);
  };

  C.spark = function (vals, color, w, h) {
    w = w || 120; h = h || 28;
    if (!vals.length) return '';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mx - mn < 1e-9) { mx = mn + 1; }
    var pts = vals.map(function (v, i) { return [2 + i * (w - 6) / Math.max(1, vals.length - 1), h - 3 - (v - mn) / (mx - mn) * (h - 6)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    var l = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><path d="' + d + 'L' + l[0].toFixed(1) + ' ' + h + 'L2 ' + h + 'Z" fill="' + color + '" opacity=".10"/><path d="' + d + '" fill="none" stroke="var(--muted)" stroke-width="1.5"/><circle cx="' + l[0].toFixed(1) + '" cy="' + l[1].toFixed(1) + '" r="3" fill="' + color + '"/></svg>';
  };

  /* One tooltip for the whole page */
  C.initTips = function () {
    var tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
    var cur = null;
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!t) { tip.style.opacity = 0; cur = null; return; }
      cur = t; tip.innerHTML = t.getAttribute('data-tip'); tip.style.opacity = 1;
    });
    document.addEventListener('mousemove', function (e) {
      if (!cur) return;
      var x = e.clientX + 14, y = e.clientY + 14, r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    });
    document.addEventListener('scroll', function () { tip.style.opacity = 0; cur = null; }, true);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = C; else root.Charts = C;
})(this);
