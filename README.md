# VERITAS

**Verified Exam Recognition & Instant Test Analytics System** · University of San Agustin

> Instant mobile grading backed by Augustinian outcomes intelligence.

(Repository: `omr-grade-engine`.)

Design → scan → grade OMR answer sheets, offline-first. Routes: `/designer`, `/scan`, `/grade`. One JSON template, computed by a pure layout engine, drives the live SVG preview, the client-side vector PDF and (from Sprint 2) the OpenCV scanner.

```
settings ──► layout-engine.ts ──► OMRTemplate (mm, fiducial-relative) ──┬─► primitives.ts ─┬─► SVG preview
                                                                         │                  └─► pdf-generator.ts (pdf-lib)
                                                                         └─► template-coordinates.json  ─► scanner (Sprint 2)
```

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 145 tests: layout, vision (real OpenCV.js in Node), grading, roster, overrides, sync, scorecards, sample kit, Convex backend
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

## Sprint 4: Roster, review overrides, scorecards, sync

| Path | Purpose |
|---|---|
| `src/lib/roster/schema.ts` | `Student`, `Roster`, `rollKey()` (matches "00123", "0-0123", "123") |
| `src/lib/roster/importer.ts` | RFC-4180 CSV parser (BOM, quotes, `,` `;` tab), header alias detection (Roll No, Student ID, LRN, Full Name, First/Last Name, Guardian Contact, …), sanitisation, duplicates |
| `src/lib/roster/reconcile.ts` | `MATCHED`, `UNREGISTERED_STUDENT`, `ABSENT`, `UNREADABLE_ROLL` + duplicate-scan detection |
| `src/lib/review/overrides.ts` | `ManualOverridePatch` (answer / roll / set / numeric), `applyOverrides` (raw scans never mutated, newest patch per target wins, `null` reverts), audit descriptions |
| `src/components/grading/review-modal.tsx` | Teacher review: click bubbles to correct, confirm flagged reads, fix roll/set, reason required, audit log with revert; scores update instantly |
| `src/lib/export/scorecard-generator.ts` | One-page A4 slip per student (pdf-lib): header, rank/percentile/grade tiles, subject bars, response grid, roll-number and signature crops; batch = one PDF. Built in `src/workers/scorecard.worker.ts` |
| `src/lib/sync/` | Outbox with monotonic `seq` (`sync-outbox.ts`), `SyncDriver` contract, loopback + HTTP drivers, key-version coalescing, two-teacher conflict detection and resolutions |
| `src/lib/samples/` | Sample Exam Kit: 20-question PDF, template, answer key, 8-student roster, 5 photo-like scans (zip) |
| `tests/roster`, `tests/sync`, `tests/export` | Importer/reconciler, override consistency, outbox ordering/outage/idempotency, HTTP contract, conflicts, scorecards, kit end-to-end through the scanner |

**Sync contract** (implement on any backend; `id` is the idempotency key, `serverSeq` is monotonic):

```
POST {base}/push   { entries: OutboxEntry[] }            → { acked: string[], rejected: {id, reason}[] }
GET  {base}/pull?cursor=<serverSeq>&limit=<n>            → { changes: (OutboxEntry & {serverSeq})[], cursor: string }
```

Entry kinds: `scan.created`, `override.added`, `key.version` (only the newest pending version per exam is sent), `roster.imported`, `conflict.resolved`. Scans and patches are append-only, so devices never overwrite each other; two scans of one roll number with different effective answers are held as `SYNC_CONFLICT` until someone picks the sheet to keep.

## Sprint 5: Roles & syllabus-driven OBE pipeline

**Zero burden for faculty.** Nobody types POs, COs or a Table of Specifications.

| Role | Can do |
| --- | --- |
| `teacher` | drop syllabi, build exams, set keys, scan, reconcile rosters, view cohort analytics |
| `admin` | everything a teacher can, plus `/admin`: faculty roles (teacher ↔ admin), domain policy, global grading formula, syllabi repository, audit trail |
| `owner` | the school's creator: an admin whose role cannot be changed |
| `viewer` | read-only |

The matrix lives in `src/lib/roles/policy.ts` and is enforced server-side in `convex/` (`requireRole`); the UI only hides what the server would refuse anyway.

**Syllabus drop (`/designer`).** Drop the official syllabus PDF (e.g. `IT 321 Information Assurance and Security 1`):

