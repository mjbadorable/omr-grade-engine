// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Scan preview uploads are checked on the server: size, image type, and blobs that fail are deleted. */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { MAX_PREVIEW_BYTES, previewProblem } from "../../convex/lib/uploads";
import { createOrg } from "../helpers/org";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import type { DecodedFields } from "@/lib/vision/types";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const readouts = { states: "E", density: [0], confidence: [0.9] };
const fields = (roll: string): DecodedFields => ({ rollNumber: roll, rollDigits: [...roll], examSet: "A", numeric: [], matrix: [], conflicts: [], answers: [{ questionNumber: 1, marked: [0], labels: ["A"], uncertain: false }] });
const scan = (id: string, roll: string, previewStorageId?: Id<"_storage">) => ({
  clientScanId: id, layoutHash: kit.template.layoutHash, pageIndex: 0, fields: fields(roll), rawBubbleReadouts: readouts, confidence: 0.9, scanTimestamp: 1000,
  ...(previewStorageId ? { previewStorageId } : {}),
});

async function setup() {
  const t = convexTest(schema, modules);
  const teacher = t.withIdentity({ subject: "t1", name: "T1", email: "t1@usa.edu.ph", emailVerified: true });
  await teacher.mutation(api.users.store, {});
  const orgId = await createOrg(t, teacher, "USA");
  const examId = await teacher.mutation(api.exams.create, { orgId, name: "Quiz", template: kit.template });
  const blob = (bytes: number, type?: string) => t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], type ? { type } : {})));
  const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
  return { t, teacher, examId, blob, exists };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("previewProblem (pure)", () => {
  it("accepts small JPEG and PNG files", () => {
    expect(previewProblem({ size: 1, contentType: "image/jpeg" })).toBeNull();
    expect(previewProblem({ size: MAX_PREVIEW_BYTES, contentType: "image/png" })).toBeNull();
  });
  it("refuses missing files, oversize files and other types", () => {
    expect(MAX_PREVIEW_BYTES).toBe(2_000_000);
    expect(previewProblem(null)).toBe("MISSING");
    expect(previewProblem({ size: MAX_PREVIEW_BYTES + 1, contentType: "image/jpeg" })).toBe("TOO_LARGE");
    expect(previewProblem({ size: 10, contentType: "text/html" })).toBe("BAD_TYPE");
    expect(previewProblem({ size: 10, contentType: "application/pdf" })).toBe("BAD_TYPE");
    expect(previewProblem({ size: 10 })).toBe("BAD_TYPE");
    expect(previewProblem({ size: 10, contentType: "IMAGE/JPEG" })).toBeNull();      // header casing is not a security signal
  });
});

describe("submitScanBatch preview validation", () => {
  it("stores a scan with a valid JPEG or PNG preview and keeps the file", async () => {
    const { teacher, examId, blob, exists } = await setup();
    const jpeg = await blob(5_000, "image/jpeg"), png = await blob(5_000, "image/png");
    const r = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("a", "1", jpeg), scan("b", "2", png)] });
    expect(r.map((x) => x.status)).toEqual(["stored", "stored"]);
    expect(await exists(jpeg)).toBe(true);
    expect(await exists(png)).toBe(true);
  });

  it("accepts a preview of exactly 2,000,000 bytes but rejects and deletes one byte more", async () => {
    const { teacher, examId, blob, exists } = await setup();
    const ok = await blob(2_000_000, "image/jpeg"), big = await blob(2_000_001, "image/jpeg");
    const r = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("ok", "1", ok), scan("big", "2", big)] });
    expect(r[0].status).toBe("stored");
    expect(r[1]).toMatchObject({ clientScanId: "big", status: "rejected", reason: "INVALID_PREVIEW" });
    expect(await exists(ok)).toBe(true);
    expect(await exists(big)).toBe(false);
  });

  it("rejects and deletes files that are not JPEG or PNG images", async () => {
    const { teacher, examId, blob, exists } = await setup();
    const html = await blob(100, "text/html"), pdf = await blob(100, "application/pdf"), untyped = await blob(100);
    const r = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("h", "1", html), scan("p", "2", pdf), scan("u", "3", untyped)] });
    expect(r.map((x) => (x.status === "rejected" ? x.reason : x.status))).toEqual(["INVALID_PREVIEW", "INVALID_PREVIEW", "INVALID_PREVIEW"]);
    for (const id of [html, pdf, untyped]) expect(await exists(id)).toBe(false);
  });

  it("rejects a preview id that no longer exists without failing the whole batch", async () => {
    const { t, teacher, examId, blob } = await setup();
    const gone = await blob(100, "image/jpeg");
    await t.run((ctx) => ctx.storage.delete(gone));
    const r = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("g", "1", gone), scan("n", "2")] });
    expect(r[0]).toMatchObject({ status: "rejected", reason: "INVALID_PREVIEW" });
    expect(r[1].status).toBe("stored");
  });

  it("does not store a scan whose preview was rejected", async () => {
    const { teacher, examId, blob } = await setup();
    const bad = await blob(100, "text/plain");
    await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("x", "1", bad), scan("y", "2")] });
    const list = await teacher.query(api.grading.listScans, { examId, paginationOpts: { numItems: 10, cursor: null } });
    expect(list.page.map((s) => s.clientScanId)).toEqual(["y"]);
  });
});
