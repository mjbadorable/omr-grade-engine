"use client";
/**
 * The teacher's courses, wherever they live: the workspace (a signed-in faculty member) or this device
 * (local-first mode, or not a member). Same shape either way, so the dashboard and the designer never branch on it.
 */
import { useEffect, useMemo, useState } from "react";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import type { SavedCourse } from "@/lib/courses/courses";
import { listLocalCourses } from "@/lib/storage/course-library";

export interface CoursesState {
  courses: SavedCourse[];
  /** false until the first read finishes (the device is read after mount so server and client agree) */
  loaded: boolean;
  source: "cloud" | "local";
}

export function useCourses(): CoursesState {
  const s = useCloudSession();
  const member = !!s && s.workspace.access === "member" && !!s.workspace.orgId;
  const cloud = s?.courses;
  const [local, setLocal] = useState<SavedCourse[] | null>(null);
  useEffect(() => {
    const read = () => setLocal(listLocalCourses());
    read();
    window.addEventListener(TEMPLATE_CHANGED_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(TEMPLATE_CHANGED_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  const fromCloud = useMemo<SavedCourse[]>(() => (cloud ?? []).map((c) => ({
    id: c._id, code: c.code, title: c.title, semester: c.semester,
    ...(c.schoolYear ? { schoolYear: c.schoolYear } : {}), ...(c.syllabusId ? { syllabusId: c.syllabusId } : {}),
    sections: c.sections.map((x) => ({ id: x.id, name: x.name, ...(x.classId ? { classId: x.classId } : {}) })),
    createdAt: c.updatedAt, updatedAt: c.updatedAt,
  })), [cloud]);
  // still working out whether this person is a workspace member: not "empty", just not known yet
  const waiting = !!s && (s.isLoading || (s.isAuthenticated && s.workspace.access === "loading"));
  if (member) return { courses: fromCloud, loaded: cloud !== undefined, source: "cloud" };
  return { courses: local ?? [], loaded: local !== null && !waiting, source: "local" };
}
