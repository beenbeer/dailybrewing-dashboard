// 생활맥주 운영 현황판(보기 전용, 2026-11-26). 자료 data.enc.json을 팀 비밀번호로 이 기기에서 풀어 그린다.
// 숫자 계산은 사내 홈페이지 매출 분석(web/sales_analysis.py)·술이지(web/sooleasy_report.py)와 같은 규칙. 금액은 원 단위 정수.
(function () {
  'use strict';
  var KEY_STORE = 'dbw-site-key-v1';
  var D = null;
  var charts = {};
  var fmt0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  var fmt1 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
  var fmt2 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
  var CH_COLOR = { '도매사': '#2a78d6', 'BGF리테일': '#eb6834', '본사': '#1baf7a', '기타 업소': '#eda100', '생활맥주 가맹점': '#e87ba4', '쿠팡': '#008300', '네이버': '#03a94d' };
  var SPARE = ['#6250d6', '#e34948', '#7a8794', '#0f8b8d', '#b7791f'];
  var PACKS = ['keg', 'can500', 'can355', 'oneway'];

  // ---------------------------------------------------------------- 작은 도구
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'cls') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
  }
  function won(v) { return fmt0.format(Math.round(v || 0)); }
  function qty(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? fmt0.format(v) : fmt2.format(v); }
  function colorOf(name, i) { return CH_COLOR[name] || SPARE[Math.max(i, 0) % SPARE.length]; }
  function b64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function toB64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function store(get, value) {
    try { if (get) return localStorage.getItem(KEY_STORE); if (value == null) localStorage.removeItem(KEY_STORE); else localStorage.setItem(KEY_STORE, value); } catch (e) { return null; }
    return null;
  }
  function killChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function dateOf(s) { return new Date(s + 'T00:00:00Z'); }
  function addDays(s, n) { var d = dateOf(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function monthEnd(m) { var d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); return iso(d); }
  function weekStart(s) { var d = dateOf(s), wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return iso(d); }
  function monthsBack(asof, n) { var y = +asof.slice(0, 4), m = +asof.slice(5, 7) - (n - 1); while (m <= 0) { m += 12; y -= 1; } return y + '-' + String(m).padStart(2, '0') + '-01'; }
  function quickRanges(asof) {
    var y = +asof.slice(0, 4);
    return { this_month: [asof.slice(0, 8) + '01', asof], '3m': [monthsBack(asof, 3), asof], '6m': [monthsBack(asof, 6), asof],
      this_year: [y + '-01-01', asof], last_year: [(y - 1) + '-01-01', (y - 1) + '-12-31'] };
  }
  var RANGE_LABELS = [['this_month', '이번 달'], ['3m', '최근 3개월'], ['6m', '최근 6개월'], ['this_year', '올해'], ['last_year', '작년']];
  function periods(start, end, unit) {
    var out = [];
    if (start > end) return out;
    if (unit === 'month') {
      var cur = start.slice(0, 7) + '-01';
      while (cur <= end) { var me = monthEnd(cur.slice(0, 7)); out.push([cur.slice(0, 7), cur < start ? start : cur, me > end ? end : me]); cur = addDays(me, 1); }
    } else if (unit === 'week') {
      var w = weekStart(start);
      while (w <= end) { var we = addDays(w, 6); out.push([w, w < start ? start : w, we > end ? end : we]); w = addDays(w, 7); }
    } else {
      var d = start; while (d <= end) { out.push([d, d, d]); d = addDays(d, 1); }
    }
    return out;
  }
  function periodKey(day, unit) { return unit === 'month' ? day.slice(0, 7) : unit === 'week' ? weekStart(day) : day; }
  function chip(label, on, onclick, extra) { return h('button', { type: 'button', cls: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: onclick }, extra || null, label); }
  function kpi(label, value, unit, note) { return h('div', { cls: 'kpi' }, h('span', { text: label }), h('strong', null, value, unit ? h('small', { text: unit }) : null), note ? h('em', { text: note }) : null); }
  function select(label, value, options, allLabel, onchange) {
    var s = h('select', { onchange: function () { onchange(s.value); } });
    s.appendChild(h('option', { value: '', text: allLabel }));
    options.forEach(function (o) { var opt = h('option', { value: o, text: o }); if (o === value) opt.selected = true; s.appendChild(opt); });
    if (value && options.indexOf(value) < 0) { var x = h('option', { value: value, text: value }); x.selected = true; s.appendChild(x); }
    return h('label', null, label, s);
  }
  function dateInput(label, value, onchange) {
    var i = h('input', { type: 'date', value: value, onchange: function () { if (i.value) onchange(i.value); } });
    return h('label', null, label, i);
  }
  function daysBar(d) {
    if (d == null) return h('span', { cls: 'hint', text: '—' });
    var v = Math.max(d, 0), c = v <= 10 ? 'var(--good)' : v <= 30 ? 'var(--mid)' : 'var(--warn)';
    return h('span', { cls: 'days' }, h('span', { cls: 'track' }, h('i', { style: 'width:' + Math.min(v, 60) / 60 * 100 + '%;background:' + c })), h('b', { text: v > 90 ? '90일+' : fmt0.format(v) + '일' }));
  }
  function noChart(box) { box.replaceChildren(h('div', { cls: 'empty', text: '그래프를 불러오지 못했습니다(인터넷 연결 확인). 아래 표를 보세요.' })); }

  // ---------------------------------------------------------------- 암호 풀기
  async function deriveKey(password, salt, iter) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function gunzip(bytes) {
    if (!('DecompressionStream' in window)) throw new Error('old');
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
  var BLOB = null;
  async function loadBlob() {
    if (BLOB) return BLOB;
    var r = await fetch('data.enc.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('자료 파일을 받지 못했습니다(' + r.status + ')');
    BLOB = await r.json();
    return BLOB;
  }
  async function tryStored() {
    var s = store(true);
    if (!s) return false;
    try {
      var saved = JSON.parse(s), blob = await loadBlob();
      if (saved.salt !== blob.salt) { store(false, null); return false; }
      var key = await crypto.subtle.importKey('raw', b64(saved.key), { name: 'AES-GCM' }, true, ['decrypt']);
      D = await openWith(key, blob);
      return true;
    } catch (e) { store(false, null); return false; }
  }
  $('gate-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var btn = $('gate-btn'), msg = $('gate-msg');
    if (!window.crypto || !crypto.subtle) { msg.textContent = '이 브라우저에서는 열 수 없습니다(https 주소의 최신 크롬·사파리·엣지로 열어 주세요).'; return; }
    btn.disabled = true; msg.textContent = '여는 중…';
    try {
      var blob = await loadBlob();
      var key = await deriveKey($('pw').value, b64(blob.salt), blob.iter);
      try { D = await openWith(key, blob); } catch (e) { if (!e || !e.wrong) throw e; msg.textContent = '비밀번호가 맞지 않습니다.'; btn.disabled = false; return; }
      if ($('remember').checked) store(false, JSON.stringify({ salt: blob.salt, key: toB64(await crypto.subtle.exportKey('raw', key)) }));
      $('pw').value = '';
      start();
    } catch (e) {
      msg.textContent = e && e.message === 'old' ? '이 브라우저는 자료 압축 풀기를 지원하지 않습니다. 최신 크롬·사파리·엣지로 열어 주세요.' : '자료를 읽지 못했습니다(' + ((e && e.message) || '알 수 없는 오류') + '). 관리자에게 알려 주세요.';
      btn.disabled = false;
    }
  });
  $('lock').addEventListener('click', function () { store(false, null); location.hash = ''; location.reload(); });

  // ---------------------------------------------------------------- 시작·메뉴
  var rendered = {};
  function start() {
    $('gate').hidden = true;
    $('tabs').hidden = false;
    $('lock').hidden = false;
    $('stamp').textContent = '자료 ' + (D.asof || '') + ' · 만든 시각 ' + (D.generated || '').replace('T', ' ');
    if (!D.sooleasy) document.querySelector('[data-tab="sool"]').hidden = true;
    if (!D.store_kegs) document.querySelector('[data-tab="kegs"]').hidden = true;
    window.addEventListener('hashchange', route);
    route();
  }
  function route() {
    var tab = (location.hash || '#sales').slice(1);
    if (['sales', 'sool', 'kegs', 'stock'].indexOf(tab) < 0) tab = 'sales';
    document.querySelectorAll('#tabs a').forEach(function (a) { if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    ['sales', 'sool', 'kegs', 'stock'].forEach(function (t) { $('view-' + t).hidden = t !== tab; });
    if (tab === 'sales') renderSales();
    else if (tab === 'sool') renderSool();
    else if (!rendered[tab]) { rendered[tab] = true; (tab === 'kegs' ? renderKegs : renderStock)(); }
  }

  // ---------------------------------------------------------------- 매출 분석
  var DIM = { month: '월별', customer: '매출처별', product: '품목별' };
  var HEAD = { month: '월', customer: '매출처', product: '품목' };
  var UNIT = { month: '월간', week: '주간', day: '일간' };
  var S = null;
  function salesRows() {
    var d = D.sales.dicts;
    return D.sales.rows.map(function (r) { return { day: r[0], channel: d.channels[r[1]], customer: d.customers[r[2]], product: d.products[r[3]], pack: d.packs[r[4]], qty: r[5], amount: r[6] }; });
  }
  var SR = null;
  function initSales() {
    SR = salesRows();
    var r = quickRanges(D.asof).this_year;
    S = { start: r[0], end: r[1], channel: '', customer: '', product: '', by: ['month'], unit: 'month', metric: 'amount', page: 1, range: 'this_year' };
  }
  function autoUnit() { var span = (dateOf(S.end) - dateOf(S.start)) / 864e5; return span > 62 ? 'month' : span > 31 ? 'week' : 'day'; }
  function setRange(start, end, keepUnit) {
    S.start = start; S.end = end; S.page = 1;
    var q = quickRanges(D.asof); S.range = Object.keys(q).filter(function (k) { return q[k][0] === start && q[k][1] === end; })[0] || '';
    if (!keepUnit) S.unit = autoUnit();
    renderSales();
  }
  function renderSales() {
    if (!S) initSales();
    var view = $('view-sales');
    ['trend', 'top'].forEach(killChart);
    view.replaceChildren();
    var dataFrom = SR.length ? SR[0].day : '';
    var channels = Array.from(new Set(SR.map(function (r) { return r.channel; }))).sort();
    var customers = Array.from(new Set(SR.filter(function (r) { return r.customer && (!S.channel || r.channel === S.channel); }).map(function (r) { return r.customer; }))).sort();
    var products = Array.from(new Set(SR.filter(function (r) { return r.product; }).map(function (r) { return r.product; }))).sort();
    var rows = SR.filter(function (r) {
      return r.day >= S.start && r.day <= S.end && (!S.channel || r.channel === S.channel) && (!S.customer || r.customer === S.customer) && (!S.product || r.product === S.product);
    });

    // 조건
    var byChips = Object.keys(DIM).map(function (d) {
      var order = S.by.indexOf(d);
      return chip(DIM[d], order >= 0, function () {
        if (order >= 0) { if (S.by.length > 1) S.by.splice(order, 1); } else S.by.push(d);
        S.page = 1; renderSales();
      }, order >= 0 ? h('b', { cls: 'ord', text: String(order + 1) }) : null);
    });
    var tags = [['channel', '채널'], ['customer', '매출처'], ['product', '품목']].filter(function (x) { return S[x[0]]; }).map(function (x) {
      return h('button', { type: 'button', cls: 'tag', onclick: function () { S[x[0]] = ''; S.page = 1; renderSales(); } }, x[1] + ' · ' + S[x[0]] + ' ×');
    });
    view.appendChild(h('section', { cls: 'panel' },
      h('h2', { text: '매출 분석' }),
      h('p', { cls: 'note', text: '이카운트 순매출 · 공급가액(VAT 별도) · 반품 차감 · 자료 ' + dataFrom + ' ~ ' + D.asof }),
      h('div', { cls: 'filters' },
        dateInput('시작일', S.start, function (v) { setRange(v, S.end < v ? v : S.end); }),
        dateInput('종료일', S.end, function (v) { setRange(S.start > v ? v : S.start, v); }),
        select('채널', S.channel, channels, '전체 채널', function (v) { S.channel = v; S.customer = ''; S.page = 1; renderSales(); }),
        select('매출처', S.customer, customers, '전체 매출처', function (v) { S.customer = v; S.page = 1; renderSales(); }),
        select('품목', S.product, products, '전체 품목', function (v) { S.product = v; S.page = 1; renderSales(); })),
      h('div', { cls: 'row' }, h('span', { cls: 'row-label', text: '빠른 기간' }), h('div', { cls: 'chips' }, RANGE_LABELS.map(function (x) {
        return chip(x[1], S.range === x[0], function () { var q = quickRanges(D.asof)[x[0]]; setRange(q[0], q[1]); });
      }))),
      h('div', { cls: 'row' }, h('span', { cls: 'row-label', text: '보기 기준' }), h('div', { cls: 'chips' }, byChips), h('span', { cls: 'hint', text: '누른 순서대로 묶습니다. 다시 누르면 뺍니다.' })),
      tags.length ? h('div', { cls: 'row' }, h('span', { cls: 'row-label', text: '선택 조건' }), h('div', { cls: 'chips' }, tags)) : null));
    if (!rows.length) { view.appendChild(h('div', { cls: 'empty', text: '선택한 조건에 표시할 유상 판매가 없습니다.' + (dataFrom && S.start < dataFrom ? ' 판매 자료는 ' + dataFrom + '부터 있습니다.' : '') })); return; }

    // 요약 지표
    var total = 0, packQty = {}, byCh = {}, monthAmt = {};
    rows.forEach(function (r) { total += r.amount; packQty[r.pack] = (packQty[r.pack] || 0) + r.qty; byCh[r.channel] = (byCh[r.channel] || 0) + r.amount; monthAmt[r.day.slice(0, 7)] = (monthAmt[r.day.slice(0, 7)] || 0) + r.amount; });
    var covered = S.end < D.asof ? S.end : D.asof;
    var months = periods(S.start, S.end, 'month').map(function (p) { return p[0]; });
    var full = months.filter(function (m) { return m + '-01' >= S.start && monthEnd(m) <= covered && m + '-01' >= dataFrom.slice(0, 7) + '-01'; });
    var partial = !full.length;
    if (partial) full = months.filter(function (m) { return m + '-01' <= covered; });
    if (!full.length) full = months;
    var avg = full.reduce(function (s, m) { return s + (monthAmt[m] || 0); }, 0) / full.length;
    var chList = Object.keys(byCh).sort(function (a, b) { return byCh[b] - byCh[a]; });
    var nCust = new Set(rows.filter(function (r) { return r.customer; }).map(function (r) { return r.customer; })).size;
    var nProd = new Set(rows.filter(function (r) { return r.product; }).map(function (r) { return r.product; })).size;
    view.appendChild(h('div', { cls: 'kpis' },
      kpi('순매출', won(total), '원', S.start + ' ~ ' + S.end),
      kpi('월평균 매출', won(avg), '원', full.length + '개월 기준 · ' + full[0] + ' ~ ' + full[full.length - 1] + (partial ? ' · 부분월 포함' : '')),
      PACKS.filter(function (p) { return packQty[p]; }).map(function (p) { return kpi(D.packs[p], fmt0.format(packQty[p]), p.indexOf('can') === 0 ? '캔' : '개'); }),
      kpi('거래한 매출처 · 품목', nCust + '곳 · ' + nProd + '종')));
    if (chList.length > 1) {
      view.appendChild(h('section', { cls: 'panel' },
        h('div', { cls: 'share', role: 'img', 'aria-label': '채널 비중' }, chList.map(function (c, i) { var s = total ? 100 * byCh[c] / total : 0; return s > 0 ? h('i', { title: c + ' ' + s.toFixed(1) + '%', style: 'width:' + s + '%;background:' + colorOf(c, i) }) : null; })),
        h('ul', { cls: 'share-list' }, chList.map(function (c, i) {
          return h('li', null, h('button', { type: 'button', onclick: function () { S.channel = c; S.customer = ''; S.page = 1; renderSales(); } }, h('i', { style: 'background:' + colorOf(c, i) }), c),
            h('b', { text: won(byCh[c]) + '원' }), h('span', { text: total ? (100 * byCh[c] / total).toFixed(1) + '%' : '—' }));
        }))));
    }

    // 판매 추이
    var tStart = S.unit === 'month' && dataFrom ? (S.start > dataFrom.slice(0, 7) + '-01' ? S.start : dataFrom.slice(0, 7) + '-01') : (dataFrom && S.start < dataFrom ? dataFrom : S.start);
    if (tStart > S.end) tStart = S.end;
    var ps = periods(tStart, S.end, S.unit), keys = ps.map(function (p) { return p[0]; }), idx = {};
    keys.forEach(function (k, i) { idx[k] = i; });
    var series = {}, packSeries = {};
    chList.forEach(function (c) { series[c] = keys.map(function () { return 0; }); });
    PACKS.forEach(function (p) { packSeries[p] = keys.map(function () { return 0; }); });
    rows.forEach(function (r) { var i = idx[periodKey(r.day, S.unit)]; if (i == null) return; series[r.channel][i] += r.amount; if (packSeries[r.pack]) packSeries[r.pack][i] += r.qty; });
    var drill = { month: 'week', week: 'day', day: 'day' }[S.unit];
    var legend = h('div', { cls: 'legend' });
    var box = h('div', { cls: 'chart' }, h('canvas', { id: 'chart-trend', role: 'img', 'aria-label': UNIT[S.unit] + ' 판매 추이 세로 막대그래프' }));
    var metrics = [['amount', '순매출']].concat(PACKS.filter(function (p) { return packQty[p]; }).map(function (p) { return [p, D.packs[p] + ' 수량']; }));
    view.appendChild(h('section', { cls: 'panel' },
      h('div', { cls: 'head' }, h('div', null, h('h2', { text: '판매 추이' }), h('p', { cls: 'note', text: UNIT[S.unit] + ' · 채널별 누적 · 막대를 누르면 그 기간으로 좁혀서 봅니다.' + (tStart > S.start ? ' 판매 자료가 있는 ' + dataFrom + '부터 그렸습니다.' : '') })),
        h('div', { cls: 'subnav', role: 'group', 'aria-label': '추이 단위' }, Object.keys(UNIT).map(function (u) { return h('button', { type: 'button', cls: u === S.unit ? 'on' : '', onclick: function () { S.unit = u; renderSales(); } }, UNIT[u]); }))),
      h('div', { cls: 'chips', role: 'group', 'aria-label': '추이 기준' }, metrics.map(function (m) { return chip(m[1], S.metric === m[0], function () { S.metric = m[0]; renderSales(); }); })),
      legend, box,
      h('details', null, h('summary', { text: '추이 표 보기' }), h('div', { cls: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: '기간' }), chList.map(function (c) { return h('th', { cls: 'n', text: c + ' (원)' }); }), h('th', { cls: 'n', text: '합계 (원)' }))),
        h('tbody', null, keys.slice().reverse().map(function (k) { var i = idx[k]; var sum = chList.reduce(function (s, c) { return s + series[c][i]; }, 0);
          return h('tr', null, h('th', { text: k }), chList.map(function (c) { return h('td', { cls: 'n', text: won(series[c][i]) }); }), h('td', { cls: 'n', text: won(sum) })); })))))));
    if (!window.Chart) noChart(box); else {
      var sets = S.metric === 'amount' ? chList.map(function (c, i) { return { label: c, data: series[c], backgroundColor: colorOf(c, i), borderRadius: 3, maxBarThickness: 40, stack: 'a' }; })
        : [{ label: D.packs[S.metric], data: packSeries[S.metric], backgroundColor: '#1b6585', borderRadius: 3, maxBarThickness: 40, stack: 'a' }];
      if (S.metric === 'amount') chList.forEach(function (c, i) { legend.appendChild(h('span', null, h('i', { style: 'background:' + colorOf(c, i) }), c)); });
      var unitText = S.metric === 'amount' ? '원' : (S.metric.indexOf('can') === 0 ? '캔' : '개');
      charts.trend = new Chart(document.getElementById('chart-trend'), { type: 'bar',
        data: { labels: keys.map(function (k) { return S.unit === 'month' ? k : k.slice(5).replace('-', '/'); }), datasets: sets },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          onHover: function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          onClick: function (e, els) { if (!els.length) return; var p = ps[els[0].index]; S.unit = drill; setRange(p[1], p[2], true); },
          plugins: { legend: { display: false }, tooltip: { callbacks: {
            title: function (it) { var p = ps[it[0].dataIndex]; return p[1] === p[2] ? p[1] : p[1] + ' ~ ' + p[2]; },
            label: function (c) { return ' ' + c.dataset.label + ' ' + (S.metric === 'amount' ? won(c.parsed.y) : qty(c.parsed.y)) + unitText; },
            footer: function (it) { return S.metric === 'amount' ? '합계 ' + won(it.reduce(function (s, x) { return s + x.parsed.y; }, 0)) + '원 · 누르면 이 기간만' : ''; } } } },
          scales: { x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 45 } },
            y: { stacked: true, beginAtZero: true, ticks: { callback: function (v) { return fmt0.format(v); } }, title: { display: true, text: unitText } } } } });
    }

    // 조합 집계표
    var by = S.by, groups = {}, keysOrder = [];
    rows.forEach(function (r) {
      var key = by.map(function (d) { return d === 'month' ? r.day.slice(0, 7) : (r[d] || ''); });
      var k = JSON.stringify(key), g = groups[k];
      if (!g) { g = groups[k] = { key: key, amount: 0, qty: {}, months: {}, channels: {} }; keysOrder.push(k); }
      g.amount += r.amount; g.qty[r.pack] = (g.qty[r.pack] || 0) + r.qty; g.months[r.day.slice(0, 7)] = (g.months[r.day.slice(0, 7)] || 0) + r.amount; g.channels[r.channel] = 1;
    });
    var prefix = {};
    keysOrder.forEach(function (k) { var g = groups[k]; for (var n = 1; n <= by.length; n++) { var p = JSON.stringify(g.key.slice(0, n)); prefix[p] = (prefix[p] || 0) + g.amount; } });
    var list = keysOrder.map(function (k) { return groups[k]; });
    list.sort(function (a, b) {
      for (var n = 0; n < by.length; n++) {
        if (a.key[n] === b.key[n]) continue;
        if (by[n] === 'month') return a.key[n] < b.key[n] ? 1 : -1;
        var pa = prefix[JSON.stringify(a.key.slice(0, n + 1))], pb = prefix[JSON.stringify(b.key.slice(0, n + 1))];
        if (pa !== pb) return pb - pa;
        return a.key[n] < b.key[n] ? -1 : 1;
      }
      return 0;
    });
    var showAvg = by.indexOf('month') < 0 && !partial;
    var table = [];
    list.forEach(function (g, i) {
      table.push({ kind: 'row', g: g });
      var last = i + 1 === list.length || list[i + 1].key[0] !== g.key[0];
      if (by.length > 1 && last) {
        var members = list.filter(function (x) { return x.key[0] === g.key[0]; }), q = {};
        members.forEach(function (x) { PACKS.forEach(function (p) { q[p] = (q[p] || 0) + (x.qty[p] || 0); }); });
        table.push({ kind: 'sub', label: label(by[0], g.key[0]) + ' 소계', amount: prefix[JSON.stringify([g.key[0]])], qty: q, count: members.length });
      }
    });
    function label(dim, v) { return v || (dim === 'customer' ? '매출처 미확인' : '품목 미확인'); }
    function narrow(dim, v) {
      if (!v) return;
      if (dim === 'month') { var s = v + '-01' > S.start ? v + '-01' : S.start, e = monthEnd(v) < S.end ? monthEnd(v) : S.end; S.unit = 'week'; setRange(s, e, true); return; }
      S[dim] = v; S.page = 1; renderSales();
    }
    var size = 50, pages = Math.max(1, Math.ceil(table.length / size));
    S.page = Math.min(Math.max(S.page, 1), pages);
    var pageRows = table.slice((S.page - 1) * size, S.page * size);
    var topAmt = Math.max.apply(null, pageRows.filter(function (r) { return r.kind === 'row'; }).map(function (r) { return Math.abs(r.g.amount); }).concat([1]));
    var usedPacks = PACKS.filter(function (p) { return packQty[p]; });
    var prev = null;
    var body = pageRows.map(function (r, ri) {
      if (r.kind === 'sub') {
        prev = null;
        return h('tr', { cls: 'sub' }, h('th', { colspan: String(by.length) }, r.label, h('small', { cls: 'sub-line', text: r.count + '줄' })), h('td', { cls: 'n', text: won(r.amount) }),
          h('td', { cls: 'n', text: total ? (100 * r.amount / total).toFixed(1) + '%' : '—' }), showAvg ? [h('td'), h('td')] : null, usedPacks.map(function (p) { return h('td', { cls: 'n', text: qty(r.qty[p] || 0) }); }));
      }
      var g = r.g, cells = by.map(function (d, n) {
        var rep = prev && ri > 0 && JSON.stringify(prev.key.slice(0, n + 1)) === JSON.stringify(g.key.slice(0, n + 1));
        var v = g.key[n];
        return h('th', { cls: rep ? 'rep' : null }, rep ? h('span', { cls: 'erp-sr', text: label(d, v) }) : [v ? h('button', { type: 'button', cls: 'cell-link', onclick: function () { narrow(d, v); } }, label(d, v)) : label(d, v),
          d === 'customer' ? h('small', { cls: 'sub-line', text: Object.keys(g.channels).join(' · ') }) : null]);
      });
      prev = g;
      var avgV = showAvg ? full.reduce(function (s, m) { return s + (g.months[m] || 0); }, 0) / full.length : 0;
      return h('tr', null, cells,
        h('td', { cls: 'n' + (g.amount < 0 ? ' neg' : '') }, h('b', { text: won(g.amount) }), h('span', { cls: 'bar' }, h('i', { style: 'width:' + Math.abs(g.amount) / topAmt * 100 + '%' }))),
        h('td', { cls: 'n', text: total ? (100 * g.amount / total).toFixed(1) + '%' : '—' }),
        showAvg ? [h('td', { cls: 'n', text: won(avgV) }), h('td', { cls: 'n', text: Object.keys(g.months).length + '개월' })] : null,
        usedPacks.map(function (p) { return h('td', { cls: 'n' + ((g.qty[p] || 0) < 0 ? ' neg' : ''), text: qty(g.qty[p] || 0) }); }));
    });
    var topDim = by.filter(function (d) { return d !== 'month'; })[0];
    var topBox = null, topRows = [];
    if (topDim) {
      var ta = {};
      rows.forEach(function (r) { var k = r[topDim] || ''; ta[k] = (ta[k] || 0) + r.amount; });
      topRows = Object.keys(ta).sort(function (a, b) { return ta[b] - ta[a]; }).slice(0, 15).filter(function (k) { return ta[k]; }).map(function (k) { return { key: k, name: label(topDim, k), amount: ta[k] }; });
      if (topRows.length > 1) topBox = h('div', { cls: 'chart', style: 'height:' + (topRows.length * 28 + 60) + 'px' }, h('canvas', { id: 'chart-top', role: 'img', 'aria-label': HEAD[topDim] + '별 순매출 상위' }));
    }
    view.appendChild(h('section', { cls: 'panel' },
      h('h2', { text: by.map(function (d) { return DIM[d]; }).join(' → ') + ' 매출' }),
      h('p', { cls: 'note', text: S.start + ' ~ ' + S.end + ' · 이름을 누르면 그 조건으로 좁힙니다.' + (showAvg ? ' 월평균은 ' + full.length + '개월(' + full[0] + ' ~ ' + full[full.length - 1] + ') 기준입니다.' : '') }),
      topBox ? h('h3', { text: HEAD[topDim] + '별 순매출 상위 ' + topRows.length }) : null, topBox,
      h('div', { cls: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, by.map(function (d) { return h('th', { text: HEAD[d] }); }), h('th', { cls: 'n', text: '순매출 (원)' }), h('th', { cls: 'n', text: '비중' }),
          showAvg ? [h('th', { cls: 'n', text: '월평균 (원)' }), h('th', { cls: 'n', text: '거래한 달' })] : null, usedPacks.map(function (p) { return h('th', { cls: 'n', text: D.packs[p] }); }))),
        h('tbody', null, body),
        h('tfoot', null, h('tr', null, h('th', { colspan: String(by.length), text: '합계' }), h('td', { cls: 'n', text: won(total) }), h('td', { cls: 'n', text: '100%' }),
          showAvg ? [h('td', { cls: 'n', text: won(avg) }), h('td')] : null, usedPacks.map(function (p) { return h('td', { cls: 'n', text: qty(packQty[p]) }); }))))),
      h('div', { cls: 'pager' }, h('span', { text: table.length + '줄 중 ' + ((S.page - 1) * size + 1) + '–' + Math.min(S.page * size, table.length) + '줄' }),
        pages > 1 ? h('span', null, S.page > 1 ? h('button', { type: 'button', onclick: function () { S.page -= 1; renderSales(); } }, '이전') : null, ' ' + S.page + ' / ' + pages + ' ',
          S.page < pages ? h('button', { type: 'button', onclick: function () { S.page += 1; renderSales(); } }, '다음') : null) : null)));
    if (topBox) {
      if (!window.Chart) noChart(topBox); else charts.top = new Chart(document.getElementById('chart-top'), { type: 'bar',
        data: { labels: topRows.map(function (r) { return r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name; }), datasets: [{ data: topRows.map(function (r) { return r.amount; }), backgroundColor: '#2f6f8f', borderRadius: 3, maxBarThickness: 20 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          onHover: function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          onClick: function (e, els) { if (els.length) narrow(topDim, topRows[els[0].index].key); },
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (it) { return topRows[it[0].dataIndex].name; }, label: function (c) { return ' 순매출 ' + won(c.parsed.x) + '원 · ' + (total ? (100 * c.parsed.x / total).toFixed(1) : 0) + '%'; } } } },
          scales: { x: { beginAtZero: true, ticks: { callback: function (v) { return fmt0.format(v); } } }, y: { grid: { display: false }, ticks: { autoSkip: false } } } } });
    }
  }

  // ---------------------------------------------------------------- 술이지
  var Q = null;
  function renderSool() {
    var src = D.sooleasy, d = src.dicts, asof = src.asof;
    if (!Q) { var r = quickRanges(asof).this_year; Q = { start: r[0], end: r[1], range: 'this_year', member: '', type: '', metric: 'boxes' }; }
    var view = $('view-sool');
    killChart('sool');
    view.replaceChildren();
    var all = src.rows.map(function (r) { return { day: r[0], type: d.types[r[1]], product: d.products[r[2]], member: d.members[r[3]], store: d.stores[r[4]], pickup: r[5], boxes: r[6], amount: r[7], orders: r[8] }; });
    var first = all.length ? all[0].day : asof;
    var rows = all.filter(function (r) { return r.day >= Q.start && r.day <= Q.end && (!Q.member || r.member === Q.member) && (!Q.type || r.type === Q.type); });
    function setR(s, e) { Q.start = s; Q.end = e; var q = quickRanges(asof); q.all = [first, asof]; Q.range = Object.keys(q).filter(function (k) { return q[k][0] === s && q[k][1] === e; })[0] || ''; renderSool(); }
    var ranges = RANGE_LABELS.concat([['all', '전체']]);
    var members = Array.from(new Set(all.map(function (r) { return r.member; })));
    var types = src.type_order.filter(function (t) { return d.types.indexOf(t) >= 0; });
    view.appendChild(h('section', { cls: 'panel' },
      h('h2', { text: '술이지 매출' }),
      h('p', { cls: 'note', text: '술이지 관리자 주문 · ' + asof + '까지 · 판매 = ' + src.sold.join('·') + ' · 이카운트 매출과 겹치는 부분이 있어 매출 분석과 더하지 않습니다.' }),
      h('div', { cls: 'filters' }, dateInput('시작일', Q.start, function (v) { setR(v, Q.end < v ? v : Q.end); }), dateInput('종료일', Q.end, function (v) { setR(Q.start > v ? v : Q.start, v); }),
        select('맥주 종류', Q.type, types, '전체', function (v) { Q.type = v; renderSool(); })),
      h('div', { cls: 'row' }, h('span', { cls: 'row-label', text: '빠른 기간' }), h('div', { cls: 'chips' }, ranges.map(function (x) {
        return chip(x[1], Q.range === x[0], function () { var q = quickRanges(asof); q.all = [first, asof]; setR(q[x[0]][0], q[x[0]][1]); });
      }))),
      h('div', { cls: 'row' }, h('span', { cls: 'row-label', text: '회원 유형' }), h('div', { cls: 'chips' }, members.map(function (m) { return chip(m, Q.member === m, function () { Q.member = Q.member === m ? '' : m; renderSool(); }); })))));
    var beer = rows.filter(function (r) { return r.type !== '기타 상품'; });
    var boxes = beer.reduce(function (s, r) { return s + r.boxes; }, 0), amount = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var orders = (Q.member || Q.type) ? rows.reduce(function (s, r) { return s + r.orders; }, 0)
      : Object.keys(src.orders_by_day).filter(function (k) { return k >= Q.start && k <= Q.end; }).reduce(function (s, k) { return s + src.orders_by_day[k]; }, 0);
    var pickO = rows.filter(function (r) { return r.pickup; }).reduce(function (s, r) { return s + r.orders; }, 0), allO = rows.reduce(function (s, r) { return s + r.orders; }, 0);
    var mS = Q.start.slice(0, 7), mE = Q.end.slice(0, 7), canceled = 0;
    src.status.forEach(function (x) { if (x[0] >= mS && x[0] <= mE && src.canceled.indexOf(x[1]) >= 0) canceled += x[2]; });
    view.appendChild(h('div', { cls: 'kpis' }, kpi('판매 박스(맥주)', fmt0.format(boxes), '박스', Q.start + ' ~ ' + Q.end), kpi('주문금액(할인 전)', won(amount), '원', '상품 + 커스텀료 + 배송비 · 기업 주문 0원'),
      kpi('주문 건수', fmt0.format(orders), '건', '픽업 ' + (allO ? (100 * pickO / allO).toFixed(1) : '—') + '%'), kpi('취소·결제실패', fmt0.format(canceled), '건', '해당 달 전체 · 판매에 넣지 않음')));
    if (!rows.length) { view.appendChild(h('div', { cls: 'empty', text: '선택한 조건에 판매된 주문이 없습니다.' })); return; }
    // 월별 추이
    var months = periods(Q.start > first ? Q.start : first.slice(0, 7) + '-01', Q.end, 'month');
    var mk = months.map(function (p) { return p[0]; }), mi = {}; mk.forEach(function (k, i) { mi[k] = i; });
    var tset = types.filter(function (t) { return beer.some(function (r) { return r.type === t; }); });
    var byT = {}; tset.forEach(function (t) { byT[t] = mk.map(function () { return 0; }); });
    var amt = mk.map(function () { return 0; });
    beer.forEach(function (r) { var i = mi[r.day.slice(0, 7)]; if (i != null && byT[r.type]) byT[r.type][i] += r.boxes; });
    rows.forEach(function (r) { var i = mi[r.day.slice(0, 7)]; if (i != null) amt[i] += r.amount; });
    var colorT = function (t) { return src.type_colors[src.type_order.indexOf(t)] || '#7a8794'; };
    var legend = h('div', { cls: 'legend' }), box = h('div', { cls: 'chart' }, h('canvas', { id: 'chart-sool', role: 'img', 'aria-label': '술이지 월별 판매 세로 막대그래프' }));
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '월별 판매 추이' }), h('p', { cls: 'note', text: '맥주 종류별 박스(누적) · 막대를 누르면 그 달만 봅니다.' }),
      h('div', { cls: 'chips' }, chip('박스 수', Q.metric === 'boxes', function () { Q.metric = 'boxes'; renderSool(); }), chip('주문금액', Q.metric === 'amount', function () { Q.metric = 'amount'; renderSool(); })),
      legend, box));
    if (!window.Chart) noChart(box); else {
      if (Q.metric === 'boxes') tset.forEach(function (t) { legend.appendChild(h('span', null, h('i', { style: 'background:' + colorT(t) }), t)); });
      charts.sool = new Chart(document.getElementById('chart-sool'), { type: 'bar',
        data: { labels: mk, datasets: Q.metric === 'boxes' ? tset.map(function (t) { return { label: t, data: byT[t], backgroundColor: colorT(t), borderRadius: 2, maxBarThickness: 42, stack: 'a' }; })
          : [{ label: '주문금액', data: amt, backgroundColor: '#2f6f8f', borderRadius: 3, maxBarThickness: 42, stack: 'a' }] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          onHover: function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          onClick: function (e, els) { if (els.length) { var p = months[els[0].index]; setR(p[1], p[2]); } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ' ' + fmt0.format(c.parsed.y) + (Q.metric === 'boxes' ? '박스' : '원'); } } } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: function (v) { return fmt0.format(v); } }, title: { display: true, text: Q.metric === 'boxes' ? '박스' : '원' } } } } });
    }
    // 종류별
    var tAgg = {};
    rows.forEach(function (r) { var t = tAgg[r.type] || (tAgg[r.type] = { boxes: 0, amount: 0, orders: 0, products: {} }); t.boxes += r.boxes; t.amount += r.amount; t.orders += r.orders; t.products[r.product] = (t.products[r.product] || 0) + r.boxes; });
    var tOrder = src.type_order.filter(function (t) { return tAgg[t]; });
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '맥주 종류별' }), h('p', { cls: 'note', text: '커스텀 라벨 상품은 같은 맥주 종류에 합쳤습니다. 이름을 누르면 그 종류만 봅니다.' }),
      h('div', { cls: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['종류', '박스', '비중', '주문 건수', '주문금액 (원)', '상품'].map(function (x, i) { return h('th', { cls: i > 0 && i < 5 ? 'n' : null, text: x }); }))),
        h('tbody', null, tOrder.map(function (t) { var a = tAgg[t], other = t === '기타 상품';
          return h('tr', null, h('th', null, h('button', { type: 'button', cls: 'cell-link', onclick: function () { Q.type = t; renderSool(); } }, t)),
            h('td', { cls: 'n', text: fmt0.format(a.boxes) + (other ? '개' : '') }), h('td', { cls: 'n', text: !other && boxes ? (100 * a.boxes / boxes).toFixed(1) + '%' : '—' }),
            h('td', { cls: 'n', text: fmt0.format(a.orders) }), h('td', { cls: 'n', text: won(a.amount) }),
            h('td', null, h('details', null, h('summary', { text: Object.keys(a.products).length + '개 상품' }), h('div', null, Object.keys(a.products).sort(function (x, y) { return a.products[y] - a.products[x]; }).map(function (p) { return h('div', { cls: 'hint', text: p + ' ' + fmt0.format(a.products[p]) }); })))));
        }))))));
    // 픽업 매장·회원 유형
    var st = {}; rows.filter(function (r) { return r.pickup && r.store; }).forEach(function (r) { var s = st[r.store] || (st[r.store] = { boxes: 0, orders: 0, amount: 0 }); s.boxes += r.boxes; s.orders += r.orders; s.amount += r.amount; });
    var stores = Object.keys(st).sort(function (a, b) { return st[b].boxes - st[a].boxes || st[b].orders - st[a].orders; }).slice(0, 30);
    var mem = {}; rows.forEach(function (r) { var m = mem[r.member] || (mem[r.member] = { boxes: 0, amount: 0 }); m.boxes += r.boxes; m.amount += r.amount; });
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '픽업 매장 상위 30 · 회원 유형' }),
      h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '매장' }), h('th', { cls: 'n', text: '박스' }), h('th', { cls: 'n', text: '주문' }), h('th', { cls: 'n', text: '주문금액 (원)' }))),
        h('tbody', null, stores.map(function (s) { return h('tr', null, h('th', { text: s }), h('td', { cls: 'n', text: fmt0.format(st[s].boxes) }), h('td', { cls: 'n', text: fmt0.format(st[s].orders) }), h('td', { cls: 'n', text: won(st[s].amount) })); })))),
      h('h3', { text: '회원 유형' }),
      h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '회원 유형' }), h('th', { cls: 'n', text: '박스·개' }), h('th', { cls: 'n', text: '주문금액 (원)' }))),
        h('tbody', null, Object.keys(mem).map(function (m) { return h('tr', null, h('th', { text: m }), h('td', { cls: 'n', text: fmt0.format(mem[m].boxes) }), h('td', { cls: 'n', text: won(mem[m].amount) })); }))))));
    // 팀 엑셀 대조
    if (src.team) {
      var adm = {}, admA = {};
      all.forEach(function (r) { var m = r.day.slice(0, 7); if (r.type !== '기타 상품') adm[m] = (adm[m] || 0) + r.boxes; admA[m] = (admA[m] || 0) + r.amount; });
      var ms = Object.keys(src.team.months).filter(function (m) { return m >= mS && m <= mE; }).sort().reverse();
      if (ms.length) view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '팀 엑셀 대조' }),
        h('p', { cls: 'note', text: src.team.file + "의 '총괄'과 관리자 주문(판매 상태, 맥주)을 월별로 비교합니다. 엑셀 금액은 '1박스 정가 × 박스'라 관리자 주문금액(할인 전, 커스텀·배송비 포함)과 기준이 다릅니다." }),
        h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['월', '엑셀 박스', '관리자 박스', '박스 차이', '엑셀 금액 (원)', '관리자 주문금액 (원)'].map(function (x, i) { return h('th', { cls: i ? 'n' : null, text: x }); }))),
          h('tbody', null, ms.map(function (m) { var t = src.team.months[m], a = adm[m] || 0;
            return h('tr', null, h('th', { text: m }), h('td', { cls: 'n', text: fmt0.format(t[0]) }), h('td', { cls: 'n', text: fmt0.format(a) }), h('td', { cls: 'n', text: (a - t[0] > 0 ? '+' : '') + fmt0.format(a - t[0]) }),
              h('td', { cls: 'n', text: won(t[1]) }), h('td', { cls: 'n', text: won(admA[m] || 0) })); }))))));
    }
  }

  // ---------------------------------------------------------------- 직영점 재고
  function renderKegs() {
    var k = D.store_kegs, view = $('view-kegs'), t = k.totals, n1 = function (x) { return x == null ? '—' : fmt1.format(x); };
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '직영점 케그 재고' }),
      h('p', { cls: 'note', text: k.base_date + ' 재고조사(' + k.stores_counted + '곳) + DBO 배송 − OKPOS 판매 → ' + k.asof + ' 추정 · 손실률은 기준이 아니라 참고값' }),
      h('details', null, h('summary', { text: '계산 규칙' }), h('ul', { cls: 'hint' }, k.rules.map(function (r) { return h('li', { text: r }); }), h('li', { text: '손실률 참고 기간 ' + k.loss_period + ' · 전체 ' + k.loss.overall + '% · 매장 중간값 ' + k.loss.median + '%' })))));
    view.appendChild(h('div', { cls: 'kpis' }, kpi(k.base_date + ' 실사', n1(t.base), '케그'), kpi('그 뒤 DBO 배송', fmt0.format(t.delivered), '케그'), kpi('그 뒤 OKPOS 판매', n1(t.sold), '케그'),
      kpi('장부 재고(손실 전)', n1(t.book), '케그'), kpi('손실 반영 추정', n1(t.est), '케그', '손실 ' + n1(t.loss) + '케그')));
    var cols = ['제품', '실사', '배송', '판매', '장부 재고', '손실률(참고)', '손실 반영', '며칠치'];
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '제품별' }),
      h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, cols.map(function (c, i) { return h('th', { cls: i && i < 7 ? 'n' : null, text: c }); }))),
        h('tbody', null, k.products.map(function (p) { return h('tr', null, h('th', { text: p.product }), h('td', { cls: 'n', text: n1(p.base) }), h('td', { cls: 'n', text: fmt0.format(p.delivered) }), h('td', { cls: 'n', text: n1(p.sold) }),
          h('td', { cls: 'n', text: n1(p.book) }), h('td', { cls: 'n', text: p.loss_rate == null ? '—' : p.loss_rate + '%' }), h('td', { cls: 'n' }, h('b', { text: n1(p.est) })), h('td', null, daysBar(p.days))); })))),
      h('h3', { text: '매장별' }), h('p', { cls: 'note', text: '매장을 누르면 제품별로 펼쳐집니다.' }),
      k.stores.map(function (s) {
        return h('details', { cls: 'store' }, h('summary', null, h('b', { text: s.store }), h('span', { text: '실사 ' + n1(s.base) + ' · 배송 ' + fmt0.format(s.delivered) + ' · 판매 ' + n1(s.sold) + ' · 장부 ' + n1(s.book) + ' · 손실률 ' + s.loss_rate + '% · 추정 ' + n1(s.est) + '케그' }), s.flags ? h('span', { cls: 'flag', text: '확인 ' + s.flags }) : null),
          h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['제품', '실사', '배송', '판매', '장부 재고', '손실 반영', '며칠치', '확인'].map(function (c, i) { return h('th', { cls: i && i < 6 ? 'n' : null, text: c }); }))),
            h('tbody', null, s.rows.map(function (r) { return h('tr', null, h('th', { text: r.product }), h('td', { cls: 'n', text: n1(r.base) }), h('td', { cls: 'n', text: fmt0.format(r.delivered) }), h('td', { cls: 'n', text: n1(r.sold) }), h('td', { cls: 'n', text: n1(r.book) }),
              h('td', { cls: 'n' }, h('b', { text: n1(r.est) })), h('td', null, daysBar(r.days)), h('td', { cls: 'flag', text: r.flag || '' })); })))));
      })));
    var iss = k.issues, parts = [];
    if (iss.flow && iss.flow.length) parts.push(h('div', { cls: 'issue' }, h('h3', { text: '1. 판매 외 소진 (다른 메뉴 판매·도매사 반품 추정)' }),
      h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['제품', '배송', '판매', '쌓였어야 할 양', '실사', '설명 안 되는 양'].map(function (c, i) { return h('th', { cls: i ? 'n' : null, text: c }); }))),
        h('tbody', null, iss.flow.map(function (f) { return h('tr', null, h('th', { text: f.product }), h('td', { cls: 'n', text: fmt0.format(f.delivered) }), h('td', { cls: 'n', text: fmt0.format(f.sold) }), h('td', { cls: 'n', text: fmt0.format(f.should) }), h('td', { cls: 'n', text: fmt0.format(f.stock) }), h('td', { cls: 'n' }, h('b', { text: fmt0.format(f.gap) + '케그' }))); }))))));
    if (iss.territories && iss.territories.length) parts.push(h('div', { cls: 'issue' }, h('h3', { text: '2. DBO 밖 입고 (DBO 미사용·다른 도매사)' }),
      h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['권역(도매사)', '매장', 'DBO 밖 필요량', '이카운트 − DBO', '판단'].map(function (c, i) { return h('th', { cls: i && i < 4 ? 'n' : null, text: c }); }))),
        h('tbody', null, iss.territories.map(function (x) { return h('tr', null, h('th', { text: x.territory }), h('td', { cls: 'n', text: x.stores + '곳' }), h('td', { cls: 'n', text: fmt0.format(x.outside) }), h('td', { cls: 'n', text: x.vendor_gap == null ? '—' : fmt0.format(x.vendor_gap) }), h('td', { text: x.note })); })))),
      h('details', null, h('summary', { text: '매장 목록 ' + iss.outside.length + '곳' }), h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['매장', '구분', '권역', '필요량', 'DBO 배송', 'DBO 밖'].map(function (c, i) { return h('th', { cls: i > 2 ? 'n' : null, text: c }); }))),
        h('tbody', null, iss.outside.map(function (o) { return h('tr', null, h('th', { text: o.store }), h('td', { text: o.kind }), h('td', { text: o.territory }), h('td', { cls: 'n', text: fmt0.format(o.need) }), h('td', { cls: 'n', text: fmt0.format(o.dbo) }), h('td', { cls: 'n' }, h('b', { text: fmt0.format(o.outside) }))); })))))));
    if (iss.slow && iss.slow.length) parts.push(h('div', { cls: 'issue' }, h('h3', { text: '3. 60일치 넘게 쌓인 재고 ' + iss.slow.length + '건' }),
      h('details', null, h('summary', { text: '목록 보기' }), h('div', { cls: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['매장', '제품', '추정 재고', '예전 평균으로 며칠치'].map(function (c, i) { return h('th', { cls: i > 1 ? 'n' : null, text: c }); }))),
        h('tbody', null, iss.slow.map(function (x) { return h('tr', null, h('th', { text: x.store }), h('td', { text: x.product }), h('td', { cls: 'n', text: n1(x.est) }), h('td', { cls: 'n', text: x.hist_days > 365 ? '365일+' : fmt0.format(x.hist_days) + '일' })); })))))));
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '직영점 재고 특이사항' }), h('p', { cls: 'note', text: '재고 계산과 따로 관리합니다.' }), parts));
  }

  // ---------------------------------------------------------------- 재고 현황
  function renderStock() {
    var view = $('view-stock'), rows = (D.stock || []).slice();
    view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: '완제품 재고' }),
      h('p', { cls: 'note', text: '전산 기준(양조장 = 이카운트 합계 − 에르메스, 에르메스 = WMS 실재고) · 자료 ' + D.asof + ' · 홈페이지의 작업 기록·실사 조정은 반영하지 않은 값입니다.' }),
      rows.length ? h('div', { cls: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['제품', '포장', '양조장', '에르메스', '합계'].map(function (c, i) { return h('th', { cls: i > 1 ? 'n' : null, text: c }); }))),
        h('tbody', null, rows.map(function (r) { return h('tr', null, h('th', { text: r.product }), h('td', { text: D.packs[r.pack] || r.pack || '' }),
          h('td', { cls: 'n', text: r.factory == null ? '—' : fmt0.format(r.factory) }), h('td', { cls: 'n', text: r.hermes == null ? '—' : fmt0.format(r.hermes) }), h('td', { cls: 'n' }, h('b', { text: r.total == null ? '—' : fmt0.format(r.total) }))); })))) : h('div', { cls: 'empty', text: '재고 자료가 없습니다.' })));
  }

  // ---------------------------------------------------------------- 처음
  (async function () {
    try {
      if (await tryStored()) start();
      else $('pw').focus();
    } catch (e) { $('gate-msg').textContent = (e && e.message) || '자료를 불러오지 못했습니다.'; }
  })();
})();
