"use client";

import { useEffect } from "react";

/**
 * Client-side backup: if Next.js still paints a MetaMask extension error
 * dialog, remove it. Our app no longer touches window.ethereum.
 */
export default function DevOverlayFilter() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const isNoiseText = (t: string) => {
      const s = t.toLowerCase();
      return (
        s.includes("failed to connect to metamask") ||
        s.includes("nkbihfbeogaeaoehlefnkodbefgpgknn") ||
        (s.includes("metamask") && s.includes("inpage.js"))
      );
    };

    const scrub = () => {
      document
        .querySelectorAll(
          "nextjs-portal, [data-nextjs-dialog-overlay], [data-nextjs-toast]"
        )
        .forEach((el) => {
          if (isNoiseText(el.textContent || "")) {
            el.remove();
          }
        });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const msg =
        typeof r === "string"
          ? r
          : r instanceof Error
            ? `${r.message}\n${r.stack || ""}`
            : String(r ?? "");
      if (isNoiseText(msg)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        scrub();
      }
    };

    window.addEventListener("unhandledrejection", onRejection, true);
    const obs = new MutationObserver(scrub);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = window.setInterval(scrub, 400);
    scrub();

    return () => {
      window.removeEventListener("unhandledrejection", onRejection, true);
      obs.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
