# OMR Platform: Sprint 1 (Sheet Designer & Coordinate-Mapped PDF)

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
npm test           # 31 layout/PDF/hash tests
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
