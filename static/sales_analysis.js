// 매출 분석(2026-11-25): 판매 추이 세로 막대(채널별 누적 순매출 또는 포장별 수량)와 매출처·품목 상위 가로 막대.
// 숫자는 서버가 #sales-analysis-data 에 넣어 준다. 금액은 원 단위 정수로만 보여 준다.
(function () {
  var holder = document.getElementById('sales-analysis-data');
  if (!holder) return;
  var data = JSON.parse(holder.textContent);
  var boxes = document.querySelectorAll('#sales-trend .erp-chart-box, #sales-table .erp-chart-box');
  if (!window.Chart) {
    boxes.forEach(function (box) {
      var note = document.createElement('div');
      note.className = 'erp-empty';
      note.textContent = '그래프를 불러오지 못했습니다(인터넷 연결 확인). 아래 표를 보세요.';
      box.replaceChildren(note);
    });
    document.querySelectorAll('[data-trend-metric]').forEach(function (b) { b.disabled = true; });
    return;
  }
  var fmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  var fmt2 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
  var won = function (v) { return fmt.format(Math.round(v)) + '원'; };
  var ink = '#536579', grid = '#e3eaf0';
  var channelColor = { '도매사': '#2a78d6', 'BGF리테일': '#eb6834', '본사': '#1baf7a', '기타 업소': '#eda100',
    '생활맥주 가맹점': '#e87ba4', '쿠팡': '#008300', '네이버': '#03a94d' };
  var spare = ['#6250d6', '#e34948', '#7a8794', '#0f8b8d', '#b7791f'];
  var colorOf = function (name, i) { return channelColor[name] || spare[i % spare.length]; };
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = ink;

  // 채널 비중 막대·목록에 같은 색을 칠한다
  var order = data.trend.channels.map(function (c) { return c.channel; });
  document.querySelectorAll('[data-channel]').forEach(function (el) {
    var name = el.getAttribute('data-channel');
    var i = order.indexOf(name);
    el.style.background = colorOf(name, i < 0 ? 0 : i);
  });

  // 1. 판매 추이
  var trend = data.trend;
  var canvas = document.getElementById('chart-trend');
  if (canvas) {
    var legend = document.querySelector('[data-trend-legend]');
    var unitText = function (pack) { return pack === 'keg' || pack === 'oneway' ? '개' : '캔'; };
    var labels = trend.labels.map(function (l) { return trend.unit === 'month' ? l : l.slice(5).replace('-', '/'); });
    var amountSets = function () {
      return trend.channels.map(function (s, i) {
        return { label: s.channel, data: s.values, backgroundColor: colorOf(s.channel, i), borderColor: '#fff',
          borderWidth: { top: 1 }, borderRadius: 3, maxBarThickness: 40, stack: 'a' };
      });
    };
    var drawLegend = function (metric) {
      if (!legend) return;
      legend.replaceChildren();
      if (metric !== 'amount') return;
      trend.channels.forEach(function (s, i) {
        var item = document.createElement('span');
        var mark = document.createElement('i');
        mark.style.background = colorOf(s.channel, i);
        item.appendChild(mark);
        item.appendChild(document.createTextNode(s.channel));
        legend.appendChild(item);
      });
    };
    var chart = new Chart(canvas, {
      type: 'bar',
      data: { labels: labels, datasets: amountSets() },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onHover: function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: function (e, els) {
          if (!els.length) return;
          var r = trend.ranges[els[0].index];
          if (r && r.href) window.location.href = r.href;
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: function (items) { var r = trend.ranges[items[0].dataIndex]; return r.start === r.end ? r.start : r.start + ' ~ ' + r.end; },
            label: function (c) {
              return chart.$metric === 'amount' ? ' ' + c.dataset.label + ' ' + won(c.parsed.y)
                : ' ' + c.dataset.label + ' ' + fmt2.format(c.parsed.y) + unitText(chart.$metric);
            },
            footer: function (items) {
              if (chart.$metric !== 'amount') return '';
              return '합계 ' + won(items.reduce(function (s, x) { return s + x.parsed.y; }, 0)) + ' · 누르면 이 기간만 봅니다';
            }
          } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 45 } },
          y: { stacked: true, beginAtZero: true, grid: { color: grid },
            ticks: { callback: function (v) { return fmt.format(v); } }, title: { display: true, text: '원' } }
        }
      }
    });
    chart.$metric = 'amount';
    var buttons = document.querySelectorAll('[data-trend-metric]');
    var show = function (metric) {
      chart.$metric = metric;
      if (metric === 'amount') {
        chart.data.datasets = amountSets();
        chart.options.scales.y.title.text = '원';
      } else {
        chart.data.datasets = [{ label: data.packs[metric], data: trend.packs[metric], backgroundColor: '#1b6585',
          borderRadius: 3, maxBarThickness: 40, stack: 'a' }];
        chart.options.scales.y.title.text = unitText(metric);
      }
      chart.update();
      drawLegend(metric);
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-trend-metric') === metric;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    buttons.forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-trend-metric')); }); });
    drawLegend('amount');
  }

  // 2. 매출처·품목 상위 가로 막대
  var top = document.getElementById('chart-top');
  if (top && data.top.rows.length) {
    var rows = data.top.rows;
    var short = function (name) { return name.length > 18 ? name.slice(0, 17) + '…' : name; };
    new Chart(top, {
      type: 'bar',
      data: { labels: rows.map(function (r) { return short(r.name); }),
        datasets: [{ label: '순매출', data: rows.map(function (r) { return r.amount; }), backgroundColor: '#2f6f8f',
          borderRadius: 3, maxBarThickness: 20 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        onHover: function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: function (e, els) { if (els.length && rows[els[0].index].href) window.location.href = rows[els[0].index].href; },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: function (items) { return rows[items[0].dataIndex].name; },
          label: function (c) { var r = rows[c.dataIndex]; return ' 순매출 ' + won(r.amount) + (r.share != null ? ' · ' + r.share + '%' : ''); }
        } } },
        scales: {
          x: { beginAtZero: true, grid: { color: grid }, ticks: { callback: function (v) { return fmt.format(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false } }
        }
      }
    });
  }
})();

