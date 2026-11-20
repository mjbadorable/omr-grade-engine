"use client";
/**
 * Shown above the designer when the exam is being designed inside a course (`?courseId=`). The teacher can
 * leave the scope at "All sections" (the default), pick one section, or bulk-apply the design across
 * multiple checked sections in one click.
 */
import Link from "next/link";
import { useState } from "react";
import Select from "@/components/ui/Select";
import type { SavedCourse } from "@/lib/courses/courses";

const touchBtn = "v-btn min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11";
const checkPill = "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium hover:border-[var(--brand-soft)] [@media(pointer:coarse)]:min-h-11";

export default function CourseContextBanner({
  course,
  sectionId,
  onSection,
  canBulkApply = true,
  bulkBusy = false,
  bulkStatus = null,
  bulkError = null,
  onBulkApply,
}: {
  course: SavedCourse;
  sectionId: string | null;
  onSection: (id: string | null) => void;
  canBulkApply?: boolean;
  bulkBusy?: boolean;
  bulkStatus?: string | null;
  bulkError?: string | null;
  onBulkApply?: (sectionIds: string[]) => void | Promise<void>;
}) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const validSelected = selected.filter((id) => course.sections.some((s) => s.id === id));
  const allSelected = course.sections.length > 0 && validSelected.length === course.sections.length;

  const toggleAll = () => {
    setSelected(allSelected ? [] : course.sections.map((s) => s.id));
  };
  const toggleOne = (id: string) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  return (
    <div role="region" aria-label="Course context" data-testid="course-context-banner" className="v-panel space-y-3 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 basis-64">
          <span className="text-zinc-600 dark:text-zinc-400">Designing inside </span>
          <span className="mr-1.5 inline-block rounded-md bg-[var(--brand-solid)] px-2 py-0.5 align-baseline text-xs font-bold text-white" data-testid="course-context-code">{course.code}</span>{" "}
          <span className="break-words font-semibold" data-testid="course-context-title">· {course.title}</span>
        </p>
        {course.sections.length > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Section scope
            <Select
              dataTestId="course-section-scope"
              ariaLabel="Section scope"
              className="min-w-36"
              value={sectionId ?? ""}
              options={[
                { value: "", label: "All sections" },
                ...course.sections.map((s) => ({ value: s.id, label: s.name })),
              ]}
              onChange={(v) => onSection(v || null)}
            />
          </label>
        )}
        {course.sections.length > 0 && onBulkApply && (
          <button
            type="button"
            data-testid="designer-bulk-toggle"
            aria-expanded={bulkOpen}
            className={touchBtn}
            onClick={() => {
              setBulkOpen((v) => {
                if (!v && validSelected.length === 0) setSelected(course.sections.map((s) => s.id));
                return !v;
              });
            }}
          >
            {bulkOpen ? "Close Bulk Select" : "Bulk Apply to Sections"}
          </button>
        )}
        <Link href={`/?courseId=${encodeURIComponent(course.id)}`} data-testid="back-to-course" className={touchBtn}>Back to Course</Link>
      </div>

      {bulkOpen && course.sections.length > 0 && onBulkApply && (
        <div data-testid="designer-bulk-panel" className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold [@media(pointer:coarse)]:min-h-11">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="size-4 accent-[var(--brand-solid)]"
              />
              Select all sections ({validSelected.length}/{course.sections.length})
            </label>
            <button
              type="button"
              data-testid="designer-bulk-apply"
              disabled={!canBulkApply || validSelected.length === 0 || bulkBusy}
              onClick={() => void onBulkApply(validSelected)}
              className="v-btn v-btn-primary min-h-9 border-[var(--brand-solid)] bg-[var(--brand-solid)] px-3 text-xs text-white disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
            >
              {bulkBusy
                ? "Applying…"
                : `Apply Design to ${validSelected.length} ${validSelected.length === 1 ? "Section" : "Sections"}`}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {course.sections.map((s) => (
              <label key={s.id} className={checkPill}>
                <input
                  type="checkbox"
                  checked={validSelected.includes(s.id)}
                  onChange={() => toggleOne(s.id)}
                  className="size-4 accent-[var(--brand-solid)]"
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
          {bulkError && (
            <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-300">{bulkError}</p>
          )}
          {bulkStatus && (
            <p role="status" data-testid="designer-bulk-status" className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {bulkStatus}{" "}
              <Link href={`/?courseId=${encodeURIComponent(course.id)}`} className="underline underline-offset-2">
                View in Course
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
