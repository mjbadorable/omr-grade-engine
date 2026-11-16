"use client";
/** Light / dark theme. No stored choice = follow the OS; the inline script in layout.tsx applies it before first paint. */
import { useEffect, useState } from "react";

export const THEME_KEY = "omr:theme";
export const MOTION_KEY = "omr:motion";
type Theme = "light" | "dark";
type MotionMode = "full" | "reduced";

/** Applied in <head> before hydration so there is no flash of the wrong theme or motion mode. */
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="light"&&t!=="dark"){try{t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}}document.documentElement.setAttribute("data-theme",t);var mo;try{mo=localStorage.getItem("${MOTION_KEY}")}catch(e){}if(mo!=="full"&&mo!=="reduced"){try{mo=matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"full"}catch(e){mo="full"}}document.documentElement.setAttribute("data-motion",mo);})();`;

/** Current theme + a toggle (persisted; applied on <html data-theme>). Used by the profile menu. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    let cur = document.documentElement.getAttribute("data-theme");
    if (cur !== "light" && cur !== "dark") {
      cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", cur);
    }
    setTheme(cur === "dark" ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: applies for this visit only */ }
  };
  return { theme, toggle };
}

/** Motion preference + toggle (persisted; applied on <html data-motion>). */
export function useMotion() {
  const [motion, setMotion] = useState<MotionMode>("full");
  useEffect(() => { setMotion(document.documentElement.getAttribute("data-motion") === "reduced" ? "reduced" : "full"); }, []);
  const toggle = () => {
    const next: MotionMode = motion === "reduced" ? "full" : "reduced";
    setMotion(next);
    document.documentElement.setAttribute("data-motion", next);
    try { localStorage.setItem(MOTION_KEY, next); } catch { /* private mode: applies for this visit only */ }
  };
  return { motion, toggle };
}
