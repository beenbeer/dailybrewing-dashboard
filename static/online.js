"use strict";

const onlineBoard = document.querySelector("[data-online-dashboard]");
const onlineColors = ["#3257c7", "#167f78", "#b65818", "#8760b1", "#a94463", "#4980a0", "#65748d"];

if (onlineBoard) {
  const number = new Intl.NumberFormat("ko-KR");
  let chart = null;
  let currentMetric = "";
  let lastMarkup = onlineBoard.innerHTML;
  let inFlight = false;

  function renderBars(container, series, unit) {
    const totals = series.map(item => ({name: item.name, total: item.values.reduce((sum, value) => sum + (value ?? 0), 0)}));
    const max = Math.max(1, ...totals.map(item => Math.abs(item.total)));
    container.replaceChildren(...totals.map((item, index) => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      const track = document.createElement("span");
      const bar = document.createElement("i");
      const value = document.createElement("b");
      label.textContent = item.name;
      bar.style.width = (100 * Math.abs(item.total) / max) + "%";
      bar.style.backgroundColor = onlineColors[index];
      value.textContent = number.format(item.total) + unit;
      track.append(bar);
      row.append(label, track, value);
      return row;
    }));
  }

  function initChart() {
    const raw = onlineBoard.querySelector("[data-online-chart-data]");
    const metric = onlineBoard.querySelector("[data-online-metric]");
    if (!raw || !metric) return;
    const data = JSON.parse(raw.textContent);
    const box = onlineBoard.querySelector("[data-online-chart-box]");
    const fallback = onlineBoard.querySelector("[data-online-chart-fallback]");
    if (currentMetric in data.metrics) metric.value = currentMetric;
    function draw() {
      currentMetric = metric.value;
      const series = data.metrics[currentMetric];
      const unit = currentMetric === "매출액" ? "원" : currentMetric;
      chart?.destroy();
      renderBars(fallback, series, unit);
      if (!window.Chart) return;
      box.hidden = false;
      chart = new window.Chart(box.querySelector("canvas"), {
        type: "bar",
        data: {labels: data.labels, datasets: series.map((item, index) => ({
          label: item.name, data: item.values, backgroundColor: onlineColors[index], borderRadius: 3
        }))},
        options: {
          animation: false, responsive: true, maintainAspectRatio: false,
          interaction: {mode: "index", intersect: false},
          scales: {
            x: {stacked: true, grid: {display: false}, ticks: {maxTicksLimit: 12}},
            y: {stacked: true, beginAtZero: true, ticks: {callback: value => number.format(value)}}
          },
          plugins: {
            legend: {position: "bottom", labels: {boxWidth: 10, boxHeight: 10}},
            tooltip: {callbacks: {label: item => item.dataset.label + " " + number.format(item.parsed.y) + unit}}
          }
        }
      });
    }
    metric.addEventListener("change", draw);
    draw();
  }

  async function updateDashboard() {
    if (document.hidden || inFlight || onlineBoard.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
    inFlight = true;
    try {
      const response = await fetch(location.href, {cache: "no-store", credentials: "same-origin"});
      if (!response.ok || response.redirected) return;
      const incoming = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("[data-online-dashboard]");
      if (!incoming || incoming.innerHTML === lastMarkup) return;
      lastMarkup = incoming.innerHTML;
      chart?.destroy();
      chart = null;
      onlineBoard.replaceChildren(...incoming.childNodes);
      initChart();
    } catch {
      // 기존 화면을 유지하고 다음 주기에 다시 읽는다.
    } finally {
      inFlight = false;
    }
  }

  initChart();
  setInterval(updateDashboard, 30_000);
  document.addEventListener("visibilitychange", updateDashboard);
}
