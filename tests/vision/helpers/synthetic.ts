/**
 * Synthetic answer-sheet photographs with a KNOWN distortion model.
 *
 * renderPage  : rasterises a template page from the same draw list as the PDF, plus pencil
 *               marks (fill / light / partial / erasure) on chosen bubbles.
 * photograph  : maps the page into a camera frame through a perspective homography and a
 *               smooth paper-curl field, then applies an illumination gradient, a soft shadow,
 *               Gaussian sensor noise and blur. Deterministic (seeded PRNG).
 * forward()   : exact page-px → photo-px mapping (Newton inversion of the remap field), used
 *               as ground truth for geometric assertions.
 */
import { collectBubbles } from "@/lib/omr/layout-engine";
import { pagePrimitives } from "@/lib/omr/primitives";
import type { OMRTemplate } from "@/lib/omr/schema";
import type { CV, Mat } from "@/lib/vision/cv";
import { applyHomography, homographyFrom4, invertMat3 } from "@/lib/vision/geometry";
import type { RgbaFrame, Vec2 } from "@/lib/vision/types";

export type MarkKind = "fill" | "light" | "partial" | "erasure" | "pencil";
export type Markings = Record<string, MarkKind>;

const gray = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return Math.round(0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
};

export function renderPage(cv: CV, t: OMRTemplate, pageIndex: number, s: number, marks: Markings = {}): Mat {
  const W = Math.round(t.paper.widthMm * s), H = Math.round(t.paper.heightMm * s);
  const img = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(255));
  const P = (x: number, y: number) => new cv.Point(Math.round(x * s), Math.round(y * s));
  const page = t.pages[pageIndex];
  for (const p of pagePrimitives(t, page)) {
    if (p.t === "rect") {
      if (p.fill) cv.rectangle(img, P(p.x, p.y), P(p.x + p.w, p.y + p.h), new cv.Scalar(gray(p.fill)), -1);
      else cv.rectangle(img, P(p.x, p.y), P(p.x + p.w, p.y + p.h), new cv.Scalar(gray(p.stroke ?? "#666666")), 1);
    } else if (p.t === "circle") {
      cv.circle(img, P(p.cx, p.cy), Math.round(p.r * s), new cv.Scalar(gray(p.stroke)), Math.max(1, Math.round(p.strokeW * s)), cv.LINE_AA);
    } else if (p.t === "line") {
      cv.line(img, P(p.x1, p.y1), P(p.x2, p.y2), new cv.Scalar(gray(p.stroke)), 1);
    } else if (p.t === "text") {
      const scale = (p.size * s) / 30;
      const w = p.text.length * scale * 18;
      const x = p.anchor === "start" ? p.x * s : p.anchor === "end" ? p.x * s - w : p.x * s - w / 2;
      cv.putText(img, p.text.replace(/[^\x20-\x7e]/g, "?"), new cv.Point(Math.round(x), Math.round(p.y * s)), cv.FONT_HERSHEY_SIMPLEX, scale, new cv.Scalar(gray(p.fill)), p.bold ? 2 : 1);
    }
  }
  const [ox, oy] = t.paper.originMm;
  const r = (t.bubble.diameterMm / 2) * s;
  for (const b of collectBubbles(page)) {
    const kind = marks[b.id];
    if (!kind) continue;
    const c = P(b.center[0] + ox, b.center[1] + oy);
    const rr = Math.round(r * 0.86);
    if (kind === "fill") cv.circle(img, c, rr, new cv.Scalar(45), -1, cv.LINE_AA);
    else if (kind === "light") cv.circle(img, c, rr, new cv.Scalar(105), -1, cv.LINE_AA);
    else if (kind === "pencil") cv.circle(img, c, rr, new cv.Scalar(150), -1, cv.LINE_AA);   // faint #2 graphite
    else if (kind === "erasure") cv.circle(img, c, rr, new cv.Scalar(205), -1, cv.LINE_AA);
    else cv.ellipse(img, c, new cv.Size(rr, rr), 0, 90, 270, new cv.Scalar(45), -1, cv.LINE_AA); // left half
  }
  return img;
}

