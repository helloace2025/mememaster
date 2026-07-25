"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  dictionaries,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "./locales";

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

function format(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  let s = template;
  for (const [k, v] of Object.entries(params)) {
    s = s.split(`{${k}}`).join(String(v));
    // also support ${symbol} style in some welcome strings
    s = s.split(`\${${k}}`).join(String(v));
  }
  return s;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Default zh for SSR + first paint; hydrate from localStorage after mount
  const [locale, setLocaleState] = useState<Locale>("zh");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === "en" || saved === "zh") {
        setLocaleState(saved);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    }
  }, [locale, ready]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => (prev === "zh" ? "en" : "zh"));
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = dictionaries[locale] || dictionaries.zh;
      const raw = dict[key] ?? dictionaries.zh[key] ?? key;
      return format(raw, params);
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, toggleLocale, t]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // fallback for any tree outside provider
    return {
      locale: "zh",
      setLocale: () => undefined,
      toggleLocale: () => undefined,
      t: (key, params) =>
        format(dictionaries.zh[key] ?? key, params),
    };
  }
  return ctx;
}
