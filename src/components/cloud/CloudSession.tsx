"use client";
/**
 * Cloud session (only mounted when Convex is configured): auth state, the signed-in teacher,
 * school + exam selection, and the scan uploader used by /scan.
 */
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ScanSubmitResult } from "../../../convex/grading";
import { compactReadouts } from "@/lib/cloud/convert";
import { setDevToken } from "@/lib/cloud/dev-auth";
import { type OMRTemplate, OMRTemplateSchema } from "@/lib/omr/schema";
import { getScan } from "@/lib/storage/scan-store";
import { identity } from "@/lib/sync/local-sync";
import type { SyllabusPlan } from "@/lib/syllabus/plan-store";
import type { ScanOutput } from "@/lib/vision/scan-sheet";

const SELECTION_KEY = "omr:cloudSelection";
const PENDING_KEY = "omr:cloudPendingUploads";

interface Selection { orgId: Id<"orgs"> | null; examId: Id<"exams"> | null; layoutHash: string | null }

export interface CloudSessionValue {
  authMode: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  me: { _id: Id<"users">; name?: string; email?: string } | null | undefined;
  /** server's verdict on the signed-in account (institutional allowlist) */
  access: { signedIn: boolean; allowed: boolean; email?: string | null; code?: string; message?: string; domains: string[] } | undefined;
  signInDev: (token: string) => void;
  signOut: () => void;
  orgs: { _id: Id<"orgs">; name: string; role: string }[] | undefined;
  exams: { _id: Id<"exams">; name: string; layoutHash: string; status: string; currentKeyVersion: number }[] | undefined;
  selection: Selection;
  selectOrg: (orgId: Id<"orgs"> | null) => void;
  selectExam: (examId: Id<"exams"> | null) => void;
  /** template of the selected exam (validated), undefined while loading */
  examTemplate: OMRTemplate | null | undefined;
  createOrg: (name: string) => Promise<Id<"orgs">>;
  /** with a syllabus plan the exam is bound to the (saved or updated) syllabus and its TOS outcome codes */
  createExam: (name: string, template: OMRTemplate, plan?: SyllabusPlan | null) => Promise<Id<"exams">>;
  addTeacher: (email: string, role: "teacher" | "admin" | "viewer") => Promise<void>;
  /** upload one scanned sheet (+ de-warped preview) to the selected exam */
  uploadScan: (s: { sheetId: string; result: ScanOutput; preview: Blob | null }) => Promise<ScanSubmitResult | null>;
  pendingUploads: number;
}

const Ctx = createContext<CloudSessionValue | null>(null);
/** null when Convex is not configured (local-only mode) */
export const useCloudSession = () => useContext(Ctx);

function readSelection(): Selection {
  try { return { orgId: null, examId: null, layoutHash: null, ...JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "{}") }; } catch { return { orgId: null, examId: null, layoutHash: null }; }
}
const readPending = (): string[] => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]"); } catch { return []; } };
const writePending = (ids: string[]) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(ids)])); } catch { /* ignore */ } };

