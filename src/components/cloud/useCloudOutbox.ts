"use client";
/**
 * React binding for the cloud transaction outbox: one IndexedDB-backed queue per browser, drained
 * automatically when the device comes back online (window `online` event, Convex WebSocket
 * recovery) and on a slow retry timer while anything is still queued.
 */
import { useConvex, useConvexConnectionState } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IdbCloudOpStore } from "@/lib/storage/scan-store";
import { makeExecutor } from "@/lib/sync/cloud-executor";
import { type CloudOp, type CloudOpKind, type CloudOpPayloads, type DrainReport, MemoryCloudOpStore, OfflineOutbox } from "@/lib/sync/offline-outbox";
import { convexCloudApi } from "./convex-cloud-api";

export interface SyncNotice { id: string; kind: CloudOpKind; level: "info" | "warn" | "error"; message: string }

export interface CloudOutboxState {
  /** queued ops not yet acknowledged by the server */
  pending: number;
  pendingOps: CloudOp[];
  /** ops the server refused (need attention) */
  failed: number;
  /** browser online and the Convex WebSocket connected (or still connecting for the first time) */
  online: boolean;
  draining: boolean;
  notices: SyncNotice[];
  dismissNotice: (id: string) => void;
  enqueue: <K extends CloudOpKind>(kind: K, examId: string, payload: CloudOpPayloads[K], id?: string) => Promise<CloudOp<K>>;
  /** replay everything now; resolves with the report (results per op) */
  drain: () => Promise<DrainReport | null>;
}

const RETRY_MS = 20_000;

export function useCloudOutbox(enabled: boolean): CloudOutboxState {
  const convex = useConvex();
  const conn = useConvexConnectionState();
  const [browserOnline, setBrowserOnline] = useState(true);
  const [pendingOps, setPendingOps] = useState<CloudOp[]>([]);
  const [failed, setFailed] = useState(0);
  const [draining, setDraining] = useState(false);
  const [notices, setNotices] = useState<SyncNotice[]>([]);

  const outbox = useMemo(() => new OfflineOutbox(typeof indexedDB === "undefined" ? new MemoryCloudOpStore() : new IdbCloudOpStore()), []);
  const executor = useMemo(() => makeExecutor(convexCloudApi(convex)), [convex]);

  const refresh = useCallback(async () => {
    const [p, f] = await Promise.all([outbox.pending(), outbox.failed()]);
    setPendingOps(p); setFailed(f.length);
  }, [outbox]);
  useEffect(() => { void refresh(); return outbox.subscribe(() => { void refresh(); }); }, [outbox, refresh]);

  // before the first connection completes we are "connecting", not offline (avoids a flash of the offline badge)
  const online = browserOnline && (conn.isWebSocketConnected || !conn.hasEverConnected);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const drain = useCallback(async (): Promise<DrainReport | null> => {
    if (!enabledRef.current || !onlineRef.current) return null;
    setDraining(true);
    try {
      const r = await outbox.drain(executor);
      if (r.notices.length) setNotices((cur) => [...r.notices.filter((n) => n.kind !== "UPLOAD_SCAN" || n.level === "error"), ...cur].slice(0, 20));
      return r;
    } finally { setDraining(false); }
  }, [outbox, executor]);

  // browser connectivity
  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const on = () => { setBrowserOnline(true); void drain(); };
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [drain]);

  // Convex connection recovery (and sign-in becoming ready) → replay
  useEffect(() => { if (enabled && online) void drain(); }, [enabled, online, conn.connectionCount, drain]);

  // slow retry while anything is queued (covers transient server errors while "online")
  useEffect(() => {
    if (!enabled || !pendingOps.length) return;
    const h = setInterval(() => { void drain(); }, RETRY_MS);
    return () => clearInterval(h);
  }, [enabled, pendingOps.length, drain]);

  const enqueue = useCallback<CloudOutboxState["enqueue"]>((kind, examId, payload, id) => outbox.enqueue(kind, examId, payload, id), [outbox]);
  const dismissNotice = useCallback((id: string) => setNotices((cur) => cur.filter((n) => n.id !== id)), []);

  return { pending: pendingOps.length, pendingOps, failed, online, draining, notices, dismissNotice, enqueue, drain };
}
