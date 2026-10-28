// Chart helpers over ApexCharts (loaded from the CDN in index.html).
// Replaces frontend/js/charts.js now that the whole app is one React tree:
// that file's `donut()`/`palette()`/`refreshCharts()` used to be shared with
// this file's own React-side mirror via a `window`-parked registry, since a
// theme toggle in the vanilla shell had to restyle charts drawn by a
// completely separate React bundle. There's no bundle boundary left to
// cross, so the registry is just a plain module-level array again, same as
// charts.js's own original (pre-bridge) shape -- colours are read from the
// design tokens at draw time, so charts follow the light/dark theme and any
// recolouring in design-system.css.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ApexCharts: new (el: HTMLElement, options: unknown) => { render(): void; destroy(): void; updateOptions(options: unknown, redrawPaths: boolean, animate: boolean): void };
}

interface ChartRegistryEntry {
  el: HTMLElement;
  chart: { updateOptions(options: unknown, redrawPaths: boolean, animate: boolean): void };
  build: () => unknown;
}

const mounted: ChartRegistryEntry[] = [];

export interface ChartPalette {
  ink: string;
  text: string;
  grid: string;
  muted: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  font: string;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette(): ChartPalette {
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

function mount(el: HTMLElement, build: () => unknown) {
  // The chart library comes from a CDN; without it the page still works, just without the chart.
  if (typeof ApexCharts === "undefined") return null;
  const chart = new ApexCharts(el, build());
  chart.render();
  mounted.push({ el, chart: chart as unknown as ChartRegistryEntry["chart"], build });
  return chart;
}

// Tears a chart down and drops it from the registry. Callers that mount from a
// React effect must call this in cleanup, or ApexCharts appends a second
// canvas to the same element (StrictMode double-invoke, data refetch).
export function destroyChart(chart: ReturnType<typeof mount>) {
  if (!chart) return;
  const i = mounted.findIndex((m) => m.chart === (chart as unknown as ChartRegistryEntry["chart"]));
  if (i >= 0) mounted.splice(i, 1);
  chart.destroy();
}

export interface DonutOptions {
  labels: string[];
  series: number[];
  pickColors: (p: ChartPalette) => (string | undefined)[];
  height?: number;
  legend?: boolean;
}

// labels, series: arrays; pickColors(palette) -> array of colours in label order.
export function donut(el: HTMLElement, { labels, series, pickColors, height = 260, legend = true }: DonutOptions) {
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
      legend: { ...base.legend, position: "bottom", show: legend },
    };
  };
  return mount(el, build);
}

// Re-applies colours to charts still on screen (theme toggle); detached
// ones are dropped.
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
