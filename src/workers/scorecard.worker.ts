/** Scorecard PDFs are built off the UI thread (hundreds of pages can take seconds). */
import { generateScorecardsPdf, type ScorecardInput } from "@/lib/export/scorecard-generator";

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<{ id: number; cards: ScorecardInput[]; title: string }>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { id, cards, title } = e.data;
  try {
    const bytes = await generateScorecardsPdf(cards, { title });
    ctx.postMessage({ id, ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