export function CloudSessionProvider({ authMode, children }: { authMode: string; children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [selection, setSelection] = useState<Selection>({ orgId: null, examId: null, layoutHash: null });
  const [pendingUploads, setPendingUploads] = useState(0);
  useEffect(() => { setSelection(readSelection()); setPendingUploads(readPending().length); }, []);
  const persist = (s: Selection) => { setSelection(s); try { localStorage.setItem(SELECTION_KEY, JSON.stringify(s)); } catch { /* ignore */ } };

  const access = useQuery(api.users.accessStatus, isAuthenticated ? {} : "skip");
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const storeUser = useMutation(api.users.store);
  const stored = useRef(false);
  useEffect(() => {
    if (isAuthenticated && access?.allowed && me === null && !stored.current) { stored.current = true; storeUser({}).catch(() => { stored.current = false; }); }
    if (!isAuthenticated) stored.current = false;
  }, [isAuthenticated, access?.allowed, me, storeUser]);

  const ready = isAuthenticated && !!me;
  const orgs = useQuery(api.orgs.listMine, ready ? {} : "skip");
  const exams = useQuery(api.exams.listByOrg, ready && selection.orgId ? { orgId: selection.orgId } : "skip");
  const examDoc = useQuery(api.exams.get, ready && selection.examId ? { examId: selection.examId } : "skip");
  const examTemplate = useMemo(() => {
    if (examDoc === undefined) return selection.examId ? undefined : null;
    const p = OMRTemplateSchema.safeParse(examDoc?.template);
    return p.success ? p.data : null;
  }, [examDoc, selection.examId]);

  // forget a selection that no longer exists / is no longer accessible
  useEffect(() => {
    if (orgs && selection.orgId && !orgs.some((o) => o._id === selection.orgId)) persist({ orgId: null, examId: null, layoutHash: null });
  }, [orgs, selection.orgId]);

  const createOrgM = useMutation(api.orgs.create);
  const createExamM = useMutation(api.exams.create);
  const upsertSyllabusM = useMutation(api.syllabi.upsert);
  const addMemberM = useMutation(api.orgs.addMember);
  const uploadUrlM = useMutation(api.grading.generateUploadUrl);
  const submitM = useMutation(api.grading.submitScanBatch);

  const uploadScan = useCallback<CloudSessionValue["uploadScan"]>(async ({ sheetId, result, preview }) => {
    const sel = readSelection();
    if (!sel.examId || sel.layoutHash !== result.layoutHash || !examTemplate) return null;
    try {
      let previewStorageId: Id<"_storage"> | undefined;
      if (preview) {
        const url = await uploadUrlM({ examId: sel.examId });
        const r = await fetch(url, { method: "POST", headers: { "content-type": preview.type || "image/jpeg" }, body: preview });
        if (r.ok) previewStorageId = (await r.json()).storageId;
      }
      const page = examTemplate.pages[result.pageIndex] ?? examTemplate.pages[0];
      const [res] = await submitM({
        examId: sel.examId, deviceId: identity().deviceId,
        scans: [{
          clientScanId: sheetId, layoutHash: result.layoutHash, pageIndex: result.pageIndex, fields: result.fields,
          rawBubbleReadouts: compactReadouts(page, result.bubbles),
          confidence: result.bubbles.length ? Math.min(...result.bubbles.map((b) => b.confidence)) : 0,
          scanTimestamp: Date.now(), ...(previewStorageId ? { previewStorageId } : {}),
        }],
      });
      writePending(readPending().filter((x) => x !== sheetId));
      setPendingUploads(readPending().length);
      return res;
    } catch (e) {
      writePending([...readPending(), sheetId]);           // offline / server error: retried on next load
      setPendingUploads(readPending().length);
      throw e;
    }
  }, [examTemplate, submitM, uploadUrlM]);

  // retry uploads that failed earlier (sheets are still in IndexedDB)
  const retried = useRef(false);
  useEffect(() => {
    if (!ready || !examTemplate || retried.current) return;
    retried.current = true;
    (async () => {
      for (const id of readPending()) {
        const s = await getScan(id).catch(() => undefined);
        if (!s) { writePending(readPending().filter((x) => x !== id)); continue; }
        await uploadScan({ sheetId: s.sheetId, result: s.result, preview: s.preview }).catch(() => {});
      }
      setPendingUploads(readPending().length);
    })();
  }, [ready, examTemplate, uploadScan]);

  const value: CloudSessionValue = {
    authMode, isLoading, isAuthenticated, me, access,
    signInDev: (t) => setDevToken(t), signOut: () => setDevToken(null),
    orgs, exams, selection, examTemplate,
    selectOrg: (orgId) => persist({ orgId, examId: null, layoutHash: null }),
    selectExam: (examId) => persist({ ...selection, examId, layoutHash: exams?.find((e) => e._id === examId)?.layoutHash ?? null }),
    createOrg: async (name) => { const id = await createOrgM({ name }); persist({ orgId: id, examId: null, layoutHash: null }); return id; },
    createExam: async (name, template, plan) => {
      const orgId = selection.orgId!;
      const usePlan = plan && plan.tos.totalQuestions === template.questionCount ? plan : null;
      const syllabusId = usePlan ? await upsertSyllabusM({ orgId, syllabus: usePlan.syllabus }) : undefined;
      const id = await createExamM({ orgId, name, template, ...(usePlan && syllabusId ? { syllabusId, examPeriod: usePlan.period, questionOutcomes: usePlan.assignments } : {}) });
      persist({ ...selection, examId: id, layoutHash: template.layoutHash });
      return id;
    },
    addTeacher: async (email, role) => { await addMemberM({ orgId: selection.orgId!, email, role }); },
    uploadScan, pendingUploads,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
