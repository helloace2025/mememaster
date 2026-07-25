"use client";

import type { ReactNode } from "react";

export default function DocLink({
  href,
  title,
  subtitle,
  icon,
  external,
  badge,
  onClick,
}: {
  href?: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  external?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  const className =
    "group flex w-full items-center gap-2.5 rounded-xl border border-zinc-100 bg-white px-2.5 py-2 text-left shadow-[0_1px_0_rgba(0,0,0,0.02)] transition hover:border-zinc-200 hover:bg-zinc-50/90";

  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-600 ring-1 ring-zinc-100 group-hover:from-zinc-100 group-hover:to-zinc-200/80">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-zinc-800">
            {title}
          </span>
          {badge && (
            <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 ring-1 ring-emerald-100">
              {badge}
            </span>
          )}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[10px] text-zinc-400">
            {subtitle}
          </span>
        )}
      </span>
      <span className="text-[12px] text-zinc-300 transition group-hover:text-zinc-500">
        ›
      </span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className={className}
        onClick={onClick}
      >
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}
