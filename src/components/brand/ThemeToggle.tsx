"use client";
/** Light / dark theme. No stored choice = follow the OS; the inline script in layout.tsx applies it before first paint. */
import { useEffect, useState } from "react";

export const THEME_KEY = "omr:theme";
type Theme = "light" | "dark";

/** Applied in <head> before hydration so there is no flash of the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');}catch(e){}})();`;

/** Current theme + a toggle (persisted; applied on <html data-theme>). Used by the profile menu. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => { setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"); }, []);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: applies for this visit only */ }
  };
  return { theme, toggle };
}
