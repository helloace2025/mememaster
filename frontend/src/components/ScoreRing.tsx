"use client";

/** Circular score gauge: 0–10 → arc fill */
export default function ScoreRing({
  score,
  label,
  size = 68,
  stroke = 5.5,
  hint,
}: {
  score: number;
  label: string;
  size?: number;
  stroke?: number;
  hint?: string;
}) {
  const safe = Number.isFinite(score) ? score : 0;
  const pct = Math.max(0, Math.min(100, safe * 10));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color =
    safe >= 7 ? "#059669" : safe >= 4 ? "#d97706" : "#e11d48";

  return (
    <div className="flex flex-col items-center gap-1" title={hint || label}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="absolute inset-0 -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#f0f0f2"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[15px] font-semibold tabular-nums leading-none text-zinc-900">
            {safe.toFixed(safe % 1 === 0 ? 0 : 1)}
          </span>
          <span className="mt-0.5 text-[9px] text-zinc-400">/10</span>
        </div>
      </div>
      <span className="max-w-[76px] text-center text-[10px] font-medium leading-tight text-zinc-600">
        {label}
      </span>
    </div>
  );
}
