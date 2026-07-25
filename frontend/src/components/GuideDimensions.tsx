"use client";

import RichText from "@/components/RichText";

/**
 * Middle column: two independent blocks — 推特运营 / 网站运营.
 * Block layout only (no flex-shrink stack) so content never paints over the next section.
 */
export default function GuideDimensions({
  opsText,
  opsMeta,
  loadingOps,
  onRefreshOps,
  websiteText,
  websiteMeta,
  loadingWebsite,
  onRefreshWebsite,
  hasWebsite,
  hasTwitter,
}: {
  opsText: string;
  opsMeta?: string;
  loadingOps?: boolean;
  onRefreshOps?: () => void;
  websiteText?: string;
  websiteMeta?: string;
  loadingWebsite?: boolean;
  onRefreshWebsite?: () => void;
  hasWebsite?: boolean;
  hasTwitter?: boolean;
}) {
  return (
    <div className="block bg-white">
      <OpsSection
        kind="twitter"
        title="推特运营"
        subtitle="立项路径：切入 → 立概念 → 推项目 · 含配图/视觉线索"
        meta={opsMeta}
        loading={loadingOps}
        empty={
          !hasTwitter
            ? "无有效 X 账号，跳过推特运营拆解"
            : "暂无推文分析"
        }
        content={opsText}
        onRefresh={hasTwitter ? onRefreshOps : undefined}
        loadingLabel="抓取推文并还原立项路径…"
      />

      {/* hard separator between the two blocks */}
      <div className="h-3 border-y border-zinc-200 bg-zinc-100" aria-hidden />

      <OpsSection
        kind="website"
        title="网站运营"
        subtitle="落地页：信息架构 · 设计 · 功能 · 技术栈线索"
        meta={websiteMeta}
        loading={loadingWebsite}
        empty={
          !hasWebsite
            ? "未绑定官网，跳过网站分析（可在右侧对话里讨论要不要做站）"
            : "暂无网站分析"
        }
        content={websiteText || ""}
        onRefresh={hasWebsite ? onRefreshWebsite : undefined}
        loadingLabel="打开官网并拆解落地页…"
      />
    </div>
  );
}

function OpsSection({
  kind,
  title,
  subtitle,
  meta,
  loading,
  empty,
  content,
  onRefresh,
  loadingLabel,
}: {
  kind: "twitter" | "website";
  title: string;
  subtitle: string;
  meta?: string;
  loading?: boolean;
  empty: string;
  content: string;
  onRefresh?: () => void;
  loadingLabel: string;
}) {
  const accent =
    kind === "twitter"
      ? "border-l-sky-500"
      : "border-l-violet-500";
  const badge =
    kind === "twitter"
      ? "bg-sky-50 text-sky-700 ring-sky-100"
      : "bg-violet-50 text-violet-700 ring-violet-100";

  return (
    <section className="relative block w-full overflow-hidden bg-white">
      {/* section header — solid bar, never overlaps body of other block */}
      <div
        className={`flex items-start justify-between gap-2 border-b border-zinc-200 border-l-2 ${accent} bg-zinc-50/90 px-4 py-3 sm:px-5`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${badge}`}
            >
              {kind === "twitter" ? "X" : "WEB"}
            </span>
            <p className="text-[14px] font-semibold text-zinc-900">{title}</p>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-zinc-400">
            {subtitle}
          </p>
          {meta && (
            <p className="mt-1.5 truncate text-[11px] text-zinc-400">{meta}</p>
          )}
        </div>
        {onRefresh && (
          <button
            type="button"
            className="shrink-0 border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "分析中…" : "重新分析"}
          </button>
        )}
      </div>

      {/* body — roomy reading column for long ops docs */}
      <div className="relative block w-full overflow-x-auto px-4 py-6 sm:px-6 sm:py-7">
        {loading && !content && (
          <p className="py-8 text-center text-[13px] text-zinc-400">
            {loadingLabel}
          </p>
        )}
        {content ? (
          isFetchErrorContent(content) ? (
            <div className="block w-full border border-amber-200 bg-amber-50 px-4 py-3.5 text-[13px] leading-[1.7] text-amber-950">
              <RichText text={content} spacious />
            </div>
          ) : (
            <div className="block w-full max-w-none break-words">
              <RichText text={content} spacious />
            </div>
          )
        ) : (
          !loading && (
            <p className="py-2 text-[13px] leading-relaxed text-zinc-400">
              {empty}
            </p>
          )
        )}
      </div>
    </section>
  );
}

/** Detect honest fetch-failure copy from backend (no hallucinated analysis). */
function isFetchErrorContent(text: string) {
  return (
    text.includes("未能获取") ||
    text.includes("无法分析推特运营") ||
    text.includes("没有抓到") ||
    text.includes("请检查该用户的推特账号是否异常") ||
    text.includes("无法打开网站") ||
    text.includes("6551 接口暂时不可用")
  );
}
