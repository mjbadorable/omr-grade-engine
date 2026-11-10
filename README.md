# OMR Grade Engine

A deterministic OMR answer-sheet designer. One JSON template, computed by a pure layout engine, drives the live SVG preview, the client-side vector PDF and (from Sprint 2) the OpenCV scanner.

```
settings ──► layout-engine.ts ──► OMRTemplate (mm, fiducial-relative) ──┬─► primitives.ts ─┬─► SVG preview
                                                                         │                  └─► pdf-generator.ts (pdf-lib)
                                                                         └─► template-coordinates.json  ─► scanner (Sprint 2)
```

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 91 tests: layout/PDF/hash, vision (real OpenCV.js in Node), grading & psychometrics
npm run build
```

## Layout

| Path | Purpose |
|---|---|
| `src/lib/omr/schema.ts` | Zod schemas + TS types: template, regions, reference grid, QR, designer settings |
| `src/lib/omr/layout-engine.ts` | Pure layout solver, QR payload, validation (overlaps ≥ 0.3 mm, printable margin, grid integrity, bubble ↔ cell) |
| `src/lib/omr/primitives.ts` | Template → draw list (page mm). Single renderer input for SVG and PDF |
| `src/lib/omr/pdf-generator.ts` | Vector PDF via pdf-lib; deterministic bytes; template JSON embedded as attachment |
| `src/lib/omr/sha256.ts` | Sync SHA-256 + canonical JSON for `layoutHash` |
| `src/components/designer/*` | Designer UI (settings, preview with overlays, JSON/validation drawer) |
| `docs/EvalBee-OMR-Decompiled-Reference.md` | Behavioural reference of EvalBee's web scanner (clean-room notes) |
| `docs/OMR-Blueprint.md` | Full architecture blueprint (vision pipeline, DB/sync, roadmap) |
| `docs/evidence/` | Route map, literal endpoints, public price list, network log |

## Coordinate contract (for the scanner)

- Units **mm**, origin = **centre of the top-left fiducial**, `[x, y]`, y down. Page coordinates = sheet + `paper.originMm`.
- Fiducials: 6 mm solid squares at `(0,0)`, `(W,0)`, `(W,H)`, `(0,H)`, with a 2 mm quiet zone.
- Reference grid: 3 mm squares at every `rowYs × columnXs` intersection; rows are exactly **5 answer rows** apart. The corner intersections are the fiducials. Every bubble stores `cell: [row, col]` → use that cell's homography (curl correction).
- Bubble: `center`, `bbox`, `bubble.diameterMm`. Sample the inner disc of radius `innerSampleRatio × d/2`.
- QR (EC level M, 0.5 mm modules, 4-module quiet zone): `OMR1;<templateId>;<version>;<pageIndex>;<pageCount>;<layoutHash>`.
- `layoutHash` = first 16 hex chars of SHA-256 over canonical geometry (QR payload excluded). Same settings ⇒ same hash, byte-identical JSON and PDF.

## Sprint 2: Edge-vision scanner (`/scan`)

```
RGBA frame ─► normalize ─► detect-corners ─► warpPerspective ─► QR identity (full-res, 12 px/mm)
            (≤1280 px,    (adaptive Gaussian,  (canonical,        ├─ page auto-select
             grayscale)    CCOMP hierarchy,     5 px/mm)          └─ upside-down detection
                           4-gon + fill tests)
          ─► ink darkness map ─► reference-mark refinement ─► per-band homographies ─► bubble discs ─► field decode
             (1 − gray/bg,       (moment centroids,           (template mm →            (density,     (roll/set conflicts,
              bg = ¼-res close)   missing-mark interpolation)   canonical px)             coverage)     numeric, matrix)
```

| Path | Purpose |
|---|---|
| `src/lib/vision/types.ts` | Contracts: `ScanFrameInput`, `CornerPoints`, `CellTransform`, `BubbleReadout`, `ScanTelemetry`, `VisionError`, `ScanResult` |
| `src/lib/vision/geometry.ts` | Pure math: 4-point homography (DLT), inversion, quad ordering/convexity/aspect validation |
| `src/lib/vision/normalize.ts` | Resize/grayscale, adaptive Gaussian threshold, shadow-invariant darkness map |
| `src/lib/vision/detect-corners.ts` | Fiducial candidates + combination search + global warp |
| `src/lib/vision/curl-correction.ts` | Reference-mark refinement and piecewise homography per 5-row band |
| `src/lib/vision/read-bubbles.ts` | Inner-disc density/coverage, group baseline, FILLED/PARTIAL/ERASURE/EMPTY |
| `src/lib/vision/decode-fields.ts` | Roll/set/answer/numeric/matrix decoding with explicit conflict payloads |
| `src/lib/vision/scan-sheet.ts` | Orchestrator + live-camera `detectAlignment` |
| `src/workers/omr-scanner.worker.ts` | The only place OpenCV.js is loaded (`importScripts('/vendor/opencv-*.js')`) |
| `src/lib/vision/scanner-client.ts` | Promise API for the UI; frame-dropping alignment for live camera |
| `tests/vision/` | Pure unit tests + end-to-end tests on synthetic photographs with known distortion |

OpenCV.js (`@techstark/opencv-js` 4.10.0) is copied to `public/vendor/` by `npm run vendor` (runs automatically before `dev`/`build`; the copy is git-ignored).

**Classification** (inner disc = 70 % of the bubble radius, darkness normalised against local paper):
`FILLED` coverage ≥ 0.75 · `PARTIAL` coverage ≥ 0.15 · `ERASURE` low coverage but density ≥ 0.10 above the group baseline · `EMPTY` otherwise.

## Sprint 3: Grading engine & psychometrics (`/grade`)

| Path | Purpose |
|---|---|
| `src/lib/grading/types.ts` | Contracts: `AnswerKey` (versioned, `Map<number, QuestionRule>`), `QuestionRule` (choice / numeric / matrix; `ALL_MATCH`, `ANY_MATCH`, `PARTIAL_CREDIT`; points, negative, bonus, dropped, subject/section tags), `SetMapping`, `ScoredSheet`, `PsychometricReport` |
| `src/lib/grading/answer-key.ts` | Blank key from a template, immutable updates (every change bumps `version`), key from a scanned master sheet, set-mapping text format, validated JSON codec |
| `src/lib/grading/scorer.ts` | `scoreSheet`, `rescoreBatch` (key compiled once into per-set bitmask tables), `mergePages` for multi-page sheets |
| `src/lib/grading/item-analysis.ts` | p, D (27 % groups), point-biserial (total and rest score), distractor analysis, miskey detection, KR-20, SEM |
| `src/lib/grading/export.ts` | Gradebook / item-analysis rows → CSV (formula-injection safe) and SheetJS workbook |
| `src/lib/grading/simulate.ts` | Seeded 2PL IRT class simulator (benchmarks, tests, "Demo class" button) |
| `src/lib/storage/*` | IndexedDB scan store (`/scan` → `/grade`) and localStorage template/key store |
| `src/components/grading/*` | Key editor, sortable gradebook, inspection modal, item-analysis view with distractor charts |
| `tests/grading/` | Scoring rules, set shuffles, hand-computed psychometrics, IRT recovery, exports, 5,000-sheet benchmark |

**Exam sets.** The key is written in the default set's order. Other sets map printed → master with lines like `1:7:CABD` (printed Q1 is master Q7; printed A,B,C,D are master C,A,B,D). Sheets whose set is unreadable are held as `FLAGGED_CONFLICT` when sets differ.

**Quality badges.** Strong: D ≥ 0.30 · Average: 0.20 ≤ D < 0.30 · Poor: D < 0.20, negative discrimination, or a distractor that attracts the upper group more than the key does (possible miskey).

SheetJS is installed from `cdn.sheetjs.com` (0.20.3); the npm registry copy is outdated.
