// A small ring progress indicator (2026-10-13, user-requested -- "like the
// circle progress bar for context remaining", for file uploads). Plain SVG,
// no charting library -- it's one static ring filling in, not a chart.
export function CircularProgress({ value, size = 16, strokeWidth = 2.5 }: { value: number; size?: number; strokeWidth?: number }) {
  const clamped = Math.min(1, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="circular-progress" aria-hidden="true">
      <circle cx={c} cy={c} r={radius} fill="none" stroke="var(--ink-18)" strokeWidth={strokeWidth} />
      <circle
        cx={c}
        cy={c}
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: "stroke-dashoffset .15s linear" }}
      />
    </svg>
  );
}

// Ring + "NN%" label together -- what every upload button actually renders
// while in flight. One shared component so all five upload surfaces look
// and behave identically, not five hand-rolled variants.
export function UploadProgress({ value, label = "Uploading" }: { value: number; label?: string }) {
  return (
    <span className="d-flex items-center gap-6px">
      <CircularProgress value={value} />
      <span>
        {label}… {Math.round(Math.min(1, Math.max(0, value)) * 100)}%
      </span>
    </span>
  );
}
