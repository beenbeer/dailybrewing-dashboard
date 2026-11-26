// 생활맥주 맥주통합운영시스템 · GitHub 현황판(사내 홈페이지 화면 복사본, 보기 전용). 2026-11-26
// - 자료 data.enc.json을 팀 비밀번호로 이 기기에서 풀어 쓴다(AES-256-GCM, PBKDF2-SHA256).
// - 홈·재고·양조 등은 홈페이지 템플릿으로 미리 그린 화면을 그대로 보여 준다.
// - 매출 분석·술이지는 홈페이지(web/sales_analysis.py·sooleasy_report.py·_sales_analysis.html·_sooleasy.html)와
//   같은 규칙·같은 화면 구조로 브라우저에서 그린다. 그래프는 홈페이지의 static/sales_analysis.js를 그대로 돌린다.
(function () {
  'use strict';
  var KEY_STORE = 'dbw-site-key-v1';
  var D = null, BLOB = null, CHART_CODE = null, ONLINE_CODE = null;
  var content = document.getElementById('content');
  var PATHS = ['home', 'stock', 'brew', 'receive', 'ship', 'sales', 'products', 'online', 'sooleasy', 'settlement', 'calendar'];
  var VARIANT_PARAM = { home: 'stock_at', stock: 'at' };

  // ---------------------------------------------------------------- 도구
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pyRound(x, n) {   // 파이썬 round(짝수 반올림)
    n = n || 0; var m = Math.pow(10, n), y = x * m, r = Math.round(y);
    if (Math.abs(Math.abs(y % 1) - 0.5) < 1e-9) r = 2 * Math.round(y / 2);
    return r / m;
  }
  function amount(x, places) {
    if (x == null) return '—';
    places = places || 0;
    var v = pyRound(Number(x), places);
    return v.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  }
  function qtyCell(v) { return amount(v, v === Math.trunc(v) ? 0 : 2); }
  function pct(v) { return v == null ? '—' : String(Number.isInteger(v) ? v.toFixed(1) : v); }
  function qs(obj) { var p = new URLSearchParams(); Object.keys(obj).forEach(function (k) { var v = obj[k]; if (v !== '' && v != null) p.append(k, v); }); return p.toString(); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function dateOf(s) { return new Date(s + 'T00:00:00Z'); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(dateOf(s)); }
  function addDays(s, n) { var d = dateOf(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function monthEnd(m) { return iso(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0))); }
  function weekStart(s) { var d = dateOf(s), wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return iso(d); }
  function monthsBack(asof, n) { var y = +asof.slice(0, 4), m = +asof.slice(5, 7) - (n - 1); while (m <= 0) { m += 12; y -= 1; } return y + '-' + String(m).padStart(2, '0') + '-01'; }
  function quickRanges(asof) {
    var y = +asof.slice(0, 4);
    return { this_month: [asof.slice(0, 8) + '01', asof], '3m': [monthsBack(asof, 3), asof], '6m': [monthsBack(asof, 6), asof],
      this_year: [y + '-01-01', asof], last_year: [(y - 1) + '-01-01', (y - 1) + '-12-31'] };
  }
  function periods(start, end, unit) {
    var out = [];
    if (start > end) return out;
    if (unit === 'month') { var cur = start.slice(0, 7) + '-01'; while (cur <= end) { var me = monthEnd(cur.slice(0, 7)); out.push([cur.slice(0, 7), cur < start ? start : cur, me > end ? end : me]); cur = addDays(me, 1); } }
    else if (unit === 'week') { var w = weekStart(start); while (w <= end) { var we = addDays(w, 6); out.push([w, w < start ? start : w, we > end ? end : we]); w = addDays(w, 7); } }
    else { var d = start; while (d <= end) { out.push([d, d, d]); d = addDays(d, 1); } }
    return out;
  }
  function periodKey(day, unit) { return unit === 'month' ? day.slice(0, 7) : unit === 'week' ? weekStart(day) : day; }
  function uniqSorted(arr) { return Array.from(new Set(arr)).sort(); }
  function b64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function toB64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function store(get, value) {
    try { if (get) return localStorage.getItem(KEY_STORE); if (value == null) localStorage.removeItem(KEY_STORE); else localStorage.setItem(KEY_STORE, value); } catch (e) { return null; }
    return null;
  }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function empty(msg) { return '<div class="erp-empty">' + esc(msg) + '</div>'; }
  function pager(p) {
    if (!p.total) return '';
    return '<nav class="erp-pager" aria-label="페이지 이동"><span>' + p.total + '건 중 ' + p.first + '–' + p.last + '건</span>' +
      (p.pages > 1 ? '<div>' + (p.previous ? '<a href="' + esc(p.previous) + '">이전</a>' : '') + '<b>' + p.current + ' / ' + p.pages + '</b>' + (p.next ? '<a href="' + esc(p.next) + '">다음</a>' : '') + '</div>' : '') + '</nav>';
  }

  // ---------------------------------------------------------------- 암호 풀기
  async function deriveKey(password, salt, iter) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function gunzip(bytes) {
    if (!('DecompressionStream' in window)) { var e = new Error('이 브라우저는 자료 압축 풀기를 지원하지 않습니다. 최신 크롬·사파리·엣지로 열어 주세요.'); throw e; }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function openWith(key, blob) {
    var raw;
    try { raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.data))); }
    catch (e) { var w = new Error('wrong'); w.wrong = true; throw w; }
    if (blob.gzip) raw = await gunzip(raw);
    return JSON.parse(new TextDecoder().decode(raw));
  }
  async function loadBlob() {
    if (BLOB) return BLOB;
    var r = await fetch('data.enc.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('자료 파일을 받지 못했습니다(' + r.status + ')');
    BLOB = await r.json(); return BLOB;
  }
  async function tryStored() {
    var s = store(true); if (!s) return false;
    try {
      var saved = JSON.parse(s), blob = await loadBlob();
      if (saved.salt !== blob.salt) { store(false, null); return false; }
      var key = await crypto.subtle.importKey('raw', b64(saved.key), { name: 'AES-GCM' }, true, ['decrypt']);
      D = await openWith(key, blob); return true;
    } catch (e) { store(false, null); return false; }
  }
  document.getElementById('gate-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('gate-btn'), msg = document.getElementById('gate-msg');
    if (!window.crypto || !crypto.subtle) { msg.textContent = '이 브라우저에서는 열 수 없습니다(https 주소의 최신 크롬·사파리·엣지로 열어 주세요).'; return; }
    btn.disabled = true; msg.textContent = '여는 중…';
    try {
      var blob = await loadBlob();
      var key = await deriveKey(document.getElementById('pw').value, b64(blob.salt), blob.iter);
      try { D = await openWith(key, blob); } catch (e) { if (!e || !e.wrong) throw e; msg.textContent = '비밀번호가 맞지 않습니다.'; btn.disabled = false; return; }
      if (document.getElementById('remember').checked) store(false, JSON.stringify({ salt: blob.salt, key: toB64(await crypto.subtle.exportKey('raw', key)) }));
      document.getElementById('pw').value = '';
      start();
    } catch (e) { msg.textContent = '자료를 읽지 못했습니다(' + ((e && e.message) || '알 수 없는 오류') + ').'; btn.disabled = false; }
  });
  document.getElementById('lock').addEventListener('click', function () { store(false, null); location.hash = ''; location.reload(); });

  // ---------------------------------------------------------------- 주소·화면 바꾸기
  function parseHash() {
    var h = location.hash.slice(1) || 'home';
    var anchor = '', i = h.indexOf('#');
    if (i >= 0) { anchor = h.slice(i + 1); h = h.slice(0, i); }
    var q = '', j = h.indexOf('?');
    if (j >= 0) { q = h.slice(j + 1); h = h.slice(0, j); }
    return { path: h || 'home', params: new URLSearchParams(q), anchor: anchor };
  }
  function start() {
    document.getElementById('lock').hidden = false;
    document.getElementById('stamp').textContent = '자료 ' + (D.asof || '') + ' · ' + (D.generated || '').replace('T', ' ') + ' 만듦';
    window.addEventListener('hashchange', route);
    route();
  }
  function destroyCharts() {
    if (window.Chart && Chart.instances) Object.keys(Chart.instances).forEach(function (k) { try { Chart.instances[k].destroy(); } catch (e) { /* 이미 지워짐 */ } });
  }
  async function runChartCode() {
    if (!window.Chart) return;
    if (CHART_CODE === null) { try { CHART_CODE = await (await fetch('static/sales_analysis.js', { cache: 'no-store' })).text(); } catch (e) { CHART_CODE = ''; } }
    if (CHART_CODE) new Function(CHART_CODE)();
  }
  async function runOnlineCode() {
    if (!window.Chart) return;
    if (ONLINE_CODE === null) { try { ONLINE_CODE = await (await fetch('static/online.js', { cache: 'no-store' })).text(); } catch (e) { ONLINE_CODE = ''; } }
    if (ONLINE_CODE) new Function('setInterval', ONLINE_CODE)(function () { return 0; });   // 30초마다 다시 읽기는 끔(정적 화면)
  }
  function setNav(path) {
    document.querySelectorAll('.side .nav').forEach(function (a) {
      var on = a.getAttribute('href') === '#' + path;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function scrollToAnchor(anchor) {
    var el = anchor && document.getElementById(anchor);
    if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
  }
  function route() {
    if (!D) return;
    var r = parseHash();
    if (PATHS.indexOf(r.path) < 0) {   // 화면 안 이동(#lots 같은 칸 이름)
      var el = document.getElementById(r.path);
      if (el) el.scrollIntoView(); else toast('이 화면은 사내 홈페이지에서 볼 수 있습니다.');
      return;
    }
    destroyCharts();
    setNav(r.path);
    if (r.path === 'sales') { content.className = ''; content.innerHTML = salesPage(r.params); runChartCode(); scrollToAnchor(r.anchor); return; }
    if (r.path === 'sooleasy') { content.className = ''; content.innerHTML = soolPage(r.params); runChartCode(); scrollToAnchor(r.anchor); return; }
    var vp = VARIANT_PARAM[r.path], key = r.path, extra = false;
    r.params.forEach(function (v, k) { if (k !== vp) extra = true; });
    if (vp && r.params.get(vp) && r.params.get(vp) !== 'total') key += '?' + vp + '=' + r.params.get(vp);
    var html = D.pages[key] || D.pages[r.path];
    if (!html) { toast('이 화면은 사내 홈페이지에서 볼 수 있습니다.'); return; }
    content.className = 'static-page';
    content.innerHTML = html;
    if (r.path === 'online') runOnlineCode();
    if (extra) toast('조건을 바꿔 보는 기능은 사내 홈페이지에서 쓸 수 있습니다. 기본 화면을 보여 줍니다.');
    scrollToAnchor(r.anchor);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || !content.contains(a) && !a.closest('.side')) return;
    var href = a.getAttribute('href');
    if (/^(https?:|mailto:)/.test(href)) return;
    if (href.charAt(0) === '#') {
      var p = href.slice(1).split(/[?#]/)[0];
      if (PATHS.indexOf(p) >= 0 || !p) return;   // 현황판 화면 이동은 주소로
      var el = document.getElementById(p);
      e.preventDefault();
      if (el) el.scrollIntoView({ behavior: 'smooth' }); else toast('이 화면은 사내 홈페이지에서 볼 수 있습니다.');
      return;
    }
    e.preventDefault();
    toast('이 기능은 사내 홈페이지에서 쓸 수 있습니다.');
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'gate-form') return;
    e.preventDefault();
    var path = f.getAttribute('data-path');
    if (!path) { toast('입력·수정은 사내 홈페이지에서 할 수 있습니다.'); return; }
    var data = new FormData(f), obj = {};
    data.forEach(function (v, k) { obj[k] = v; });
    location.hash = path + '?' + qs(obj) + (f.getAttribute('data-anchor') ? '#' + f.getAttribute('data-anchor') : '');
  });

  // ---------------------------------------------------------------- 매출 분석 (web/sales_analysis.py와 같은 규칙)
  var DIMS = { month: '월별', customer: '매출처별', product: '품목별' };
  var DIM_HEAD = { month: '월', customer: '매출처', product: '품목' };
  var UNITS = { month: '월간', week: '주간', day: '일간' };
  var RANGES = [['this_month', '이번 달'], ['3m', '최근 3개월'], ['6m', '최근 6개월'], ['this_year', '올해'], ['last_year', '작년']];
  var PACKS = ['keg', 'can500', 'can355', 'oneway'];
  var SROWS = null;
  function salesRows() {
    if (SROWS) return SROWS;
    var d = D.sales.dicts;
    SROWS = D.sales.rows.map(function (r) { return { day: r[0], channel: d.channels[r[1]], customer: d.customers[r[2]], product: d.products[r[3]], pack: d.packs[r[4]], qty: r[5], amount: r[6] }; });
    return SROWS;
  }
  function value(row, dim) { return dim === 'month' ? row.day.slice(0, 7) : (row[dim] || ''); }
  function label(dim, v) { return v || (dim === 'customer' ? '매출처 미확인' : '품목 미확인'); }
  function parseSales(params, asof) {
    var ranges = quickRanges(asof), error = '', rk = params.get('range') || '', start, end;
    if (ranges[rk] && !(params.get('from') || params.get('to'))) { start = ranges[rk][0]; end = ranges[rk][1]; }
    else {
      var ds = ranges.this_year[0], de = ranges.this_year[1];
      var f = params.get('from'), t = params.get('to');
      start = f ? f : ds; end = t ? t : de;
      if ((f && !validDate(f)) || (t && !validDate(t)) || end < start) { start = ds; end = de; error = '시작일과 종료일을 확인해 주세요. 올해 기간을 표시합니다.'; }
      rk = Object.keys(ranges).filter(function (k) { return ranges[k][0] === start && ranges[k][1] === end; })[0] || '';
    }
    var by = [];
    String(params.get('by') || 'month').split(',').forEach(function (d) { if (DIMS[d] && by.indexOf(d) < 0) by.push(d); });
    if (!by.length) by = ['month'];
    var unit = params.get('unit') || '';
    if (!UNITS[unit]) { var span = (dateOf(end) - dateOf(start)) / 864e5; unit = span > 62 ? 'month' : span > 31 ? 'week' : 'day'; }
    return { start: start, end: end, error: error, range: rk, by: by, unit: unit, channel: params.get('channel') || '', customer: params.get('customer') || '', product: params.get('product') || '' };
  }
  function salesAnalysis(params) {
    var entries = salesRows(), asof = D.asof, f = parseSales(params, asof);
    var query = {}; [['from', f.start], ['to', f.end], ['channel', f.channel], ['customer', f.customer], ['product', f.product], ['by', f.by.join(',')], ['unit', f.unit]].forEach(function (x) { if (x[1]) query[x[0]] = x[1]; });
    function link(changes, anchor) { var m = Object.assign({}, query, changes); if (anchor === undefined) anchor = 'sales-table'; return '#sales?' + qs(m) + (anchor ? '#' + anchor : ''); }
    var channels = uniqSorted(entries.map(function (r) { return r.channel; }));
    var customers = uniqSorted(entries.filter(function (r) { return r.customer && (!f.channel || r.channel === f.channel); }).map(function (r) { return r.customer; }));
    var products = uniqSorted(entries.filter(function (r) { return r.product; }).map(function (r) { return r.product; }));
    var rows = entries.filter(function (r) { return f.start <= r.day && r.day <= f.end && (!f.channel || r.channel === f.channel) && (!f.customer || r.customer === f.customer) && (!f.product || r.product === f.product); });
    var dataFrom = entries.length ? entries.reduce(function (m, r) { return r.day < m ? r.day : m; }, entries[0].day) : '';
    var total = 0, qty = {}, byCh = {}, monthAmt = {};
    rows.forEach(function (r) { total += r.amount; qty[r.pack] = (qty[r.pack] || 0) + r.qty; byCh[r.channel] = (byCh[r.channel] || 0) + r.amount; monthAmt[r.day.slice(0, 7)] = (monthAmt[r.day.slice(0, 7)] || 0) + r.amount; });
    var covered = f.end < asof ? f.end : asof;
    var monthsIn = periods(f.start, f.end, 'month').map(function (p) { return p[0]; });
    var full = monthsIn.filter(function (m) { return m + '-01' >= f.start && monthEnd(m) <= covered && m + '-01' >= dataFrom.slice(0, 7) + '-01'; });
    var partial = !full.length;
    if (partial) { full = monthsIn.filter(function (m) { return m + '-01' <= covered; }); if (!full.length) full = monthsIn; }
    var average = full.length ? pyRound(full.reduce(function (s, m) { return s + (monthAmt[m] || 0); }, 0) / full.length) : 0;
    var chOrder = Object.keys(byCh).sort(function (a, b) { return byCh[b] - byCh[a]; });
    var channelRows = chOrder.map(function (ch) { return { channel: ch, amount: pyRound(byCh[ch]), share: total ? pyRound(100 * byCh[ch] / total, 1) : null, href: link({ channel: ch }, '') }; });
    var summary = { amount: pyRound(total), qty: {}, count: rows.length, average: average, average_months: full.length, average_partial: partial,
      average_range: full.length ? full[0] + ' ~ ' + full[full.length - 1] : '',
      customers: new Set(rows.filter(function (r) { return r.customer; }).map(function (r) { return r.customer; })).size,
      products: new Set(rows.filter(function (r) { return r.product; }).map(function (r) { return r.product; })).size, channels: channelRows };
    PACKS.forEach(function (p) { summary.qty[p] = pyRound(qty[p] || 0); });
    // 판매 추이
    var trendStart = dataFrom && f.unit === 'month' ? (f.start > dataFrom.slice(0, 7) + '-01' ? f.start : dataFrom.slice(0, 7) + '-01') : (dataFrom && dataFrom > f.start ? dataFrom : f.start);
    if (trendStart > f.end) trendStart = f.end;
    var ps = periods(trendStart, f.end, f.unit), keys = ps.map(function (p) { return p[0]; }), index = {};
    keys.forEach(function (k, i) { index[k] = i; });
    var series = {}, packSeries = {};
    chOrder.forEach(function (c) { series[c] = keys.map(function () { return 0; }); });
    PACKS.forEach(function (p) { packSeries[p] = keys.map(function () { return 0; }); });
    rows.forEach(function (r) { var i = index[periodKey(r.day, f.unit)]; if (i == null) return; series[r.channel][i] += r.amount; if (packSeries[r.pack]) packSeries[r.pack][i] += r.qty; });
    var drill = { month: 'week', week: 'day', day: 'day' }[f.unit];
    var unitLinks = {}; Object.keys(UNITS).forEach(function (u) { unitLinks[u] = link({ unit: u }, 'sales-trend'); });
    var trend = { unit: f.unit, labels: keys, ranges: ps.map(function (p) { return { start: p[1], end: p[2], href: link({ from: p[1], to: p[2], unit: drill }, 'sales-trend') }; }),
      channels: chOrder.map(function (c) { return { channel: c, values: series[c].map(function (v) { return pyRound(v); }) }; }),
      packs: {}, totals: keys.map(function (k, i) { return pyRound(chOrder.reduce(function (s, c) { return s + series[c][i]; }, 0)); }), unit_links: unitLinks };
    PACKS.forEach(function (p) { trend.packs[p] = packSeries[p].map(function (v) { return pyRound(v, 2); }); });
    // 조합 집계표
    var by = f.by, groups = {}, order = [];
    rows.forEach(function (r) {
      var key = by.map(function (d) { return value(r, d); }), k = JSON.stringify(key), g = groups[k];
      if (!g) { g = groups[k] = { key: key, amount: 0, qty: {}, months: {}, monthly: {}, channels: {} }; order.push(k); }
      g.amount += r.amount; g.qty[r.pack] = (g.qty[r.pack] || 0) + r.qty; g.months[r.day.slice(0, 7)] = 1; g.monthly[r.day.slice(0, 7)] = (g.monthly[r.day.slice(0, 7)] || 0) + r.amount; g.channels[r.channel] = 1;
    });
    var prefix = {};
    order.forEach(function (k) { var g = groups[k]; for (var n = 1; n <= by.length; n++) { var pk = JSON.stringify(g.key.slice(0, n)); prefix[pk] = (prefix[pk] || 0) + g.amount; } });
    var list = order.map(function (k) { return groups[k]; });
    list.sort(function (a, b) {
      for (var n = 0; n < by.length; n++) {
        if (by[n] === 'month') { var am = -parseInt(a.key[n].replace('-', '') || '0', 10), bm = -parseInt(b.key[n].replace('-', '') || '0', 10); if (am !== bm) return am - bm; continue; }
        var pa = -prefix[JSON.stringify(a.key.slice(0, n + 1))], pb = -prefix[JSON.stringify(b.key.slice(0, n + 1))];
        if (pa !== pb) return pa - pb;
        if (a.key[n] !== b.key[n]) return a.key[n] < b.key[n] ? -1 : 1;
      }
      return 0;
    });
    function cellLink(dim, v) {
      if (!v) return '';
      if (dim === 'month') { var s = v + '-01' > f.start ? v + '-01' : f.start, e = monthEnd(v) < f.end ? monthEnd(v) : f.end; return link({ from: s, to: e }); }
      var c = {}; c[dim] = v; return link(c);
    }
    var nFull = full.length, showAvg = by.indexOf('month') < 0 && nFull > 0, table = [], prev = null;
    var children = {}; list.forEach(function (g) { (children[g.key[0]] = children[g.key[0]] || []).push(g); });
    list.forEach(function (g, i) {
      var cells = by.map(function (dim, n) {
        var same = prev !== null && JSON.stringify(prev.slice(0, n + 1)) === JSON.stringify(g.key.slice(0, n + 1));
        return { dim: dim, value: g.key[n], label: label(dim, g.key[n]), href: cellLink(dim, g.key[n]), repeat: same };
      });
      var q = {}; PACKS.forEach(function (p) { q[p] = g.qty[p] || 0; });
      table.push({ kind: 'row', cells: cells, amount: pyRound(g.amount), share: total ? pyRound(100 * g.amount / total, 1) : null, qty: q,
        channels: Object.keys(g.channels).sort(), active: Object.keys(g.months).length,
        average: showAvg ? pyRound(full.reduce(function (s, m) { return s + (g.monthly[m] || 0); }, 0) / nFull) : null });
      prev = g.key;
      var last = i + 1 === list.length || list[i + 1].key[0] !== g.key[0];
      if (by.length > 1 && last) {
        var sub = children[g.key[0]], sq = {};
        PACKS.forEach(function (p) { sq[p] = sub.reduce(function (s, x) { return s + (x.qty[p] || 0); }, 0); });
        var pa = prefix[JSON.stringify([g.key[0]])];
        table.push({ kind: 'sub', cells: [{ dim: by[0], label: label(by[0], g.key[0]) + ' 소계', href: '', repeat: false }], amount: pyRound(pa), share: total ? pyRound(100 * pa / total, 1) : null, qty: sq, count: sub.length });
      }
    });
    var current = parseInt(params.get('page') || '1', 10); if (isNaN(current)) current = 1;
    var size = 50, pages = Math.max(1, Math.ceil(table.length / size)); current = Math.min(Math.max(current, 1), pages);
    var first = (current - 1) * size, lastI = Math.min(first + size, table.length);
    function pageLink(n) { return '#sales?' + qs(Object.assign({}, query, { page: n })) + '#sales-table'; }
    var page = { records: table.slice(first, lastI), first: lastI ? first + 1 : 0, last: lastI, total: table.length, current: current, pages: pages,
      previous: current > 1 ? pageLink(current - 1) : '', next: current < pages ? pageLink(current + 1) : '' };
    var topRow = Math.max.apply(null, page.records.filter(function (r) { return r.kind === 'row'; }).map(function (r) { return Math.abs(r.amount); }).concat([0])) || 1;
    page.records.forEach(function (r) { r.bar = pyRound(100 * Math.abs(r.amount) / topRow, 1); });
    var topDim = by.filter(function (d) { return d === 'customer' || d === 'product'; })[0] || (!f.customer ? 'customer' : 'product');
    var ta = {}; rows.forEach(function (r) { var k = value(r, topDim); ta[k] = (ta[k] || 0) + r.amount; });
    var top = Object.keys(ta).sort(function (a, b) { return ta[b] - ta[a]; }).slice(0, 15).filter(function (k) { return ta[k]; })
      .map(function (k) { var c = {}; c[topDim] = k; return { name: label(topDim, k), amount: pyRound(ta[k]), share: total ? pyRound(100 * ta[k] / total, 1) : null, href: k ? link(c) : '' }; });
    var selected = Object.keys(DIMS).map(function (d) {
      var o = by.indexOf(d) + 1, nb = o ? by.filter(function (x) { return x !== d; }) : by.concat([d]);
      return { key: d, label: DIMS[d], order: o, href: (o && by.length === 1) ? '' : link({ by: nb.join(','), page: '' }) };
    });
    var ranges = RANGES.map(function (x) { return { key: x[0], label: x[1], active: x[0] === f.range, href: '#sales?' + qs({ range: x[0], channel: f.channel, customer: f.customer, product: f.product, by: by.join(',') }) }; });
    var filters = [['channel', '채널'], ['customer', '매출처'], ['product', '품목']].filter(function (x) { return f[x[0]]; })
      .map(function (x) { var c = { page: '' }; c[x[0]] = ''; return { name: x[0], label: x[1], value: f[x[0]], clear: link(c, '') }; });
    var info = f.product && D.catalog ? D.catalog[f.product] : null;
    return { has: rows.length > 0, start: f.start, end: f.end, error: f.error, asof: asof, data_from: dataFrom, channel: f.channel, customer: f.customer, product: f.product,
      by: by, by_labels: by.map(function (d) { return DIMS[d]; }), heads: by.map(function (d) { return DIM_HEAD[d]; }), unit: f.unit, range: f.range,
      channels: channels, customers: customers, products: products, ranges: ranges, selected_by: selected, filters: filters, summary: summary, trend: trend,
      trend_trimmed: trendStart > f.start, table: page, show_average: showAvg, top: { dim: topDim, label: DIM_HEAD[topDim], rows: top },
      product_info: info ? { name: f.product, style: info.style, abv: info.abv, description: info.description } : null };
  }
  function opt(value, selected, text) { return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(text == null ? value : text) + '</option>'; }
  function salesPage(params) {
    var a = salesAnalysis(params), s = a.summary, P = D.packs, used = PACKS.filter(function (c) { return s.qty[c]; }), h = [];
    h.push('<div class="erp"><header class="erp-title"><div><h1>매출 분석</h1></div>' + (D.saved_label ? '<span class="erp-stamp">이카운트 자료 저장 ' + esc(D.saved_label) + ' KST</span>' : '') + '</header>');
    if (a.error) h.push('<div class="erp-message error" role="alert">' + esc(a.error) + '</div>');
    h.push('<section class="erp-panel sa-filters" aria-label="매출 분석 조회 조건"><div class="erp-section"><div><h2>매출 분석</h2><p>이카운트 순매출 · 공급가액(VAT 별도) · 반품 차감' + (a.data_from ? ' · 자료 ' + esc(a.data_from) + ' ~ ' + esc(a.asof) : '') + '</p></div></div>');
    h.push('<form class="erp-filter" data-path="sales" data-anchor="sales-table"><input type="hidden" name="by" value="' + esc(a.by.join(',')) + '">' +
      '<label>시작일<input type="date" required name="from" value="' + esc(a.start) + '"></label><label>종료일<input type="date" required name="to" value="' + esc(a.end) + '"></label>' +
      '<label>채널<select name="channel"><option value="">전체 채널</option>' + a.channels.map(function (c) { return opt(c, a.channel); }).join('') + '</select></label>' +
      '<label>매출처<select name="customer"><option value="">전체 매출처</option>' + (a.customer && a.customers.indexOf(a.customer) < 0 ? '<option selected>' + esc(a.customer) + '</option>' : '') + a.customers.map(function (c) { return opt(c, a.customer); }).join('') + '</select></label>' +
      '<label>품목<select name="product"><option value="">전체 품목</option>' + a.products.map(function (c) { return opt(c, a.product); }).join('') + '</select></label>' +
      '<button type="submit" class="erp-button primary">조회</button></form>');
    h.push('<div class="sa-row"><span class="sa-label" id="sa-range-label">빠른 기간</span><nav class="sa-chips" aria-labelledby="sa-range-label">' + a.ranges.map(function (r) { return '<a class="erp-chip' + (r.active ? ' active' : '') + '" href="' + esc(r.href) + '"' + (r.active ? ' aria-current="true"' : '') + '>' + esc(r.label) + '</a>'; }).join('') + '</nav></div>');
    h.push('<div class="sa-row"><span class="sa-label" id="sa-by-label">보기 기준</span><nav class="sa-chips" aria-labelledby="sa-by-label">' + a.selected_by.map(function (d) {
      var ord = d.order ? '<b class="sa-order" aria-label="' + d.order + '순위">' + d.order + '</b>' : '';
      return d.href ? '<a class="erp-chip' + (d.order ? ' active' : '') + '" href="' + esc(d.href) + '" aria-pressed="' + (d.order ? 'true' : 'false') + '">' + ord + esc(d.label) + '</a>'
        : '<span class="erp-chip active" aria-disabled="true">' + ord + esc(d.label) + '</span>';
    }).join('') + '</nav><small class="sa-hint">누른 순서대로 묶습니다. 다시 누르면 뺍니다.</small></div>');
    if (a.filters.length) h.push('<div class="sa-row"><span class="sa-label">선택 조건</span><div class="sa-chips">' + a.filters.map(function (x) { return '<a class="sa-tag" href="' + esc(x.clear) + '">' + esc(x.label) + ' · ' + esc(x.value) + ' <span aria-hidden="true">×</span><span class="erp-sr">조건 빼기</span></a>'; }).join('') + '</div></div>');
    h.push('</section>');
    if (!a.has) { h.push(empty('선택한 조건에 표시할 유상 판매가 없습니다.' + (a.data_from && a.start < a.data_from ? ' 판매 자료는 ' + a.data_from + '부터 있습니다.' : ''))); h.push('</div>'); return h.join(''); }
    h.push('<div class="erp-metrics sa-metrics"><section><span>순매출</span><strong>' + amount(s.amount) + '<small>원</small></strong><span>' + esc(a.start) + ' ~ ' + esc(a.end) + '</span></section>' +
      '<section><span>월평균 매출</span><strong>' + amount(s.average) + '<small>원</small></strong><span>' + s.average_months + '개월 기준' + (s.average_range ? ' · ' + esc(s.average_range) : '') + (s.average_partial ? ' · <b>부분월 포함</b>' : '') + '</span></section>' +
      used.map(function (c) { return '<section><span>' + esc(P[c]) + '</span><strong>' + amount(s.qty[c]) + '<small>' + (c.indexOf('can') === 0 ? '캔' : '개') + '</small></strong></section>'; }).join('') +
      '<section><span>거래한 매출처 · 품목</span><strong>' + s.customers + '<small>곳</small> · ' + s.products + '<small>종</small></strong></section></div>');
    if (s.channels.length > 1) {
      h.push('<section class="erp-panel sa-channels" aria-label="채널별 순매출 비중"><div class="sa-share" role="img" aria-label="채널 비중 ' + s.channels.map(function (c) { return esc(c.channel) + ' ' + pct(c.share) + '%'; }).join(', ') + '">' +
        s.channels.filter(function (c) { return c.share && c.share > 0; }).map(function (c) { return '<i data-channel="' + esc(c.channel) + '" style="--w:' + c.share + '%" title="' + esc(c.channel) + ' ' + pct(c.share) + '%"></i>'; }).join('') + '</div>' +
        '<ul class="sa-share-list">' + s.channels.map(function (c) { return '<li><a href="' + esc(c.href) + '"><i data-channel="' + esc(c.channel) + '" aria-hidden="true"></i>' + esc(c.channel) + '</a><b>' + amount(c.amount) + '원</b><span>' + pct(c.share) + '%</span></li>'; }).join('') + '</ul></section>');
    }
    var t = a.trend;
    h.push('<section class="erp-panel" id="sales-trend"><div class="erp-section"><div><h2>판매 추이</h2><p>' + UNITS[a.unit] + ' · 채널별 누적 · 막대를 누르면 그 기간으로 좁혀서 봅니다.' + (a.trend_trimmed ? ' 판매 자료가 있는 ' + esc(a.data_from) + '부터 그렸습니다.' : '') + '</p></div>' +
      '<nav class="erp-subnav" aria-label="추이 단위">' + Object.keys(UNITS).map(function (u) { return '<a href="' + esc(t.unit_links[u]) + '"' + (u === a.unit ? ' aria-current="page"' : '') + '>' + UNITS[u] + '</a>'; }).join('') + '</nav></div>');
    h.push('<div class="sa-chips" role="group" aria-label="추이 기준"><button type="button" class="erp-chip active" data-trend-metric="amount" aria-pressed="true">순매출</button>' + used.map(function (c) { return '<button type="button" class="erp-chip" data-trend-metric="' + c + '" aria-pressed="false">' + esc(P[c]) + ' 수량</button>'; }).join('') + '</div>');
    h.push('<div class="erp-chart-legend" data-trend-legend></div><div class="erp-chart-box"><canvas id="chart-trend" role="img" aria-label="' + UNITS[a.unit] + ' 판매 추이 세로 막대그래프. 숫자는 아래 \'추이 표 보기\'에 있습니다">' + t.labels.map(function (l, i) { return esc(l) + ' ' + amount(t.totals[i]) + '원. '; }).join('') + '</canvas></div>');
    h.push('<details class="erp-details"><summary>추이 표 보기</summary><div class="erp-table-wrap erp-data-scroll" tabindex="0" aria-label="기간별 판매 추이 표"><table class="erp-table"><thead><tr><th class="erp-fixed-col" scope="col">기간</th>' +
      t.channels.map(function (c) { return '<th class="erp-num" scope="col">' + esc(c.channel) + ' (원)</th>'; }).join('') + '<th class="erp-num" scope="col">합계 (원)</th>' + used.map(function (c) { return '<th class="erp-num" scope="col">' + esc(P[c]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.labels.map(function (l, i) { return i; }).reverse().map(function (i) {
        return '<tr><th class="erp-fixed-col" scope="row"><a class="erp-link" href="' + esc(t.ranges[i].href) + '">' + esc(t.labels[i]) + '</a></th>' + t.channels.map(function (c) { return '<td class="erp-num">' + amount(c.values[i]) + '</td>'; }).join('') +
          '<td class="erp-num"><b>' + amount(t.totals[i]) + '</b></td>' + used.map(function (c) { return '<td class="erp-num">' + qtyCell(t.packs[c][i]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></details></section>');
    h.push('<section class="erp-panel" id="sales-table"><div class="erp-section"><div><h2>' + esc(a.by_labels.join(' → ')) + ' 매출</h2><p>' + esc(a.start) + ' ~ ' + esc(a.end) + a.filters.map(function (x) { return ' · ' + esc(x.value); }).join('') + ' · 이름을 누르면 그 조건으로 좁힙니다.' + (a.show_average ? ' 월평균은 ' + s.average_months + '개월(' + esc(s.average_range) + ') 기준입니다.' : '') + '</p></div></div>');
    var pi = a.product_info;
    if (pi && (pi.style || pi.description)) h.push('<p class="sa-product">' + esc(pi.name) + (pi.style ? ' · ' + esc(pi.style) : '') + (pi.abv ? ' · ABV ' + esc(pi.abv) + '%' : '') + (pi.description ? '<small>' + esc(pi.description) + '</small>' : '') + '</p>');
    if (a.top.rows.length > 1 && (a.by.indexOf('customer') >= 0 || a.by.indexOf('product') >= 0)) {
      h.push('<div class="erp-chart-card sa-top"><div class="erp-chart-head"><h3>' + esc(a.top.label) + '별 순매출 상위 ' + a.top.rows.length + '</h3><span class="erp-note">막대를 누르면 그 ' + esc(a.top.label) + '만 봅니다</span></div>' +
        '<div class="erp-chart-box" style="height: ' + (a.top.rows.length * 30 + 60) + 'px"><canvas id="chart-top" role="img" aria-label="' + esc(a.top.label) + '별 순매출 상위 가로 막대그래프">' + a.top.rows.map(function (r) { return esc(r.name) + ' ' + amount(r.amount) + '원. '; }).join('') + '</canvas></div></div>');
    }
    h.push('<div class="sales-table-wrap" tabindex="0" role="region" aria-label="' + esc(a.by_labels.join(' → ')) + ' 집계표"><table class="sales-table sa-table"><thead><tr>' + a.heads.map(function (x) { return '<th scope="col">' + esc(x) + '</th>'; }).join('') +
      '<th scope="col" class="sales-money">순매출 <small>(원)</small></th><th scope="col" class="sales-num">비중</th>' + (a.show_average ? '<th scope="col" class="sales-num">월평균 <small>(원)</small></th><th scope="col" class="sales-num">거래한 달</th>' : '') +
      used.map(function (c) { return '<th scope="col" class="sales-num">' + esc(P[c]) + '</th>'; }).join('') + '</tr></thead><tbody>');
    a.table.records.forEach(function (r, ri) {
      if (r.kind === 'sub') {
        h.push('<tr class="sa-sub"><th scope="row" colspan="' + a.by.length + '">' + esc(r.cells[0].label) + '<small>' + r.count + '줄</small></th><td class="sales-money"><strong>' + amount(r.amount) + '</strong></td><td class="sales-num">' + pct(r.share) + '%</td>' +
          (a.show_average ? '<td></td><td></td>' : '') + used.map(function (c) { return '<td class="sales-num">' + qtyCell(r.qty[c]) + '</td>'; }).join('') + '</tr>');
        return;
      }
      var firstRow = ri === 0;
      h.push('<tr>' + r.cells.map(function (c) {
        var show = !c.repeat || firstRow;
        return '<th scope="row"' + (c.repeat && !firstRow ? ' class="sa-repeat"' : '') + '>' + (show ? (c.href ? '<a href="' + esc(c.href) + '">' + esc(c.label) + '</a>' : esc(c.label)) + (c.dim === 'customer' && r.channels.length ? '<small>' + esc(r.channels.join(' · ')) + '</small>' : '') : '<span class="erp-sr">' + esc(c.label) + '</span>') + '</th>';
      }).join('') +
        '<td class="sales-money' + (r.amount < 0 ? ' negative' : '') + '"><strong>' + amount(r.amount) + '</strong><span class="sales-bar" aria-hidden="true"><i style="--bar:' + r.bar + '%"></i></span></td><td class="sales-num">' + pct(r.share) + '%</td>' +
        (a.show_average ? '<td class="sales-num">' + amount(r.average) + '</td><td class="sales-num">' + r.active + '개월</td>' : '') +
        used.map(function (c) { return '<td class="sales-num' + (r.qty[c] < 0 ? ' negative' : '') + '">' + qtyCell(r.qty[c]) + '</td>'; }).join('') + '</tr>');
    });
    h.push('</tbody><tfoot><tr><th scope="row" colspan="' + a.by.length + '">합계</th><td class="sales-money"><strong>' + amount(s.amount) + '</strong></td><td class="sales-num">100%</td>' + (a.show_average ? '<td class="sales-num">' + amount(s.average) + '</td><td></td>' : '') +
      used.map(function (c) { return '<td class="sales-num">' + amount(s.qty[c]) + '</td>'; }).join('') + '</tr></tfoot></table></div>' + pager(a.table) + '</section>');
    var chart = { trend: t, top: a.top, packs: { keg: P.keg, can500: P.can500, can355: P.can355, oneway: P.oneway } };
    h.push('<script type="application/json" id="sales-analysis-data">' + JSON.stringify(chart).replace(/</g, '\\u003c') + '</script>');
    h.push('</div>');
    return h.join('');
  }

  // ---------------------------------------------------------------- 술이지 (web/sooleasy_report.py와 같은 규칙)
  var QROWS = null;
  function soolRows() {
    if (QROWS) return QROWS;
    var src = D.sooleasy, d = src.dicts, sold = {}, canceled = {};
    src.sold.forEach(function (s) { sold[s] = 1; }); src.canceled.forEach(function (s) { canceled[s] = 1; });
    QROWS = src.rows.map(function (r) {
      var st = d.statuses[r[9]], type = d.types[r[1]];
      return { day: r[0], month: r[0].slice(0, 7), type: type, product: d.products[r[2]], member_code: r[3], member: src.members[r[3]] || r[3] || '미확인',
        store: d.stores[r[4]], pickup: !!r[5], cnt: r[6], price: r[7], order: r[8], status: st, sold: !!sold[st], canceled: !!canceled[st], beer: type !== '기타 상품' };
    });
    return QROWS;
  }
  function nunique(rows, f) { var s = new Set(); rows.forEach(function (r) { s.add(f(r)); }); return s.size; }
  function soolPage(params) {
    var src = D.sooleasy;
    if (!src) return '<div class="erp"><header class="erp-title"><div><h1>술이지 매출</h1></div></header>' + empty('술이지 자료가 없습니다.') + '</div>';
    var all = soolRows(), asof = all.reduce(function (m, r) { return r.day > m ? r.day : m; }, ''), first = all.reduce(function (m, r) { return r.day < m ? r.day : m; }, asof);
    var ranges = quickRanges(asof); ranges.all = [first, asof];
    var key = params.get('range') || '', error = '', start, end;
    if (ranges[key] && !(params.get('from') || params.get('to'))) { start = ranges[key][0]; end = ranges[key][1]; }
    else {
      var fr = params.get('from'), to = params.get('to');
      start = fr || ranges.this_year[0]; end = to || ranges.this_year[1];
      if ((fr && !validDate(fr)) || (to && !validDate(to)) || end < start) { start = ranges.this_year[0]; end = ranges.this_year[1]; error = '시작일과 종료일을 확인해 주세요. 올해 기간을 표시합니다.'; }
      key = Object.keys(ranges).filter(function (k) { return ranges[k][0] === start && ranges[k][1] === end; })[0] || '';
    }
    var member = params.get('member') || ''; if (!src.members[member]) member = '';
    var kind = params.get('type') || ''; if (src.type_order.indexOf(kind) < 0) kind = '';
    var period = all.filter(function (r) { return r.day >= start && r.day <= end && (!member || r.member_code === member) && (!kind || r.type === kind); });
    var sold = period.filter(function (r) { return r.sold; }), beer = sold.filter(function (r) { return r.beer; });
    var keep = {}; if (member) keep.member = member; if (kind) keep.type = kind;
    function link(changes) { return '#sooleasy?' + qs(Object.assign({ from: start, to: end }, keep, changes)); }
    var sum = function (rows, f) { return rows.reduce(function (s, r) { return s + f(r); }, 0); };
    var s = { boxes: sum(beer, function (r) { return r.cnt; }), orders: nunique(sold, function (r) { return r.order; }), amount: sum(sold, function (r) { return r.price; }),
      other: sum(sold.filter(function (r) { return !r.beer; }), function (r) { return r.cnt; }),
      pickup: sold.length ? pyRound(100 * sold.filter(function (r) { return r.pickup; }).length / sold.length, 1) : null,
      pending: nunique(period.filter(function (r) { return !r.sold && !r.canceled; }), function (r) { return r.order; }),
      canceled: nunique(period.filter(function (r) { return r.canceled; }), function (r) { return r.order; }) };
    var months = periods(start.slice(0, 7) + '-01', end, 'month').map(function (p) { return p[0]; });
    var types = src.type_order.filter(function (t) { return beer.some(function (r) { return r.type === t; }); });
    var trend = { months: months, types: types.map(function (t) { return { type: t, color: src.type_colors[src.type_order.indexOf(t)], values: months.map(function (m) { return sum(beer.filter(function (r) { return r.type === t && r.month === m; }), function (r) { return r.cnt; }); }) }; }),
      amount: months.map(function (m) { return sum(sold.filter(function (r) { return r.month === m; }), function (r) { return r.price; }); }),
      links: months.map(function (m) { return link({ from: m + '-01' > start ? m + '-01' : start, to: monthEnd(m) < end ? monthEnd(m) : end, range: '' }); }) };
    var totalBoxes = s.boxes, byType = {};
    sold.forEach(function (r) { (byType[r.type] = byType[r.type] || []).push(r); });
    var typeRows = Object.keys(byType).sort(function (a, b) { var ia = src.type_order.indexOf(a), ib = src.type_order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }).map(function (t) {
      var g = byType[t], names = {}; g.forEach(function (r) { names[r.product] = (names[r.product] || 0) + r.cnt; });
      var boxes = sum(g, function (r) { return r.cnt; });
      return { type: t, boxes: boxes, amount: sum(g, function (r) { return r.price; }), orders: nunique(g, function (r) { return r.order; }), other: t === '기타 상품',
        share: totalBoxes && t !== '기타 상품' ? pyRound(100 * boxes / totalBoxes, 1) : null,
        products: Object.keys(names).sort(function (a, b) { return names[b] - names[a]; }).map(function (n) { return { name: n, boxes: names[n] }; }), href: link({ type: t }) };
    });
    var st = {}; sold.filter(function (r) { return r.pickup && (r.store || '').trim(); }).forEach(function (r) { var x = st[r.store] || (st[r.store] = { boxes: 0, orders: new Set(), amount: 0 }); x.boxes += r.cnt; x.orders.add(r.order); x.amount += r.price; });
    var storeRows = Object.keys(st).map(function (k) { return { store: k, boxes: st[k].boxes, orders: st[k].orders.size, amount: st[k].amount }; })
      .sort(function (a, b) { return b.boxes - a.boxes || b.orders - a.orders; }).slice(0, 30);
    var mem = {}; sold.forEach(function (r) { var x = mem[r.member] || (mem[r.member] = { boxes: 0, amount: 0 }); x.boxes += r.cnt; x.amount += r.price; });
    var memberRows = Object.keys(mem).sort().map(function (k) { return { member: k, boxes: mem[k].boxes, amount: mem[k].amount }; });
    var stat = {}; period.forEach(function (r) { (stat[r.status] = stat[r.status] || new Set()).add(r.order); });
    var statusRows = Object.keys(stat).map(function (k) { return { status: k, orders: stat[k].size, sold: src.sold.indexOf(k) >= 0 }; }).sort(function (a, b) { return b.orders - a.orders; });
    var compare = null;
    if (src.team) {
      var allSold = all.filter(function (r) { return r.sold; }), admBox = {}, admAmt = {};
      allSold.forEach(function (r) { if (r.beer) admBox[r.month] = (admBox[r.month] || 0) + r.cnt; admAmt[r.month] = (admAmt[r.month] || 0) + r.price; });
      var crows = Object.keys(src.team.months).sort().filter(function (m) { return start.slice(0, 7) <= m && m <= end.slice(0, 7); }).map(function (m) {
        var tm = src.team.months[m], ab = admBox[m] || 0, aa = admAmt[m] || 0;
        return { month: m, team_boxes: tm[0], admin_boxes: ab, box_gap: ab - tm[0], team_amount: tm[1], admin_amount: aa, amount_gap: aa - tm[1] };
      });
      if (crows.length) { var tot = {}; ['team_boxes', 'admin_boxes', 'box_gap', 'team_amount', 'admin_amount', 'amount_gap'].forEach(function (k) { tot[k] = sum(crows, function (r) { return r[k]; }); }); compare = { file: src.team.file, rows: crows, totals: tot }; }
    }
    var RL = [['this_month', '이번 달'], ['3m', '최근 3개월'], ['6m', '최근 6개월'], ['this_year', '올해'], ['last_year', '작년'], ['all', '전체']];
    var h = [], signed = function (v) { return (v > 0 ? '+' : '') + amount(v); };
    h.push('<div class="erp"><header class="erp-title"><div><h1>술이지 매출</h1></div><span class="erp-stamp">술이지 주문 ' + esc(asof) + '까지</span></header>');
    h.push('<section class="erp-panel sa-filters" aria-label="술이지 조회 조건"><div class="erp-section"><div><h2>술이지 매출</h2><p>술이지 관리자 주문목록 · ' + esc(asof) + '까지 · 판매 = 구매확정·배송완료·수령완료 · 이카운트 매출과 겹치는 부분이 있어 매출 분석과 더하지 않습니다.</p></div></div>');
    h.push('<form class="erp-filter" data-path="sooleasy"><label>시작일<input type="date" name="from" value="' + esc(start) + '" required></label><label>종료일<input type="date" name="to" value="' + esc(end) + '" required></label>' +
      '<label>맥주 종류<select name="type"><option value="">전체</option>' + src.type_order.map(function (t) { return '<option' + (t === kind ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      (member ? '<input type="hidden" name="member" value="' + esc(member) + '">' : '') + '<button class="erp-button primary" type="submit">조회</button></form>');
    h.push('<div class="sa-row"><span class="sa-label">빠른 기간</span><nav class="sa-chips" aria-label="빠른 기간">' + RL.map(function (x) { var on = x[0] === key; return '<a class="erp-chip' + (on ? ' active' : '') + '" href="' + esc('#sooleasy?' + qs(Object.assign({ range: x[0] }, keep))) + '"' + (on ? ' aria-current="true"' : '') + '>' + x[1] + '</a>'; }).join('') + '</nav></div>');
    h.push('<div class="sa-row"><span class="sa-label">회원 유형</span><nav class="sa-chips" aria-label="회원 유형">' + Object.keys(src.members).map(function (k) { var on = k === member; return '<a class="erp-chip' + (on ? ' active' : '') + '" href="' + esc(link({ member: on ? '' : k })) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(src.members[k]) + '</a>'; }).join('') + '</nav>' +
      (kind ? '<a class="sa-tag" href="' + esc(link({ type: '' })) + '">종류 · ' + esc(kind) + ' <span aria-hidden="true">×</span><span class="erp-sr">조건 빼기</span></a>' : '') + '</div>');
    if (error) h.push('<p class="erp-message error" role="alert">' + esc(error) + '</p>');
    h.push('</section>');
    h.push('<div class="erp-metrics sa-metrics"><section><span>판매 박스(맥주)</span><strong>' + amount(s.boxes) + '<small>박스</small></strong><span>' + esc(start) + ' ~ ' + esc(end) + '</span></section>' +
      '<section><span>주문금액(할인 전)</span><strong>' + amount(s.amount) + '<small>원</small></strong><span>상품 + 커스텀료 + 배송비 · 기업 주문은 0원</span></section>' +
      '<section><span>주문 건수</span><strong>' + amount(s.orders) + '<small>건</small></strong><span>픽업 ' + (s.pickup != null ? pct(s.pickup) : '—') + '%</span></section>' +
      '<section><span>진행 중 · 취소·실패</span><strong>' + s.pending + '<small>건</small> · ' + s.canceled + '<small>건</small></strong><span>판매에 넣지 않음' + (s.other ? ' · 포장박스·팝콘 ' + amount(s.other) + '개 별도' : '') + '</span></section></div>');
    if (!sold.length) h.push(empty('선택한 조건에 판매된 주문이 없습니다.'));
    else {
      h.push('<section class="erp-panel" id="sool-trend"><div class="erp-section"><div><h2>월별 판매 추이</h2><p>맥주 종류별 박스 수(누적) · 막대를 누르면 그 달만 봅니다.</p></div></div>' +
        '<div class="sa-chips" role="group" aria-label="추이 기준"><button type="button" class="erp-chip active" data-sool-metric="boxes" aria-pressed="true">박스 수</button><button type="button" class="erp-chip" data-sool-metric="amount" aria-pressed="false">주문금액</button></div>' +
        '<div class="erp-chart-legend" data-sool-legend></div><div class="erp-chart-box"><canvas id="chart-sool" role="img" aria-label="술이지 월별 판매 세로 막대그래프. 숫자는 아래 표에 있습니다">' + months.map(function (m) { return esc(m) + '. '; }).join('') + '</canvas></div>' +
        '<details class="erp-details"><summary>월별 표 보기</summary><div class="erp-table-wrap erp-data-scroll" tabindex="0" aria-label="술이지 월별 판매"><table class="erp-table"><thead><tr><th class="erp-fixed-col" scope="col">월</th>' +
        trend.types.map(function (t) { return '<th class="erp-num" scope="col">' + esc(t.type) + '</th>'; }).join('') + '<th class="erp-num" scope="col">박스 합계</th><th class="erp-num" scope="col">주문금액 (원)</th></tr></thead><tbody>' +
        months.map(function (m, i) { return i; }).reverse().map(function (i) {
          var tsum = trend.types.reduce(function (acc, t) { return acc + t.values[i]; }, 0);
          return '<tr><th class="erp-fixed-col" scope="row"><a class="erp-link" href="' + esc(trend.links[i]) + '">' + esc(months[i]) + '</a></th>' + trend.types.map(function (t) { return '<td class="erp-num">' + amount(t.values[i]) + '</td>'; }).join('') +
            '<td class="erp-num"><b>' + amount(tsum) + '</b></td><td class="erp-num">' + amount(trend.amount[i]) + '</td></tr>';
        }).join('') + '</tbody></table></div></details></section>');
      h.push('<section class="erp-panel" id="sool-types"><div class="erp-section"><div><h2>맥주 종류별</h2><p>같은 맥주의 커스텀 라벨 상품(예: \'[페일에일] …\', \'K-술이지 …\')은 그 종류에 합쳤습니다. 이름을 누르면 그 종류만 봅니다.</p></div></div>' +
        '<div class="sales-table-wrap"><table class="sales-table"><thead><tr><th scope="col">종류</th><th scope="col" class="sales-num">박스</th><th scope="col" class="sales-num">비중</th><th scope="col" class="sales-num">주문 건수</th><th scope="col" class="sales-money">주문금액 <small>(원)</small></th><th scope="col">상품</th></tr></thead><tbody>' +
        typeRows.map(function (t) {
          return '<tr><th scope="row"><a href="' + esc(t.href) + '">' + esc(t.type) + '</a></th><td class="sales-num">' + amount(t.boxes) + (t.other ? '<small>개</small>' : '') + '</td><td class="sales-num">' + (t.share != null ? pct(t.share) + '%' : '—') + '</td><td class="sales-num">' + amount(t.orders) +
            '</td><td class="sales-money"><strong>' + amount(t.amount) + '</strong></td><td><details><summary>' + t.products.length + '개 상품</summary><ul class="erp-list">' + t.products.map(function (p) { return '<li>' + esc(p.name) + ' <b>' + amount(p.boxes) + '</b></li>'; }).join('') + '</ul></details></td></tr>';
        }).join('') + '</tbody></table></div></section>');
      h.push('<div class="erp-split"><section class="erp-panel" id="sool-stores"><div class="erp-section"><div><h2>픽업 매장</h2><p>픽업 주문의 수령 매장 상위 30곳(박스 순)</p></div></div>' +
        '<div class="erp-table-wrap erp-data-scroll" tabindex="0" aria-label="픽업 매장"><table class="erp-table"><thead><tr><th scope="col">매장</th><th class="erp-num" scope="col">박스</th><th class="erp-num" scope="col">주문</th><th class="erp-num" scope="col">주문금액 (원)</th></tr></thead><tbody>' +
        (storeRows.length ? storeRows.map(function (r) { return '<tr><th scope="row">' + esc(r.store) + '</th><td class="erp-num">' + amount(r.boxes) + '</td><td class="erp-num">' + amount(r.orders) + '</td><td class="erp-num">' + amount(r.amount) + '</td></tr>'; }).join('') : '<tr><td colspan="4">픽업 주문이 없습니다.</td></tr>') +
        '</tbody></table></div></section><section class="erp-panel" id="sool-members"><div class="erp-section"><div><h2>회원 유형 · 주문 상태</h2><p>판매 = 구매확정·배송완료·수령완료</p></div></div>' +
        '<div class="erp-table-wrap"><table class="erp-table"><thead><tr><th scope="col">회원 유형</th><th class="erp-num" scope="col">박스·개</th><th class="erp-num" scope="col">주문금액 (원)</th></tr></thead><tbody>' +
        memberRows.map(function (r) { return '<tr><th scope="row">' + esc(r.member) + '</th><td class="erp-num">' + amount(r.boxes) + '</td><td class="erp-num">' + amount(r.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="erp-table-wrap erp-table-gap"><table class="erp-table"><thead><tr><th scope="col">주문 상태(기간 전체)</th><th class="erp-num" scope="col">주문 건수</th></tr></thead><tbody>' +
        statusRows.map(function (r) { return '<tr><th scope="row">' + esc(r.status) + (r.sold ? '<small>판매로 셈</small>' : '') + '</th><td class="erp-num">' + amount(r.orders) + '</td></tr>'; }).join('') + '</tbody></table></div></section></div>');
      h.push('<script type="application/json" id="sool-chart-data">' + JSON.stringify(trend).replace(/</g, '\\u003c') + '</script>');
    }
    if (compare) {
      h.push('<section class="erp-panel" id="sool-compare"><div class="erp-section"><div><h2>팀 엑셀 대조</h2><p>' + esc(compare.file) + "의 '총괄'과 관리자 주문목록(판매 상태, 맥주만)을 월별로 비교합니다. 엑셀 금액은 '1박스 정가 × 박스'이고, 관리자 금액은 할인 전 주문금액(커스텀료·배송비 포함, 기업 주문 0원)이라 금액은 기준이 다릅니다.</p></div></div>" +
        '<div class="erp-table-wrap erp-data-scroll" tabindex="0" aria-label="팀 엑셀 대조"><table class="erp-table"><thead><tr><th class="erp-fixed-col" scope="col">월</th><th class="erp-num" scope="col">엑셀 박스</th><th class="erp-num" scope="col">관리자 박스</th><th class="erp-num" scope="col">박스 차이</th><th class="erp-num" scope="col">엑셀 금액 (원)</th><th class="erp-num" scope="col">관리자 주문금액 (원)</th><th class="erp-num" scope="col">금액 차이 (원)</th></tr></thead><tbody>' +
        compare.rows.slice().reverse().map(function (r) { return '<tr><th class="erp-fixed-col" scope="row">' + esc(r.month) + '</th><td class="erp-num">' + amount(r.team_boxes) + '</td><td class="erp-num">' + amount(r.admin_boxes) + '</td><td class="erp-num">' + (r.box_gap ? '<b>' + signed(r.box_gap) + '</b>' : '0') + '</td><td class="erp-num">' + amount(r.team_amount) + '</td><td class="erp-num">' + amount(r.admin_amount) + '</td><td class="erp-num">' + signed(r.amount_gap) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><th class="erp-fixed-col" scope="row">합계</th><td class="erp-num">' + amount(compare.totals.team_boxes) + '</td><td class="erp-num">' + amount(compare.totals.admin_boxes) + '</td><td class="erp-num"><b>' + signed(compare.totals.box_gap) + '</b></td><td class="erp-num">' + amount(compare.totals.team_amount) + '</td><td class="erp-num">' + amount(compare.totals.admin_amount) + '</td><td class="erp-num">' + signed(compare.totals.amount_gap) + '</td></tr></tfoot></table></div></section>');
    }
    h.push('</div>');
    return h.join('');
  }

  // ---------------------------------------------------------------- 처음
  (async function () {
    try { if (await tryStored()) start(); else document.getElementById('pw').focus(); }
    catch (e) { document.getElementById('gate-msg').textContent = (e && e.message) || '자료를 불러오지 못했습니다.'; }
  })();
})();
