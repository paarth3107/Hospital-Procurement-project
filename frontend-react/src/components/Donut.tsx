import { useEffect, useRef } from "react";
import { donut, type ChartPalette } from "../lib/charts";

// Thin wrapper around lib/charts.ts's donut() (itself a mirror of
// charts.js's own) -- a ref'd div that draws once per distinct dataset. Every
// dashboard pane that shows a "stage breakdown" donut uses this instead of
// each dashboard hand-rolling its own chart-mount effect.
export function Donut({
  labels,
  series,
  pickColors,
  height,
  legend,
}: {
  labels: string[];
  series: number[];
  pickColors: (p: ChartPalette) => (string | undefined)[];
  height?: number;
  legend?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Re-draw only when the actual data changes, not on every parent re-render
  // (a dashboard's queue/pagination state changes far more often than its
  // stage counts do) -- mirrors vanilla's "draw once when this data lands"
  // behaviour, which only ever calls donut() after a fresh stats fetch.
  const dataKey = JSON.stringify([labels, series]);
  useEffect(() => {
    if (ref.current) donut(ref.current, { labels, series, pickColors, height, legend });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, height, legend]);
  return <div ref={ref} />;
}
