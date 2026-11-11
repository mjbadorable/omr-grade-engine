import { describe, expect, it } from "vitest";
import { applyOverrides, makePatch } from "@/lib/review/overrides";
import { detectConflicts, sheetDisposition, type SyncedSheet } from "@/lib/sync/conflicts";
import { LoopbackDriver, LoopbackServer } from "@/lib/sync/drivers";
import { MemoryOutboxStore, Outbox, SyncEngine } from "@/lib/sync/sync-outbox";
import type { ConflictResolution, RemoteEntry, ScanCreatedPayload } from "@/lib/sync/types";
import type { DecodedFields } from "@/lib/vision/types";

const fields = (roll: string, answers: number[][]): DecodedFields => ({
  rollNumber: roll, rollDigits: [...roll], examSet: "A", numeric: [], matrix: [], conflicts: [],
  answers: answers.map((m, i) => ({ questionNumber: i + 1, marked: m, labels: m.map((x) => "ABCD"[x]), uncertain: false })),
});
const sheet = (sheetId: string, deviceId: string, f: DecodedFields, createdAt = 0): SyncedSheet => ({ sheetId, layoutHash: "L", deviceId, teacherId: `t-${deviceId}`, createdAt, fields: f });

describe("detectConflicts", () => {
  it("flags two teachers' divergent scans of one roll number for review", () => {
    const g = detectConflicts([
      sheet("a1", "A", fields("0042", [[0], [1], [2]]), 1),
      sheet("b1", "B", fields("42", [[0], [3], [2]]), 2),       // same student, Q2 differs
      sheet("c1", "A", fields("43", [[0], [0], [0]]), 3),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ rollKey: "42", kind: "DIVERGENT_ANSWERS", crossDevice: true, teachers: ["t-A", "t-B"], differingQuestions: [2], resolution: null });
    expect([...sheetDisposition(g)]).toEqual([["a1", "conflict"], ["b1", "conflict"]]);
  });

  it("treats identical rescans as a harmless duplicate (earliest counts)", () => {
    const g = detectConflicts([sheet("x2", "B", fields("7", [[1]]), 5), sheet("x1", "A", fields("7", [[1]]), 1)]);
    expect(g[0].kind).toBe("DUPLICATE_IDENTICAL");
    expect(Object.fromEntries(sheetDisposition(g))).toEqual({ x1: "counts", x2: "duplicate" });
  });

  it("uses effective (overridden) answers: a teacher fix can dissolve a conflict", () => {
    const a = fields("9", [[0], [1]]);
    const b = fields("9", [[0], []]);
    expect(detectConflicts([sheet("a", "A", a), sheet("b", "B", b)])[0].kind).toBe("DIVERGENT_ANSWERS");
    const fixed = applyOverrides(b, [makePatch({ sheetId: "b", target: "answer", questionNumber: 2, overriddenOption: [1], originalState: {}, reason: "", teacherId: "t" })]);
    expect(detectConflicts([sheet("a", "A", a), sheet("b", "B", fixed)])[0].kind).toBe("DUPLICATE_IDENTICAL");
  });

  it("an administrative resolution keeps one sheet; a later scan reopens the case", () => {
    const s = [sheet("a", "A", fields("5", [[0]]), 1), sheet("b", "B", fields("5", [[2]]), 2)];
    const res: ConflictResolution = { id: "r1", layoutHash: "L", rollKey: "5", keepSheetId: "b", supersededSheetIds: ["a"], teacherId: "admin", timestamp: 10 };
    const g = detectConflicts(s, [res]);
    expect(g[0].resolution?.id).toBe("r1");
    expect(Object.fromEntries(sheetDisposition(g))).toEqual({ a: "superseded", b: "counts" });
    const reopened = detectConflicts([...s, sheet("c", "C", fields("5", [[3]]), 3)], [res]);
    expect(reopened[0].resolution).toBeNull();
    expect(new Set(sheetDisposition(reopened).values())).toEqual(new Set(["conflict"]));
  });
});

describe("two devices through the sync layer", () => {
  it("both scans survive the round-trip and are flagged, never overwritten", async () => {
    const server = new LoopbackServer();
    const mk = (id: string) => {
      const sheets: SyncedSheet[] = [];
      const outbox = new Outbox(new MemoryOutboxStore(), { deviceId: id, teacherId: `t-${id}` });
      const engine = new SyncEngine(outbox, new LoopbackDriver(server), async (changes: RemoteEntry[]) => {
        for (const c of changes) if (c.kind === "scan.created") {
          const p = c.payload as ScanCreatedPayload;
          sheets.push({ sheetId: p.sheetId, layoutHash: p.layoutHash, deviceId: c.deviceId, teacherId: c.teacherId, createdAt: p.createdAt, fields: p.fields });
        }
      });
      const scan = async (sheetId: string, f: DecodedFields, createdAt: number) => {
        sheets.push({ sheetId, layoutHash: "L", deviceId: id, teacherId: `t-${id}`, createdAt, fields: f });
        await outbox.append("scan.created", "L", { sheetId, layoutHash: "L", templateId: "T", name: sheetId, createdAt, fields: f });
      };
      return { sheets, engine, scan };
    };
    const A = mk("A"), B = mk("B");
    await A.scan("a1", fields("0042", [[0], [1]]), 1);   // offline on both devices
    await B.scan("b1", fields("42", [[0], [2]]), 2);
    await A.engine.syncOnce();
    await B.engine.syncOnce();
    await A.engine.syncOnce();
    for (const dev of [A, B]) {
      expect(dev.sheets.map((s) => s.sheetId).sort()).toEqual(["a1", "b1"]);
      const g = detectConflicts(dev.sheets);
      expect(g).toHaveLength(1);
      expect(g[0]).toMatchObject({ kind: "DIVERGENT_ANSWERS", crossDevice: true, differingQuestions: [2] });
    }
  });
});
