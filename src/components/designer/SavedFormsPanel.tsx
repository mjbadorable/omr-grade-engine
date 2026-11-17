"use client";
/**
 * Saved Answer Sheets library panel for coordinators and faculty:
 * save custom sheet layouts, apply saved layouts with one tap, or copy a 1-click Share Form link.
 */
import { useEffect, useState } from "react";
import type { LayoutSettings } from "@/lib/omr/schema";
import {
  buildShareFormUrl,
  deleteSavedForm,
  FORMS_CHANGED_EVENT,
  listSavedForms,
  MAX_FORM_NAME,
  saveSheetForm,
  type SavedSheetForm,
} from "@/lib/omr/saved-forms";

function formQuestionCount(settings: LayoutSettings): number {
  return settings.sections.reduce((sum, s) => sum + s.questionCount, 0);
}

export default function SavedFormsPanel({
  settings,
  onApply,
}: {
  settings: LayoutSettings;
  onApply: (next: LayoutSettings) => void;
}) {
  const [forms, setForms] = useState<SavedSheetForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualShareUrl, setManualShareUrl] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setForms(listSavedForms());
    sync();
    window.addEventListener(FORMS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(FORMS_CHANGED_EVENT, sync);
  }, []);

  async function shareForm(id: string, formName: string | undefined, targetSettings: LayoutSettings) {
    setError(null);
    const url = buildShareFormUrl(window.location.origin, { name: formName, settings: targetSettings });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setManualShareUrl(null);
        setCopiedId(id);
        setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2500);
        return;
      }
    } catch {
      /* fallback below */
    }
    setManualShareUrl(url);
  }

  function handleSave() {
    setError(null);
    try {
      saveSheetForm({ name, settings });
      setName("");
      setSaving(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function applyForm(saved: SavedSheetForm) {
    onApply({ ...saved.settings, templateId: settings.templateId });
  }

  return (
    <section aria-label="Saved Answer Sheets" className="v-panel space-y-3 p-4" data-testid="saved-forms-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Saved Answer Sheets</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Reuse standardized layouts or share with co-teachers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="share-form-btn"
            className="v-btn min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11"
            onClick={() => void shareForm("current", settings.title, settings)}
          >
            {copiedId === "current" ? "Share Link Copied" : "Share Form"}
          </button>
          <button
            type="button"
            data-testid="open-save-form-btn"
            className="v-btn v-btn-primary min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11"
            onClick={() => {
              setError(null);
              setName((cur) => cur || settings.title.trim());
              setSaving((v) => !v);
            }}
          >
            {saving ? "Close" : "Save Current"}
          </button>
        </div>
      </div>

      {saving && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3" data-testid="save-form-box">
          <label htmlFor="saved-form-name" className="block text-xs font-medium">Form name</label>
          <div className="flex flex-wrap gap-2">
            <input
              id="saved-form-name"
              data-testid="saved-form-name-input"
              type="text"
              maxLength={MAX_FORM_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CAS 50-Item Midterm Sheet"
              className="v-input min-h-9 min-w-0 flex-1 text-sm [@media(pointer:coarse)]:min-h-11"
            />
            <button
              type="button"
              data-testid="confirm-save-form-btn"
              className="v-btn v-btn-primary min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11"
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {manualShareUrl && (
        <div className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3" data-testid="manual-share-url">
          <p className="text-xs font-medium">Copy this Share Form link for co-teachers:</p>
          <input
            type="text"
            readOnly
            value={manualShareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="v-input v-mono min-h-9 w-full text-xs [@media(pointer:coarse)]:min-h-11"
            aria-label="Share Form URL"
          />
        </div>
      )}

      {forms.length === 0 ? (
        <p className="text-xs text-zinc-500" data-testid="saved-forms-empty">
          No saved forms yet. Save this layout to reuse it across exams.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="saved-forms-list">
          {forms.map((f) => (
            <li
              key={f.id}
              data-testid={`saved-form-item-${f.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-[11px] text-zinc-500">
                  {formQuestionCount(f.settings)} items · {f.settings.paper} · {f.settings.columns} col
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="v-btn min-h-9 px-2.5 text-xs [@media(pointer:coarse)]:min-h-11"
                  onClick={() => applyForm(f)}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="v-btn min-h-9 px-2.5 text-xs [@media(pointer:coarse)]:min-h-11"
                  onClick={() => void shareForm(f.id, f.name, f.settings)}
                >
                  {copiedId === f.id ? "Copied" : "Share"}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  className="v-btn min-h-9 px-2.5 text-xs text-red-600 dark:text-red-400 [@media(pointer:coarse)]:min-h-11"
                  onClick={() => deleteSavedForm(f.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