// 술이지 월별 판매 추이: 맥주 종류별 박스(누적) 또는 주문금액. 막대를 누르면 그 달만 본다.
(function () {
  var holder = document.getElementById('sool-chart-data');
  var canvas = document.getElementById('chart-sool');
  if (!holder || !canvas) return;
  if (!window.Chart) {
    var note = document.createElement('div');
    note.className = 'erp-empty';
    note.textContent = '그래프를 불러오지 못했습니다(인터넷 연결 확인). 아래 표를 보세요.';
    canvas.parentNode.replaceChildren(note);
    return;
  }
  var t = JSON.parse(holder.textContent);
  var fmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  var legend = document.querySelector('[data-sool-legend]');
  var boxSets = function () {
    return t.types.map(function (s) { return { label: s.type, data: s.values, backgroundColor: s.color, borderRadius: 2, maxBarThickness: 42, stack: 'a' }; });
  };
  var drawLegend = function (metric) {
    legend.replaceChildren();
    if (metric !== 'boxes') return;
    t.types.forEach(function (s) {
      var item = document.createElement('span'), mark = document.createElement('i');
      mark.style.background = s.color; item.appendChild(mark); item.appendChild(document.createTextNode(s.type)); legend.appendChild(item);
    });
  };
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  var chart = new Chart(canvas, {
    type: 'bar',
    data: { labels: t.months, datasets: boxSets() },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      onHover: function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      onClick: function (e, els) { if (els.length && t.links[els[0].index]) window.location.href = t.links[els[0].index]; },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: function (c) { return ' ' + c.dataset.label + ' ' + fmt.format(c.parsed.y) + (chart.$metric === 'boxes' ? '박스' : '원'); },
        footer: function (items) { return chart.$metric === 'boxes' ? '합계 ' + fmt.format(items.reduce(function (s, x) { return s + x.parsed.y; }, 0)) + '박스' : ''; }
      } } },
      scales: { x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: function (v) { return fmt.format(v); } }, title: { display: true, text: '박스' } } }
    }
  });
  chart.$metric = 'boxes';
  var buttons = document.querySelectorAll('[data-sool-metric]');
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-sool-metric');
      chart.$metric = m;
      chart.data.datasets = m === 'boxes' ? boxSets() : [{ label: '주문금액', data: t.amount, backgroundColor: '#2f6f8f', borderRadius: 3, maxBarThickness: 42, stack: 'a' }];
      chart.options.scales.y.title.text = m === 'boxes' ? '박스' : '원';
      chart.update();
      drawLegend(m);
      buttons.forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    });
  });
  drawLegend('boxes');
})();