export interface PhotoOptions {
  width: number;
  height: number;
  /** where the page corners (TL, TR, BR, BL) land in the photo */
  quad: [Vec2, Vec2, Vec2, Vec2];
  /** paper curl in mm: global sag + centre bulge (both vary along the sheet height) */
  curlMm?: { sag: number; bulge: number };
  /** multiplicative illumination: left edge factor (right edge = 1) */
  gradientLow?: number;
  /** soft shadow: centre (photo px), sigma (px), depth 0..1 */
  shadow?: { x: number; y: number; sigma: number; depth: number };
  noiseSigma?: number;
  blur?: boolean;
  seed?: number;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Photo {
  frame: RgbaFrame;
  /** exact page px → photo px */
  forward: (p: Vec2) => Vec2;
}

export function photograph(cv: CV, page: Mat, pxPerMm: number, o: PhotoOptions): Photo {
  const W = page.cols, H = page.rows;
  const Hp = homographyFrom4([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], o.quad);
  const Hinv = invertMat3(Hp);
  const sag = (o.curlMm?.sag ?? 0) * pxPerMm;
  const bulge = (o.curlMm?.bulge ?? 0) * pxPerMm;
  /** photo px → flat page px (the remap field) */
  const inverse = (q: Vec2): Vec2 => {
    const u = applyHomography(Hinv, q);
    const sv = Math.sin((Math.PI * u.y) / H);
    return { x: u.x, y: u.y - sag * sv - bulge * sv * Math.sin((Math.PI * u.x) / W) };
  };
  const forward = (p: Vec2): Vec2 => {
    let q = applyHomography(Hp, p);
    for (let i = 0; i < 30; i++) {
      const f = inverse(q);
      const fx = f.x - p.x, fy = f.y - p.y;
      if (Math.hypot(fx, fy) < 1e-6) break;
      const e = 0.5;
      const ax = inverse({ x: q.x + e, y: q.y }), ay = inverse({ x: q.x, y: q.y + e });
      const j00 = (ax.x - f.x) / e, j01 = (ay.x - f.x) / e, j10 = (ax.y - f.y) / e, j11 = (ay.y - f.y) / e;
      const det = j00 * j11 - j01 * j10;
      q = { x: q.x - (j11 * fx - j01 * fy) / det, y: q.y - (-j10 * fx + j00 * fy) / det };
    }
    return q;
  };

  const mapx = new Float32Array(o.width * o.height);
  const mapy = new Float32Array(o.width * o.height);
  for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
    const p = inverse({ x, y });
    mapx[y * o.width + x] = p.x;
    mapy[y * o.width + x] = p.y;
  }
  const mx = cv.matFromArray(o.height, o.width, cv.CV_32FC1, mapx);
  const my = cv.matFromArray(o.height, o.width, cv.CV_32FC1, mapy);
  const out = new cv.Mat();
  cv.remap(page, out, mx, my, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(95));
  mx.delete(); my.delete();
  if (o.blur) cv.GaussianBlur(out, out, new cv.Size(3, 3), 0);

  const rnd = mulberry32(o.seed ?? 7);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const d = out.data;
  const rgba = new Uint8ClampedArray(o.width * o.height * 4);
  for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
    let L = 1;
    if (o.gradientLow !== undefined) L *= o.gradientLow + (1 - o.gradientLow) * (x / o.width);
    if (o.shadow) L *= 1 - o.shadow.depth * Math.exp(-((x - o.shadow.x) ** 2 + (y - o.shadow.y) ** 2) / (2 * o.shadow.sigma ** 2));
    let v = d[y * o.width + x] * L;
    if (o.noiseSigma) v += gauss() * o.noiseSigma;
    const i = (y * o.width + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  out.delete();
  return { frame: { width: o.width, height: o.height, data: rgba }, forward };
}

/** Frontal framing: page centred in a 1200×1600 frame with a margin. */
export function frontalQuad(t: OMRTemplate, width = 1200, height = 1600, marginPx = 60): [Vec2, Vec2, Vec2, Vec2] {
  const aspect = t.paper.widthMm / t.paper.heightMm;
  const h = height - 2 * marginPx;
  const w = h * aspect;
  const x0 = (width - w) / 2;
  return [{ x: x0, y: marginPx }, { x: x0 + w, y: marginPx }, { x: x0 + w, y: marginPx + h }, { x: x0, y: marginPx + h }];
}
