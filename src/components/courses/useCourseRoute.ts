"use client";
/**
 * Which course the dashboard is showing, kept in `?courseId=` so it can be bookmarked and the browser's
 * Back button works. Read after mount (never during render), so the server and the first client paint agree.
 */
import { useCallback, useEffect, useState } from "react";
import { parseCourseParams } from "@/lib/courses/courses";

export function useCourseRoute() {
  const [courseId, setCourseId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setCourseId(parseCourseParams(window.location.search)?.courseId ?? null);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const open = useCallback((id: string, opts: { scroll?: boolean } = {}) => {
    window.history.pushState(null, "", `/?courseId=${encodeURIComponent(id)}`);
    setCourseId(id);
    if (opts.scroll !== false) window.scrollTo({ top: 0 });
  }, []);
  /** `replace`: drop an unknown id without adding a history entry */
  const close = useCallback((replace = false) => {
    if (replace) window.history.replaceState(null, "", "/"); else window.history.pushState(null, "", "/");
    setCourseId(null);
  }, []);
  return { courseId, open, close };
}
