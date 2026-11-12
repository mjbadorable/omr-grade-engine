/** Adapter: the outbox executor's CloudApi on top of the real Convex client. */
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { compactReadouts, type AnswerKeyBody } from "@/lib/cloud/convert";
import { OMRTemplateSchema } from "@/lib/omr/schema";
import { getScan } from "@/lib/storage/scan-store";
import type { CloudApi } from "@/lib/sync/cloud-executor";
import { identity } from "@/lib/sync/local-sync";

export function convexCloudApi(convex: ConvexReactClient): CloudApi {
  return {
    updateKey: ({ examId, baseVersion, key, clientKeyId }) => convex.mutation(api.grading.updateAnswerKey, { examId: examId as Id<"exams">, baseVersion, key, clientKeyId }),
    async getKey(examId) {
      const d = await convex.query(api.grading.getAnswerKey, { examId: examId as Id<"exams"> });
      if (!d) return null;
      const { questions, sets, defaultSet, gradeBands, conflictPolicy } = d;
      return { version: d.version, body: JSON.parse(JSON.stringify({ questions, sets, defaultSet, gradeBands, conflictPolicy })) as AnswerKeyBody };
    },
    addOverrides: (examId, patches) => convex.mutation(api.grading.addOverrides, { examId: examId as Id<"exams">, patches: patches.map((p) => ({ ...p, scanId: p.scanId as Id<"scans"> })) }),
    resolveConflict: ({ examId, rollKey, keepScanId, clientId, timestamp }) => convex.mutation(api.grading.resolveConflict, { examId: examId as Id<"exams">, rollKey, keepScanId: keepScanId as Id<"scans">, clientId, timestamp }),
    async uploadScan(op) {
      const examId = op.examId as Id<"exams">;
      const s = await getScan(op.payload.sheetId).catch(() => undefined);
      if (!s) return null;
      const doc = await convex.query(api.exams.get, { examId });
      const tpl = OMRTemplateSchema.safeParse(doc?.template);
      if (!tpl.success || tpl.data.layoutHash !== s.layoutHash) return null;      // sheet belongs to another layout
      let previewStorageId: Id<"_storage"> | undefined;
      if (s.preview) {
        const url = await convex.mutation(api.grading.generateUploadUrl, { examId });
        const r = await fetch(url, { method: "POST", headers: { "content-type": s.preview.type || "image/jpeg" }, body: s.preview });
        if (r.ok) previewStorageId = (await r.json()).storageId;
      }
      const result = s.result;
      const page = tpl.data.pages[result.pageIndex] ?? tpl.data.pages[0];
      const [res] = await convex.mutation(api.grading.submitScanBatch, {
        examId, deviceId: identity().deviceId,
        scans: [{
          clientScanId: s.sheetId, layoutHash: result.layoutHash, pageIndex: result.pageIndex, fields: result.fields,
          rawBubbleReadouts: compactReadouts(page, result.bubbles),
          confidence: result.bubbles.length ? Math.min(...result.bubbles.map((b) => b.confidence)) : 0,
          scanTimestamp: op.ts, ...(previewStorageId ? { previewStorageId } : {}),
        }],
      });
      return res;
    },
  };
}
