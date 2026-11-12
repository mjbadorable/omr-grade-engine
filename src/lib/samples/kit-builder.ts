/**
 * Sample Exam Kit (browser part): rasterise the marked sheets into photo-like JPEGs (tilt,
 * desk background, uneven light, sensor noise) and zip the kit.
 */
import { strToU8, zipSync } from "fflate";
import { serializeKey } from "@/lib/grading/answer-key";
import { mulberry32 } from "@/lib/grading/simulate";
import { generatePdf } from "@/lib/omr/pdf-generator";
import { rosterToCsv } from "@/lib/roster/importer";
import { buildSampleExam, pageToSvg } from "./sample-kit";

async function svgToImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Photo-like JPEG: sheet at ~5.5 px/mm, rotated a few degrees on a darker desk, with a light gradient and noise. */
export async function photographSvg(svg: string, paperMm: { w: number; h: number }, seed: number): Promise<Blob> {
  const img = await svgToImage(svg);
  const rnd = mulberry32(seed);
  const pxPerMm = 5.5;
  const sw = paperMm.w * pxPerMm, sh = paperMm.h * pxPerMm;
  const W = Math.round(sw * 1.18), H = Math.round(sh * 1.12);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6b6258"; // desk
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2 + (rnd() - 0.5) * 40, H / 2 + (rnd() - 0.5) * 40);
  g.rotate(((rnd() - 0.5) * 9 * Math.PI) / 180);
  g.transform(1, 0, (rnd() - 0.5) * 0.04, 1, 0, 0); // slight shear (camera not square to the page)
  g.shadowColor = "rgba(0,0,0,.35)";
  g.shadowBlur = 18;
  g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  g.restore();
  // uneven classroom light: dark corner + soft shadow blob
  const lg = g.createLinearGradient(0, 0, W, H);
  lg.addColorStop(0, "rgba(0,0,0,0.38)");
  lg.addColorStop(0.6, "rgba(0,0,0,0.05)");
  lg.addColorStop(1, "rgba(255,255,240,0.06)");
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W * (0.3 + rnd() * 0.4), H * (0.4 + rnd() * 0.3), 10, W / 2, H / 2, W * 0.6);
  rg.addColorStop(0, "rgba(0,0,0,0.22)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  // sensor noise
  const d = g.getImageData(0, 0, W, H);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
  }
  g.putImageData(d, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.88));
}

export async function buildSampleKitZip(): Promise<Blob> {
  const kit = buildSampleExam();
  const t = kit.template;
  const files: Record<string, Uint8Array> = {};
  files["answer-sheet.pdf"] = await generatePdf(t);
  files["template-coordinates.json"] = strToU8(JSON.stringify(t, null, 2));
  files["answer-key.json"] = strToU8(JSON.stringify(serializeKey(kit.key), null, 2));
  files["roster.csv"] = strToU8(rosterToCsv(kit.roster));
  for (const [i, s] of kit.students.entries()) {
    const svg = pageToSvg(t, 0, s.marks, { handwriting: { name: s.name } });
    const jpg = await photographSvg(svg, { w: t.paper.widthMm, h: t.paper.heightMm }, 100 + i);
    files[`scans/student-${i + 1}-${s.rollNumber}.jpg`] = new Uint8Array(await jpg.arrayBuffer());
  }
  files["README.txt"] = strToU8([
    "VERITAS - Sample Exam Kit",
    "",
    "answer-sheet.pdf           Print at 100% scale (20 questions, roll number, exam set A/B).",
    "template-coordinates.json  Coordinate map of the sheet (load it on the Scan or Grade page).",
    "answer-key.json            Answer key (Grade page → Import key).",
    "roster.csv                 8-student roster (Grade page → Roster → Import roster CSV).",
    "scans/*.jpg                5 simulated phone photos of filled sheets (Scan page → Upload photos).",
    "",
    "Expected: 5 students matched, 3 absent; student 4 has one partial mark on Q5 to review.",
    "",
  ].join("\r\n"));
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: "application/zip" });
}
