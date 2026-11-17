"use client";
/**
 * Registers the offline service worker in production, tracks whether OpenCV + shell are cached
 * ("Online" when cached and connected, "Offline" when disconnected), and offers a 1-click reload when a new version is waiting.
 */
import { useEffect, useState } from "react";

const OPENCV_ASSET = "/vendor/opencv-4.10.0-release.1.js";

export default function OfflineStatus() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [waitingSw, setWaitingSw] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const checkCached = () => {
      if ("caches" in window) {
        Promise.all([caches.match(OPENCV_ASSET), caches.match("/scan")])
          .then(([cvHit, scanHit]) => setOfflineReady(!!cvHit && !!scanHit))
          .catch(() => {});
      }
    };
    checkCached();

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      let refreshing = false;
      // Only reload when replacing an existing active worker (not on first-ever claim),
      // so deep links with query params or unsaved work aren't wiped mid-load.
      let reloadOnControl = !!navigator.serviceWorker.controller;
      const onController = () => {
        if (!reloadOnControl) {
          reloadOnControl = true;
          return;
        }
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      };
      navigator.serviceWorker.addEventListener("controllerchange", onController);

      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          navigator.serviceWorker.ready.then(checkCached).catch(() => {});
          if (reg.waiting) setWaitingSw(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed") {
                if (navigator.serviceWorker.controller) setWaitingSw(nw);
                checkCached();
              }
            });
          });
        })
        .catch(() => {});

      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        navigator.serviceWorker.removeEventListener("controllerchange", onController);
      };
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (waitingSw) {
    return (
      <button
        type="button"
        onClick={() => waitingSw.postMessage({ type: "SKIP_WAITING" })}
        className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[var(--gold)] bg-[var(--gold-tint)] px-2.5 py-1 text-[11px] font-semibold text-[var(--gold-hover)] dark:text-[var(--gold)]"
        data-testid="sw-update-btn"
      >
        New version · Reload
      </button>
    );
  }

  if (!online || offlineReady) {
    return (
      <span
        className={`${!online ? "inline-flex" : "hidden sm:inline-flex"} items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${!online ? "v-badge-warn" : "v-badge-ok"}`}
        data-testid="offline-ready-badge"
        title={offlineReady ? "Scanner engine & routes are cached on this device" : "Working offline"}
      >
        <span className={`size-1.5 rounded-full ${!online ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
        {!online ? "Offline" : "Online"}
      </span>
    );
  }

  return null;
}
