"use client";

import type { ReactNode } from "react";

/**
 * Lightweight markdown → readable React (no extra deps).
 * Supports: headings, bold, italic, inline code, lists, checklists,
 * tables, hr, paragraphs, links, callout lines.
 * `spacious` = roomier layout for long ops / playbook docs.
 */
export default function RichText({
  text,
  className = "",
  spacious = false,
}: {
  text: string;
  className?: string;
  spacious?: boolean;
}) {
  if (!text?.trim()) return null;

  const normalized = normalizeMarkdown(text);
  const blocks = splitBlocks(normalized);

  return (
    <div
      className={
        spacious
          ? `space-y-5 text-[13.5px] leading-[1.8] text-zinc-800 ${className}`
          : `space-y-2.5 text-[14px] leading-relaxed text-zinc-800 ${className}`
      }
    >
      {blocks.map((b, i) => (
        <Block key={i} block={b} spacious={spacious} />
      ))}
    </div>
  );
}

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "checklist"; items: { done: boolean; text: string }[] }
  | { type: "hr" }
  | { type: "quote"; text: string }
  | { type: "callout"; kind: "tip" | "warn" | "ok" | "info"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

/** Fix common LLM mess: escaped newlines, no blank lines, jammed tables. */
export function normalizeMarkdown(raw: string): string {
  let s = raw
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();

  // Collapse 3+ blank lines → 2
  s = s.replace(/\n{3,}/g, "\n\n");

  // Ensure blank line before ATX headings
  s = s.replace(/([^\n])\n(#{1,6}\s+)/g, "$1\n\n$2");
  // Blank line after heading line
  s = s.replace(/(^|\n)(#{1,6}\s+[^\n]+)\n(?!\n|#|\s*[-*•]|\s*\d+[.)])/g, "$1$2\n\n");

  // Numbered section titles like "2.3 内容节奏" on own line → ### heading
  s = s.replace(
    /(^|\n)(\d+\.\d+(?:\.\d+)?\s+[^\n|]+?)(?=\n|$)/g,
    (_m, pre, title) => `${pre}### ${String(title).trim()}`
  );

  // Day N labels mid-table → break to heading-ish lines when jammed
  s = s.replace(/\s*\|\s*(Day\s*\d+|第\s*\d+\s*天|D\d+)\s*[（(]?/gi, "\n\n### $1 ");

  // Split super-long single-line markdown tables (many | cells, no newlines)
  s = s
    .split("\n")
    .map((line) => expandJammedTableLine(line))
    .join("\n");

  // After expansion, ensure blank line before tables
  s = s.replace(/([^\n])\n(\|[^\n]+\|)/g, "$1\n\n$2");

  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** One line with many | … | → multi-line GFM table when it looks jammed. */
function expandJammedTableLine(line: string): string {
  const t = line.trim();
  if (!t.includes("|")) return line;
  // already a short normal row
  if (t.length < 120 && (t.match(/\|/g) || []).length <= 8) return line;

  const pipeCount = (t.match(/\|/g) || []).length;
  if (pipeCount < 6) return line;

  // Prefer splitting on row-like patterns: |---| or || or | Day
  let work = t;
  // normalize double pipes used as row breaks
  work = work.replace(/\|\|/g, "|\n|");
  // split after separator rows
  work = work.replace(/\|(\s*:?-{3,}:?\s*\|)+/g, (m) => `${m}\n`);

  // If still one long line, chunk by detecting header vs data: take cells
  if (!work.includes("\n") && pipeCount >= 8) {
    const cells = splitRow(work);
    if (cells.length >= 6) {
      // Heuristic: first 4 cells = headers for a 4-col table, rest as rows of 4
      // Or detect separator cells
      const sepIdx = cells.findIndex((c) => /^:?-{2,}:?$/.test(c));
      if (sepIdx > 0 && sepIdx <= 8) {
        const cols = sepIdx;
        const headers = cells.slice(0, cols);
        const rest = cells.slice(sepIdx + 1);
        const rows: string[][] = [];
        for (let i = 0; i < rest.length; i += cols) {
          const chunk = rest.slice(i, i + cols);
          if (chunk.some((c) => c.trim())) rows.push(chunk);
        }
        if (rows.length) {
          const head = `| ${headers.join(" | ")} |`;
          const sep = `| ${headers.map(() => "---").join(" | ")} |`;
          const body = rows
            .map((r) => {
              while (r.length < cols) r.push("");
              return `| ${r.slice(0, cols).join(" | ")} |`;
            })
            .join("\n");
          return `${head}\n${sep}\n${body}`;
        }
      }
    }
  }

  return work;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSepLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|") || !t.includes("-")) return false;
  // | --- | :---: | --- |
  return /^\|?[\s:|-]+\|?$/.test(t) && /-{2,}/.test(t);
}

function isTableRowLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  if (isTableSepLine(t)) return true;
  // at least 2 cells
  return splitRow(t).length >= 2 && (t.match(/\|/g) || []).length >= 1;
}

function splitBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push({ type: "hr" });
      i += 1;
      continue;
    }

    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      out.push({ type: "h", level: Math.min(hm[1].length, 4), text: hm[2] });
      i += 1;
      continue;
    }

    // GFM table block
    if (isTableRowLine(trimmed)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableRowLine(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i += 1;
        // allow blank line? no — blank ends table
      }
      const table = parseTable(tableLines);
      if (table) {
        out.push(table);
        continue;
      }
      // fallback: each line as paragraph
      for (const tl of tableLines) {
        out.push({ type: "p", text: tl });
      }
      continue;
    }

    const callout = matchCallout(trimmed);
    if (callout) {
      out.push(callout);
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        parts.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      out.push({ type: "quote", text: parts.join("\n") });
      continue;
    }

    if (/^[-*•]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: { done: boolean; text: string }[] = [];
      while (
        i < lines.length &&
        /^[-*•]\s+\[[ xX]\]\s+/.test(lines[i].trim())
      ) {
        const t = lines[i].trim();
        const m = t.match(/^[-*•]\s+\[([ xX])\]\s+(.+)$/);
        if (m) {
          items.push({ done: m[1].toLowerCase() === "x", text: m[2] });
        }
        i += 1;
      }
      out.push({ type: "checklist", items });
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        if (/^[-*•]\s+\[[ xX]\]\s+/.test(lines[i].trim())) break;
        if (isTableRowLine(lines[i].trim()) && lines[i].includes("|---"))
          break;
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      out.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i += 1;
      }
      out.push({ type: "ol", items });
      continue;
    }

    // Paragraph: do NOT join lines that look like new structural units
    const parts: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) break;
      if (/^#{1,6}\s+/.test(t)) break;
      if (/^[-*•]\s+/.test(t)) break;
      if (/^\d+[.)]\s+/.test(t)) break;
      if (t.startsWith(">")) break;
      if (matchCallout(t)) break;
      if (isTableRowLine(t)) break;
      // Keep soft line breaks as separate visual lines for dense ops text
      parts.push(t);
      i += 1;
    }
    // Join with newline so we can render multi-line paragraphs with <br>
    out.push({ type: "p", text: parts.join("\n") });
  }

  return out;
}

