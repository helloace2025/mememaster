import type React from "react";

/** Tiny inline SVG icons for Okara-style dense UI */

export function IconDoc({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 4h6l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v4h4M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconChart({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15v-4M12 15V9M16 15v-7" strokeLinecap="round" />
    </svg>
  );
}

export function IconLink({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93" strokeLinecap="round" />
      <path d="M14 11a5 5 0 0 0-7.07 0L5.5 12.41a5 5 0 1 0 7.07 7.07L14 18.07" strokeLinecap="round" />
    </svg>
  );
}

export function IconX({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

export function IconGlobe({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 3 3.5 6 3.5 9s-1 6-3.5 9c-2.5-3-3.5-6-3.5-9s1-6 3.5-9z" />
    </svg>
  );
}

export function IconUsers({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="9" r="2.5" />
      <path d="M3 19c0-2.5 2.5-4.5 6-4.5s6 2 6 4.5M14 14.5c2.2.3 4 1.8 4 4.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconShield({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 3l7 3v5c0 4.5-2.8 7.5-7 10-4.2-2.5-7-5.5-7-10V6l7-3z" />
      <path d="M9.5 12l1.8 1.8L14.5 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSpark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconPlay({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9.5v5l4.5-2.5L10 9.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStar({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16l-4.8 2.4.9-5.4L4.2 9.2l5.4-.8L12 3.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPie({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 3a9 9 0 1 0 9 9h-9V3z" />
      <path d="M13.5 3.2A9 9 0 0 1 20.8 10.5H13.5V3.2z" />
    </svg>
  );
}

export function IconCheck({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconList({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 7h11M9 12h11M9 17h11" strokeLinecap="round" />
      <circle cx="5" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconBook({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5z" />
      <path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20" />
    </svg>
  );
}

export function IconExternal({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M14 5h5v5M19 5l-9 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" />
    </svg>
  );
}

const SCORE_ICONS: Record<
  string,
  (p: { className?: string }) => React.ReactElement
> = {
  pie: IconPie,
  users: IconUsers,
  spark: IconSpark,
  play: IconPlay,
  shield: IconShield,
  globe: IconGlobe,
  star: IconStar,
};

export function ScoreIcon({
  name,
  className = "h-3.5 w-3.5",
}: {
  name?: string;
  className?: string;
}) {
  const Comp = (name && SCORE_ICONS[name]) || IconChart;
  return <Comp className={className} />;
}
