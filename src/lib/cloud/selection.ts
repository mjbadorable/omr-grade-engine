/**
 * Pure guard for persisted cloud selection (localStorage).
 * Prevents queries like `exams.get` from firing with a stale, deleted, or cross-deployment ID
 * before `orgs.listMine` and `exams.listByOrg` confirm the ID exists in the active workspace.
 */
export interface CloudSelectionIds<O extends string = string, E extends string = string> {
  orgId: O | null;
  examId: E | null;
  layoutHash: string | null;
}

export function resolveCloudSelection<O extends string, E extends string>(i: {
  ready: boolean;
  defaultOrgId: O | null;
  selection: CloudSelectionIds<O, E>;
  exams: readonly { _id: E; layoutHash: string }[] | undefined;
}): CloudSelectionIds<O, E> {
  if (!i.ready || !i.defaultOrgId) {
    return { orgId: null, examId: null, layoutHash: null };
  }
  if (i.selection.orgId !== i.defaultOrgId || !i.selection.examId || !i.exams) {
    return { orgId: i.defaultOrgId, examId: null, layoutHash: null };
  }
  const match = i.exams.find((e) => e._id === i.selection.examId);
  if (!match) {
    return { orgId: i.defaultOrgId, examId: null, layoutHash: null };
  }
  return { orgId: i.defaultOrgId, examId: match._id, layoutHash: match.layoutHash };
}
