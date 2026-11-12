import { describe, expect, it } from "vitest";
import { ACK_KEY, readAck, writeAck } from "@/lib/acknowledgment";

const mem = () => { const m = new Map<string, string>(); return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }; };

describe("institutional acknowledgment storage", () => {
  it("uses the agreed key and starts unacknowledged", () => {
    expect(ACK_KEY).toBe("veritas_edtech_cict_ack_v1");
    expect(readAck(mem().s)).toBe(false);
  });
  it("persists once acknowledged", () => {
    const { m, s } = mem();
    expect(writeAck(s)).toBe(true);
    expect(m.get(ACK_KEY)).toBe("1");
    expect(readAck(s)).toBe(true);
  });
  it("blocked storage means the modal is shown again rather than silently skipped", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readAck(broken)).toBe(false);
    expect(writeAck(broken)).toBe(false);
    expect(readAck(null)).toBe(false);
    expect(writeAck(null)).toBe(false);
  });
  it("ignores unrelated values", () => {
    const { m, s } = mem(); m.set(ACK_KEY, "0");
    expect(readAck(s)).toBe(false);
  });
});
