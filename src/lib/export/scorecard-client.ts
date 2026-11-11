import type { ScorecardInput } from "./scorecard-generator";

let worker: Worker | null = null;
let seq = 0;

/** Generate scorecards in a dedicated worker; resolves with the PDF bytes. */
export function renderScorecards(cards: ScorecardInput[], title: string): Promise<Uint8Array> {
  worker ??= new Worker(new URL("../../workers/scorecard.worker.ts", import.meta.url));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const w = worker!;
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; bytes?: Uint8Array; error?: string }>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (e.data.ok && e.data.bytes) resolve(e.data.bytes);
      else reject(new Error(e.data.error ?? "scorecard generation failed"));
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ id, cards, title });
  });
}