function parseTable(tableLines: string[]): Extract<Block, { type: "table" }> | null {
  if (tableLines.length < 2) return null;
  const rowsRaw = tableLines.filter((l) => !isTableSepLine(l)).map(splitRow);
  if (!rowsRaw.length) return null;
  // Find sep line index in original
  const hasSep = tableLines.some(isTableSepLine);
  if (!hasSep && rowsRaw.length < 2) return null;

  const headers = rowsRaw[0];
  const body = rowsRaw.slice(1);
  if (!headers.length) return null;
  const cols = headers.length;
  const rows = body.map((r) => {
    const copy = [...r];
    while (copy.length < cols) copy.push("");
    return copy.slice(0, cols);
  });
  return { type: "table", headers, rows };
}

function matchCallout(
  trimmed: string
): Extract<Block, { type: "callout" }> | null {
  if (/^(💡|✅|✓|⚠️|⚠|ℹ️|ℹ|📌|🔥|👉)\s*/.test(trimmed)) {
    let kind: "tip" | "warn" | "ok" | "info" = "info";
    if (/^(💡|📌|👉)/.test(trimmed)) kind = "tip";
    else if (/^(✅|✓)/.test(trimmed)) kind = "ok";
    else if (/^(⚠️|⚠)/.test(trimmed)) kind = "warn";
    else if (/^(ℹ️|ℹ|🔥)/.test(trimmed)) kind = "info";
    return {
      type: "callout",
      kind,
      text: trimmed.replace(/^(💡|✅|✓|⚠️|⚠|ℹ️|ℹ|📌|🔥|👉)\s*/, ""),
    };
  }
  if (/^(提示|建议|注意|风险|可学)[：:]/.test(trimmed)) {
    const kind: "tip" | "warn" | "ok" | "info" = /^(注意|风险)/.test(trimmed)
      ? "warn"
      : /^(可学)/.test(trimmed)
        ? "ok"
        : "tip";
    return { type: "callout", kind, text: trimmed };
  }
  return null;
}

