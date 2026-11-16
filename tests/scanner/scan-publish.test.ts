import { describe, expect, it, vi } from "vitest";
import { PublishGate } from "@/lib/scan-publish";

describe("PublishGate (hold a scan's save-to-sync step until the teacher keeps it)", () => {
  it("does nothing until released, then runs exactly once", async () => {
    const gate = new PublishGate();
    const fn = vi.fn();
    gate.hold(1, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(gate.has(1)).toBe(true);
    await gate.release(1);
    await gate.release(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(gate.has(1)).toBe(false);
  });

  it("discard drops it so it never runs, and says whether it was pending", async () => {
    const gate = new PublishGate();
    const fn = vi.fn();
    gate.hold(1, fn);
    expect(gate.discard(1)).toBe(true);
    expect(gate.discard(1)).toBe(false);
    await gate.release(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("releaseAll flushes everything pending, in the order they were held", async () => {
    const gate = new PublishGate();
    const order: number[] = [];
    gate.hold(1, () => { order.push(1); });
    gate.hold(2, async () => { order.push(2); });
    await gate.releaseAll();
    expect(order).toEqual([1, 2]);
    expect(gate.has(1) || gate.has(2)).toBe(false);
  });

  it("one failing publish does not stop the others", async () => {
    const gate = new PublishGate();
    const ok = vi.fn();
    gate.hold(1, () => { throw new Error("boom"); });
    gate.hold(2, ok);
    await gate.releaseAll();
    expect(ok).toHaveBeenCalled();
  });
});
