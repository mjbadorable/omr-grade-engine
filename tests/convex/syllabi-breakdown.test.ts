// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** The rich syllabus breakdown (overview, exams, M0, lecture/lab, AGA) round-trips through Convex and stays bounded. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { createOrg } from "../helpers/org";
import { parseSyllabusPages, parseSyllabusText, type PdfPageItems } from "@/lib/syllabus/parse-syllabus";
import fixture from "../syllabus/fixtures/hm5-items.json";
import { IT321_TEXT } from "../syllabus/fixtures/it321";

const modules = import.meta.glob("../../convex/**/*.ts");
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };
const pages: PdfPageItems[] = (fixture.pages as { width: number; height: number; items: [string, number, number, number, number][] }[])
  .map((p) => ({ width: p.width, height: p.height, items: p.items.map(([str, x, y, w, size]) => ({ str, x, y, w, size })) }));
const FILE = "1st Sem AY 2025-2026 UPDATED-HM5-Syllabi-Template-Pure-Lec_Lab.docx.pdf";
const hm5 = parseSyllabusPages(pages, { fileName: FILE }).syllabus;
const clase = parseSyllabusText(IT321_TEXT).syllabus;

async function world() {
  const t = convexTest(schema, modules);
  const as = (id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
  const owner = as("owner"), teacher = as("t1");
  for (const u of [owner, teacher]) await u.mutation(api.users.store, {});
  const orgId = await createOrg(t, owner, "USA");
  await owner.mutation(api.orgs.addMember, { orgId, email: "t1@usa.edu.ph", role: "teacher" });
  return { t, teacher, orgId };
}

describe("syllabi.upsert with the COB/COC breakdown", () => {
  it("stores and returns the overview, exams, M0, lecture/lab and AGA data unchanged", async () => {
    const { teacher, orgId } = await world();
    const id = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus: hm5 });
    const got = await teacher.query(api.syllabi.get, { syllabusId: id });
    expect(got?.overview).toEqual(hm5.overview);
    expect(got?.exams).toEqual(hm5.exams);
    expect(got?.graduateAttributes).toEqual(hm5.graduateAttributes);
    expect(got?.courseOutcomes[0].agaLinks).toEqual(["B", "C"]);
    expect(got?.modules[0]).toMatchObject({ number: 0, assessed: false });
    expect(got?.modules[1].lecture).toEqual({ tla: ["Lecture discussion", "Case Study Analysis"], assessments: ["Quiz", "Group Activity"], hours: 2 });
    expect(got?.modules[1].lab?.hours).toBe(6);
  });

  it("an older CLASE syllabus (none of the new fields) still saves and reads back identical", async () => {
    const { teacher, orgId } = await world();
    const id = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus: clase });
    expect(await teacher.query(api.syllabi.get, { syllabusId: id })).toEqual(clase);
  });

  it("re-dropping the same course and term with a plainer syllabus clears the old overview and exams", async () => {
    const { teacher, orgId } = await world();
    const id = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus: hm5 });
    const plain = { ...hm5, overview: undefined, exams: undefined, graduateAttributes: undefined };
    delete (plain as Record<string, unknown>).overview; delete (plain as Record<string, unknown>).exams; delete (plain as Record<string, unknown>).graduateAttributes;
    const again = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus: plain });
    expect(again).toBe(id);
    const got = await teacher.query(api.syllabi.get, { syllabusId: id });
    expect(got?.overview).toBeUndefined();
    expect(got?.exams).toBeUndefined();
    expect(got?.graduateAttributes).toBeUndefined();
  });

  it("still validates the new fields on the server (the Convex validator alone would accept these)", async () => {
    const { teacher, orgId } = await world();
    const longLo = structuredClone(hm5); longLo.modules[1].learningOutcomes![0].description = "d".repeat(501);
    expect(await code(teacher.mutation(api.syllabi.upsert, { orgId, syllabus: longLo }))).toBe("INVALID_SYLLABUS");
    const manyTla = structuredClone(hm5); manyTla.modules[1].lecture!.tla = Array.from({ length: 21 }, () => "t");
    expect(await code(teacher.mutation(api.syllabi.upsert, { orgId, syllabus: manyTla }))).toBe("INVALID_SYLLABUS");
    const badExam = structuredClone(hm5); badExam.exams![0].coverage = [1.5];
    expect(await code(teacher.mutation(api.syllabi.upsert, { orgId, syllabus: badExam }))).toBe("INVALID_SYLLABUS");
  });

  it("refuses a syllabus too large for one document", async () => {
    const { teacher, orgId } = await world();
    const big = structuredClone(clase);
    big.modules = Array.from({ length: 40 }, (_, i) => ({ number: i + 1, title: "t", topics: Array.from({ length: 200 }, () => "x".repeat(100)), courseOutcomes: [], period: "PRELIM" as const }));
    expect(await code(teacher.mutation(api.syllabi.upsert, { orgId, syllabus: big }))).toBe("INVALID_SYLLABUS");
  });
});