function Block({
  block,
  spacious = false,
}: {
  block: Block;
  spacious?: boolean;
}) {
  const liGap = spacious ? "space-y-3" : "space-y-1";
  const pLead = spacious ? "leading-[1.8]" : "leading-relaxed";
  const liLead = spacious ? "leading-[1.75]" : "leading-snug";

  switch (block.type) {
    case "h": {
      const cls = spacious
        ? block.level <= 1
          ? "pt-2 text-[16px] font-semibold tracking-tight text-zinc-900 first:pt-0"
          : block.level === 2
            ? "mt-1 border-b border-zinc-200 pb-2 pt-5 text-[14.5px] font-semibold text-zinc-900 first:mt-0 first:pt-0"
            : block.level === 3
              ? "pt-4 text-[13.5px] font-semibold text-zinc-800 first:pt-0"
              : "pt-3 text-[13px] font-semibold text-zinc-700 first:pt-0"
        : block.level <= 1
          ? "mt-1 text-[15px] font-semibold tracking-tight text-zinc-900"
          : block.level === 2
            ? "mt-0.5 text-[14px] font-semibold text-zinc-900"
            : "text-[13px] font-semibold text-zinc-800";
      return <h3 className={cls}>{inline(block.text)}</h3>;
    }
    case "p": {
      const lines = block.text.split("\n");
      return (
        <p className={`text-zinc-700 ${pLead}`}>
          {lines.map((ln, idx) => (
            <span key={idx}>
              {idx > 0 && <br />}
              {inline(ln)}
            </span>
          ))}
        </p>
      );
    }
    case "ul":
      return (
        <ul
          className={`list-disc pl-5 text-zinc-700 marker:text-zinc-400 ${liGap} ${
            spacious ? "my-1" : ""
          }`}
        >
          {block.items.map((it, i) => (
            <li key={i} className={`pl-1 ${liLead}`}>
              {inline(it)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol
          className={`list-decimal pl-5 text-zinc-700 marker:text-zinc-400 ${liGap} ${
            spacious ? "my-1" : ""
          }`}
        >
          {block.items.map((it, i) => (
            <li key={i} className={`pl-1 ${liLead}`}>
              {inline(it)}
            </li>
          ))}
        </ol>
      );
    case "checklist":
      return (
        <ul className={spacious ? "my-1 space-y-2.5" : "space-y-1.5"}>
          {block.items.map((it, i) => (
            <li
              key={i}
              className={`flex items-start gap-2.5 border border-zinc-100 bg-white/80 ${
                spacious ? "px-3 py-2.5" : "rounded-lg px-2 py-1.5"
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  it.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-zinc-300 bg-white text-transparent"
                }`}
              >
                ✓
              </span>
              <span
                className={`text-[13px] ${liLead} ${
                  it.done ? "text-zinc-400 line-through" : "text-zinc-700"
                }`}
              >
                {inline(it.text)}
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div
          className={`overflow-x-auto rounded-xl border border-zinc-200 bg-white ${
            spacious ? "my-2 shadow-sm" : "my-1"
          }`}
        >
          <table className="w-full min-w-[280px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50">
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className="whitespace-nowrap px-3 py-2.5 font-semibold text-zinc-700"
                  >
                    {inline(h || "—")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-t border-zinc-100 odd:bg-white even:bg-zinc-50/60"
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-2.5 text-zinc-700 align-top ${
                        spacious ? "leading-[1.65]" : "leading-snug"
                      }`}
                    >
                      {inline(cell || "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return (
        <hr
          className={
            spacious ? "my-3 border-zinc-200" : "border-zinc-200"
          }
        />
      );
    case "quote":
      return (
        <blockquote
          className={`border-l-2 border-emerald-400 bg-emerald-50/40 text-zinc-600 italic ${
            spacious
              ? "my-1 py-3 pl-4 pr-3 text-[13px] leading-[1.75]"
              : "rounded-r-lg py-1.5 pl-3 pr-2 text-[13px]"
          }`}
        >
          {block.text.split("\n").map((ln, idx) => (
            <span key={idx}>
              {idx > 0 && <br />}
              {inline(ln)}
            </span>
          ))}
        </blockquote>
      );
    case "callout": {
      const styles = {
        tip: "border-sky-200 bg-sky-50/80 text-sky-900",
        warn: "border-amber-200 bg-amber-50/80 text-amber-900",
        ok: "border-emerald-200 bg-emerald-50/80 text-emerald-900",
        info: "border-zinc-200 bg-zinc-50 text-zinc-700",
      }[block.kind];
      const label = {
        tip: "建议",
        warn: "注意",
        ok: "可学",
        info: "要点",
      }[block.kind];
      return (
        <div
          className={`border ${styles} ${
            spacious
              ? "my-1 px-3.5 py-3.5 text-[13px] leading-[1.75]"
              : "rounded-lg px-2.5 py-2 text-[12.5px] leading-snug"
          }`}
        >
          <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
            {label}
          </span>
          {inline(block.text)}
        </div>
      );
    }
    default:
      return null;
  }
}

function inline(text: string): ReactNode {
  const re =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const tok = m[0];
    if (tok.startsWith("**") && tok.endsWith("**")) {
      nodes.push(
        <strong key={k++} className="font-semibold text-zinc-900">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      nodes.push(
        <em key={k++} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    } else if (tok.startsWith("`") && tok.endsWith("`")) {
      nodes.push(
        <code
          key={k++}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] text-zinc-800"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        nodes.push(
          <a
            key={k++}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 rounded-md bg-sky-50 px-1 py-0.5 text-sky-700 underline-offset-2 hover:underline"
          >
            {lm[1]}
          </a>
        );
      } else {
        nodes.push(tok);
      }
    } else if (tok.startsWith("http")) {
      nodes.push(
        <a
          key={k++}
          href={tok}
          target="_blank"
          rel="noreferrer"
          className="break-all text-sky-600 underline-offset-2 hover:underline"
        >
          {tok.length > 42 ? `${tok.slice(0, 38)}…` : tok}
        </a>
      );
    } else {
      nodes.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
