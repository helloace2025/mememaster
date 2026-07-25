/**
 * MetaMask (and similar) inject inpage.js into every page and may reject with
 * "Failed to connect to MetaMask" without any app code calling ethereum.
 * Next.js dev overlay treats that as an app crash — swallow extension noise only.
 */
(function () {
  if (typeof window === "undefined") return;

  function textOf(x) {
    try {
      if (x == null) return "";
      if (typeof x === "string") return x;
      if (x instanceof Error) return (x.message || "") + "\n" + (x.stack || "");
      if (typeof x === "object") {
        var m = x.message != null ? String(x.message) : "";
        var s = x.stack != null ? String(x.stack) : "";
        return m + "\n" + s + "\n" + String(x);
      }
      return String(x);
    } catch (_) {
      return "";
    }
  }

  function isExtNoise(reason) {
    var t = textOf(reason).toLowerCase();
    if (!t) return false;
    // MetaMask official extension id
    if (t.indexOf("nkbihfbeogaeaoehlefnkodbefgpgknn") !== -1) return true;
    if (t.indexOf("chrome-extension://") !== -1 && t.indexOf("inpage.js") !== -1)
      return true;
    if (t.indexOf("failed to connect to metamask") !== -1) return true;
    if (t.indexOf("metamask extension not found") !== -1) return true;
    if (
      t.indexOf("metamask") !== -1 &&
      (t.indexOf("failed to connect") !== -1 ||
        t.indexOf("object.connect") !== -1)
    )
      return true;
    return false;
  }

  function swallow(e) {
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (_) {}
    return false;
  }

  // Capture phase — run before Next.js overlay listeners when possible
  window.addEventListener(
    "unhandledrejection",
    function (e) {
      if (isExtNoise(e.reason)) swallow(e);
    },
    true
  );
  window.addEventListener(
    "error",
    function (e) {
      if (isExtNoise(e.error || e.message)) swallow(e);
    },
    true
  );

  // Tear down Next.js error UI if it still mounts with extension text
  function killOverlayIfNoise() {
    try {
      var roots = document.querySelectorAll(
        "nextjs-portal, #__next-build-error, [data-nextjs-dialog-overlay], [data-nextjs-toast]"
      );
      for (var i = 0; i < roots.length; i++) {
        var el = roots[i];
        var txt = (el.textContent || "").toLowerCase();
        if (
          txt.indexOf("failed to connect to metamask") !== -1 ||
          txt.indexOf("nkbihfbeogaeaoehlefnkodbefgpgknn") !== -1 ||
          (txt.indexOf("metamask") !== -1 && txt.indexOf("inpage") !== -1)
        ) {
          el.remove();
        }
      }
      // floating "1 error" toast
      var all = document.body ? document.body.querySelectorAll("*") : [];
      for (var j = 0; j < all.length; j++) {
        var n = all[j];
        if (!n || !n.childNodes || n.childNodes.length !== 1) continue;
        var only = (n.textContent || "").trim().toLowerCase();
        if (only === "1 error" || only === "1error") {
          // only remove if sibling/parent mentions metamask nearby
          var p = n.parentElement;
          var ctx = p ? (p.textContent || "").toLowerCase() : "";
          if (
            ctx.indexOf("metamask") !== -1 ||
            document.body.innerText.toLowerCase().indexOf(
              "failed to connect to metamask"
            ) !== -1
          ) {
            var portal = n.closest("nextjs-portal") || p;
            if (portal) portal.remove();
          }
        }
      }
    } catch (_) {}
  }

  if (typeof MutationObserver !== "undefined") {
    var obs = new MutationObserver(function () {
      killOverlayIfNoise();
    });
    var start = function () {
      if (!document.documentElement) return;
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      killOverlayIfNoise();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
    setInterval(killOverlayIfNoise, 500);
  }
})();
