// Chart helpers over ApexCharts (loaded from the CDN in index.html). Colours
// are read from the design tokens at draw time, so charts follow the light/dark
// theme and any recolouring in design-system.css. Every chart is registered so
// a theme switch can restyle the ones on screen.

const mounted = [];

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette() {
  return {
    ink: token("--ink"),
    text: token("--ink-70"),
    grid: token("--ink-12"),
    muted: token("--ink-40"),
    primary: token("--primary"),
    success: token("--success"),
    warning: token("--warning"),
    danger: token("--danger"),
    info: token("--info"),
    font: token("--font-sans"),
  };
}

function baseOptions() {
  const p = palette();
  return {
    chart: { fontFamily: p.font, toolbar: { show: false }, background: "transparent", foreColor: p.text },
    grid: { borderColor: p.grid },
    tooltip: { theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" },
    legend: { fontFamily: p.font, labels: { colors: p.text } },
  };
}

function mount(el, build) {
  // The chart library comes from a CDN; without it the page still works, just without the chart.
  if (typeof ApexCharts === "undefined") return null;
  const chart = new ApexCharts(el, build());
  chart.render();
  mounted.push({ el, chart, build });
  return chart;
}

// labels, series: arrays; pickColors(palette) -> array of colours in label order.
export function donut(el, { labels, series, pickColors, height = 260 }) {
  const build = () => {
    const base = baseOptions();
    return {
      ...base,
      chart: { ...base.chart, type: "donut", height },
      labels,
      series,
      colors: pickColors(palette()),
      dataLabels: { enabled: false },
      stroke: { width: 2, colors: [token("--surface")] },
      plotOptions: { pie: { donut: { size: "70%", labels: { show: false } } } },
      legend: { ...base.legend, position: "bottom" },
    };
  };
  return mount(el, build);
}

// categories: x labels; series: [{ name, data }]; pickColors(palette) -> colours per series.
export function bars(el, { categories, series, pickColors, height = 260 }) {
  const build = () => {
    const base = baseOptions();
    return {
      ...base,
      chart: { ...base.chart, type: "bar", height },
      series,
      xaxis: { categories, axisBorder: { show: false }, axisTicks: { show: false } },
      colors: pickColors(palette()),
      dataLabels: { enabled: false },
      plotOptions: { bar: { borderRadius: 4, columnWidth: "45%" } },
      grid: { ...base.grid, strokeDashArray: 4 },
    };
  };
  return mount(el, build);
}

// Re-applies colours to charts still on screen; detached ones are dropped.
export function refreshCharts() {
  for (let i = mounted.length - 1; i >= 0; i--) {
    const { el, chart, build } = mounted[i];
    if (!el.isConnected) {
      mounted.splice(i, 1);
      continue;
    }
    chart.updateOptions(build(), false, false);
  }
}
