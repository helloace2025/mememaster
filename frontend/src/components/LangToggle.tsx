"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";

/** One-click full-site ZH ↔ EN switcher. */
export default function LangToggle({
  light = false,
}: {
  /** For light toolbars (mobile white bar) */
  light?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();

  const wrap = light
    ? "border-zinc-200 bg-zinc-100"
    : "border-white/15 bg-white/5";
  const on = light
    ? "bg-emerald-600 text-white"
    : "bg-emerald-500 text-black";
  const off = light
    ? "text-zinc-500 hover:text-zinc-900"
    : "text-white/50 hover:text-white";

  return (
    <div
      className={`flex shrink-0 items-center rounded-md border p-0.5 ${wrap}`}
      title={t("nav.switchLang")}
      role="group"
      aria-label={t("nav.switchLang")}
    >
      <button
        type="button"
        onClick={() => setLocale("zh")}
        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
          locale === "zh" ? on : off
        }`}
      >
        中
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
          locale === "en" ? on : off
        }`}
      >
        EN
      </button>
    </div>
  );
}