1. `src/lib/syllabus/parse-syllabus.ts` extracts text with `pdfjs-dist` (table cells on a row become ` | `) and parses the course header, PO A–I, CO1–CO4 (with PO links), modules 1–9 (topics, covered COs, hours) and the lecture/lab weighting (falls back to USA CLASE 67/33 with a warning).
2. Pick the period: Prelim = modules 1–3, Midterm = 4–6, Final Term = 7–9.
3. `src/lib/syllabus/tos.ts` auto-generates the Table of Specifications (questions per module by hours, else topic count; sliders rebalance so the total never drifts) and assigns each question a module and a CO.
4. The sheet title/subtitle/length are configured; the plan is remembered in the browser and stamped onto the answer key (`outcomeCode`, `moduleNumber`) when you grade, or saved with the cloud exam (`syllabi` table, `exams.syllabusId/examPeriod`).

**Outcomes (`/grade` → Outcomes tab).** CO mastery cards (points scored ÷ points possible, flagged below 75 %), PO A–I roll-up (point-weighted through each CO's PO links) and a one-click accreditation PDF pairing KR-20/SEM/item quality with outcome attainment. Bonus and dropped items are excluded from attainment.

**Admin portal (`/admin`).** Faculty directory with role elevation, syllabi repository, a searchable audit trail (every answer-key change with a diff of what changed, grade override, conflict resolution, role/policy/syllabus event), and policy: `@usa.edu.ph` domain allowlist for adding members and the global grading formula (default `Term = 67 % Lecture + 33 % Lab`, major exam 50 % of lecture, lab exam 30 % of lab).

Tests: `tests/syllabus/` (parser incl. a real PDF round-trip, TOS, attainment, report) and `tests/roles/` (role matrix, formula, audit search, and the Convex functions enforcing them).

## Sprint 6: Offline outbox, field calibration, production hardening

- **Offline outbox (cloud mode).** `src/lib/sync/offline-outbox.ts` stores answer-key saves, grade overrides, conflict resolutions and scan uploads in IndexedDB (`cloudOps`) with monotonic timestamps and idempotency keys, then replays them in order when the browser comes back online or the Convex socket reconnects (`useCloudOutbox`). Servers dedupe replays (`clientKeyId`, `patchId`, `clientId`, `clientScanId`). If another teacher saved a key meanwhile, `key-merge.ts` merges three ways (their edits to other questions are kept; a clash keeps the server value and reports it). The header badge shows *Saved Offline · Queued for Sync (N)* → *All Changes Synced*.
- **Field calibration (`/scan`).** *Scanner calibration* drawer: diagnostic overlay (corner squares, anti-curl bands, green/yellow/red bubble rings), sensitivity presets/sliders (ink level, fill coverage), calibration mode (no save/upload), rescan and JSON export. The camera shows *Too Dark*, *Glare Detected* and *Hold Steady* guardrails and a torch toggle.
- **Production guardrail.** The dev token issuer is dropped from `OMR_AUTH_PROVIDERS` on production deployments and its tokens are refused; `DEFAULT_ADMIN_EMAILS` bootstraps admins. See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full Vercel + Convex + Clerk checklist.

## Backend: Convex (+ Vercel)

Without `NEXT_PUBLIC_CONVEX_URL` the app is local-first exactly as above. With it, `/scan` uploads sheets to the selected cloud exam and `/grade` reads live Convex subscriptions.

| Path | Purpose |
|---|---|
| `convex/schema.ts` | `users`, `orgs`, `memberships` (owner/admin/teacher/viewer), `templates`, `rosters`, `exams`, `answerKeys` (immutable versions), `scans` (append-only), `overrides` (audit log), `conflictResolutions`, `examAnalytics` |
| `convex/validators.ts` | Convex validators mirroring the TypeScript contracts (QuestionRule, DecodedFields, compact readouts, patches) |
| `convex/exams.ts` | `create` (Zod-validated template, blank key v1), `listByOrg`, `get`, `setStatus`, `setRoster`, `getRoster` |
| `convex/grading.ts` | `submitScanBatch` (idempotent, duplicate/conflict detection), `listScans` (paginated feed), `getScan` (+ image URL), `getAnswerKey`, `updateAnswerKey` (optimistic concurrency), `addOverrides`, `resolveConflict`, `getExamAnalytics`, `generateUploadUrl` |
| `convex/analytics.ts` | Background job: pages through all scans, applies overrides/resolutions, runs the shared scorer + item analysis, stores a revisioned snapshot |
| `convex/orgs.ts`, `convex/users.ts`, `convex/lib/access.ts` | Schools, membership/roles, identity guards (provider-agnostic `ctx.auth`) |
| `src/app/ConvexClientProvider.tsx` | `ConvexProvider` / `ConvexProviderWithAuth` around the App Router |
| `src/components/cloud/*` | Session (school/exam selection, scan upload with retry), live exam data (typed `useQuery`/`usePaginatedQuery`/`useMutation`), cloud panel |
| `tests/convex/` | `convex-test` suite: tenancy, idempotency, conflicts, key concurrency, overrides, analytics parity with the browser |

Grading logic lives once in `src/lib` and runs in both places: clients rescore instantly when a key version or scan arrives; the server snapshot powers `getExamAnalytics` (a single Convex query cannot read a 5,000-sheet exam, so the snapshot is recomputed by a scheduled action and marked `stale` until it catches up).

### Develop locally

```bash
npx convex dev                                   # links/creates a deployment, writes .env.local
node scripts/dev-auth.mjs setup | sh             # dev-only JWT issuer on THIS deployment
NEXT_PUBLIC_OMR_AUTH=dev npm run dev
node scripts/dev-auth.mjs token alice "Alice" alice@usa.edu.ph   # paste in the Cloud panel
```

### Auth: Clerk + Google SSO, `@usa.edu.ph` only

Two independent layers:

1. **Clerk** (who can sign in). In the Clerk dashboard:
   - *User & Authentication → SSO connections*: enable **Google**; disable email/password and other providers.
   - *Configure → Restrictions*: turn on **Allowlist** and add `usa.edu.ph` (sign-ups from any other domain are refused).
   - Recommended: use custom Google OAuth credentials from a Google Cloud project inside the `usa.edu.ph` Workspace with the consent screen set to **Internal**, so Google itself only offers institutional accounts.
   - *Configure → JWT templates*: create the **Convex** template (name `convex`); it carries `email` and `email_verified`.
2. **Convex** (what a token may do). Every function calls `requireAllowedIdentity`: the token's email must be **verified** and its domain must be **exactly** `usa.edu.ph` (sub-domains and look-alikes are refused). Override per deployment with `OMR_ALLOWED_EMAIL_DOMAINS` (comma-separated), e.g. to add a staging test domain.

Configuration:

```bash
# Convex deployment (dev and prod separately; issuer = Clerk "Frontend API URL")
npx convex env set OMR_AUTH_PROVIDERS '[{"domain":"https://<your-app>.clerk.accounts.dev","applicationID":"convex"}]'
# Vercel / .env.local
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
```

With `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set, `app/layout.tsx` mounts `ClerkProvider` and `ConvexClientProvider` uses `ConvexProviderWithClerk` with Clerk's `useAuth`. The cloud panel shows **Continue with Google**; a signed-in account outside the allowlist sees why it was refused and can switch accounts. There is deliberately **no Clerk middleware**: pages are static and offline-first, and all protected data goes through Convex, so pages keep working when Clerk is unreachable (development instances would otherwise redirect every first request to Clerk for a session handshake). No `CLERK_SECRET_KEY` is needed by the app.

Local development without Clerk: `NEXT_PUBLIC_OMR_AUTH=dev` + `scripts/dev-auth.mjs` (tokens carry `email_verified`; mint them for `@usa.edu.ph` addresses). Never put the dev issuer in a production `OMR_AUTH_PROVIDERS` (production deployments drop it and refuse its tokens; see [DEPLOYMENT.md](DEPLOYMENT.md)).

### Deploy on Vercel

1. In Convex, create a production deploy key; in Vercel add `CONVEX_DEPLOY_KEY` (Production).
2. Vercel build command: `npx convex deploy --cmd 'npm run build'` (sets `NEXT_PUBLIC_CONVEX_URL` for the build).
3. `npx convex env set --prod OMR_AUTH_PROVIDERS '<clerk json>'`; in Vercel set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (production instance). Leave `NEXT_PUBLIC_OMR_AUTH` unset in production.
