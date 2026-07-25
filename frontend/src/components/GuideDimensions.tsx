"use client";

import RichText from "@/components/RichText";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * Middle column: two independent blocks — Twitter ops / website ops.
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
  const { t } = useI18n();
  return (
    <div className="block bg-white">
      <OpsSection
        kind="twitter"
        title={t("ops.twitter")}
        subtitle={t("ops.twitterSub")}
        meta={opsMeta}
        loading={loadingOps}
        empty={
          !hasTwitter ? t("ops.twitterEmptyNo") : t("ops.twitterEmpty")
        }
        content={opsText}
        onRefresh={hasTwitter ? onRefreshOps : undefined}
        loadingLabel={t("ops.twitterLoading")}
        reanalyzeLabel={t("ops.reanalyze")}
        analyzingLabel={t("ops.analyzing")}
      />

      <div className="h-3 border-y border-zinc-200 bg-zinc-100" aria-hidden />

      <OpsSection
        kind="website"
        title={t("ops.web")}
        subtitle={t("ops.webSub")}
        meta={websiteMeta}
        loading={loadingWebsite}
        empty={!hasWebsite ? t("ops.webEmptyNo") : t("ops.webEmpty")}
        content={websiteText || ""}
        onRefresh={hasWebsite ? onRefreshWebsite : undefined}
        loadingLabel={t("ops.webLoading")}
        reanalyzeLabel={t("ops.reanalyze")}
        analyzingLabel={t("ops.analyzing")}
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
  reanalyzeLabel,
  analyzingLabel,
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
  reanalyzeLabel: string;
  analyzingLabel: string;
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
            {loading ? analyzingLabel : reanalyzeLabel}
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
