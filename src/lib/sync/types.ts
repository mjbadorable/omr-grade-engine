/**
 * Offline-first sync contracts.
 *
 * Every local mutation is appended to an outbox with a monotonic per-device `seq`, a globally
 * unique `id` (idempotency key) and the client timestamp. A SyncDriver pushes entries in `seq`
 * order and pulls other devices' entries after a server cursor. Nothing is ever overwritten:
 * scans and override patches are append-only, so two teachers' work always merges, and
 * divergent scans of one student surface as review conflicts.
 */
import type { AnswerKeyJson } from "@/lib/grading/answer-key";
import type { ManualOverridePatch } from "@/lib/review/overrides";
import type { Roster } from "@/lib/roster/schema";
import type { DecodedFields } from "@/lib/vision/types";

export interface ScanCreatedPayload {
  sheetId: string;
  layoutHash: string;
  templateId: string;
  name: string;
  createdAt: number;
  fields: DecodedFields;
}

export interface ConflictResolution {
  id: string;
  layoutHash: string;
  rollKey: string;
  keepSheetId: string;
  supersededSheetIds: string[];
  teacherId: string;
  timestamp: number;
}

export interface MutationPayloads {
  "scan.created": ScanCreatedPayload;
  "key.version": AnswerKeyJson;
  "override.added": ManualOverridePatch;
  "roster.imported": Roster;
  "conflict.resolved": ConflictResolution;
}
export type MutationKind = keyof MutationPayloads;

export interface OutboxEntry<K extends MutationKind = MutationKind> {
  /** monotonic per device, starts at 1, never reused */
  seq: number;
  /** idempotency key (UUID) */
  id: string;
  kind: K;
  /** grouping scope, e.g. a template layoutHash */
  scope: string;
  payload: MutationPayloads[K];
  deviceId: string;
  teacherId: string;
  clientTs: number;
  status: "pending" | "acked" | "rejected";
  ackedAt?: number;
  error?: string;
}

/** Entry as stored by the server and handed to other devices. */
export type RemoteEntry = Omit<OutboxEntry, "status" | "ackedAt" | "error"> & { serverSeq: number };

export interface PushResult {
  acked: string[];
  rejected: { id: string; reason: string }[];
}

export interface PullResult {
  changes: RemoteEntry[];
  cursor: string;
}

/** Pluggable transport (REST, WebSocket, Convex, …). Must be idempotent on entry `id`. */
export interface SyncDriver {
  readonly name: string;
  push(entries: readonly OutboxEntry[]): Promise<PushResult>;
  pull(cursor: string | null, limit: number): Promise<PullResult>;
}

/** Persistence used by the outbox (IndexedDB in the browser, memory in tests). */
export interface OutboxStore {
  put(entry: OutboxEntry): Promise<void>;
  all(): Promise<OutboxEntry[]>;
  maxSeq(): Promise<number>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}
