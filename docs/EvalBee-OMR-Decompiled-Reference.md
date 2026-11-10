# EvalBee OMR – Decompiled Reference

_Source: public production bundle of `https://evalbee.com` (captured 2026-11-10, `main.2742967e.js` + 69 webpack chunks). Static analysis only: no login, no authenticated API calls, no server code observed._

> This is a **clean-room behavioural reference**: logic is restated as readable, renamed TypeScript with the original minified identifiers noted for traceability. It is not a copy of EvalBee's source and should not be pasted into our product. Our implementation (`src/lib/omr/*`) is an independent design. Credentials found in the bundle are redacted.

---

## 1. Where the OMR reader lives

| Item | Location in bundle |
|---|---|
| Web scanner (corner detection, grid refine, piecewise warp, bubble sampling, conflict checks, overlay drawing) | chunk `6875.1a1a8738.chunk.js`, webpack module **`50086`** |
| Option label helpers (A/B/C…, matrix P/Q/R…, set labels) | chunk `6875`, module `31050` |
| Per-question zoom crop on review screen | chunk `6875`, module `83739` (uses `50086.Hf`) |
| Review-screen store (zustand) | chunk `6875`, module `2051` |
| OpenCV.js lazy loader | module `78258` (in `auth` and `7199` chunks) – loads `/zz0.js` (11.45 MB OpenCV.js UMD, WASM inlined) |
| Homography library | module `12752` = npm **`perspective-transform`** (built on `numeric.js`). API: `PerspT(srcPts8, dstPts8).transform(x, y) → [x', y']` |
| Scan status enum | module `6727` |
| Caller ("Scan all" in exam scan page) | `exams.63289f6a.chunk.js` ~line 20 040 (`(0, W.Ay)(mat, x1, y1, x2, y2, scanTemplate, rollStartDigit)`) |
| Result payload builder | `exams` chunk ~line 19 489 (`function Y(e, s)`) |
| API route table / HTTP client | main bundle modules **`7585`** / **`18693`** |

Exports of module `50086`:

| Minified | Meaning (our name) |
|---|---|
| `Ay` | `scanSheet(mat, x1%, y1%, x2%, y2%, template, rollStartDigit)` |
| `Zs` | `decodeRollNumber(rollStartDigit, rollVal)` |
| `oz` | `validateRollAndSet(rollVal, setVal, rollNumber)` |
| `rd` | `drawScanOverlay(mat, scanResult, canvasId)` |
| `mG` | `drawServerOverlay(mat, overlayDto, canvasId)` |
| `Hf` | `showOptionArea(mat, rect, canvasId)` |

Scan status bit-flags (module `6727`):

```ts
const ScanStatus = { initial: 1, error: 2, conflict: 4, scanned: 8, synced: 16, uploaded: 32 } as const;
```

---

## 2. Template JSON consumed by the scanner

Fetched with `GET https://evalbee.com/api/exam/{examId}/scan-template` (header `x-user-token: <Firebase ID token>`) and stored **unmodified** in the zustand store as `scanTempalate` [sic]. The scanner destructures exactly these fields (others may exist but are unused):

```ts
/** Reconstructed from usage in module 50086. Units: template pixel space (reference sheet raster). */
interface EvalBeeScanTemplate {
  /**
   * Reference/timing marks laid out as a 2-D grid: grid[row][col] = [y, x].
   * Rows are spaced 5 bubble-rows apart (pitch math below assumes it).
   * grid[0][0] = top-left corner marker, grid[0][last] = top-right,
   * grid[last][last] = bottom-right, grid[last][0] = bottom-left.
   */
  grid: Array<Array<[y: number, x: number]>>;

  /** Answer bubbles: pixels[question][option] = [y, x, cellRow, cellCol]. */
  pixels: Array<Array<[y: number, x: number, cellRow: number, cellCol: number]>>;

  /** Roll number bubbles: roll[symbolRow 0..9][digitColumn] = [y, x, cellRow, cellCol]. */
  roll: Array<Array<[y: number, x: number, cellRow: number, cellCol: number]>>;

  /** Exam-set bubbles (optional): set[option] = [y, x, cellRow, cellCol]. */
  set?: Array<[y: number, x: number, cellRow: number, cellCol: number]> | null;
}
```

Key observations:
- Coordinates are **[y, x]** (row-major, OpenCV-style), not [x, y].
- Each bubble carries the **index of the grid cell** that contains it (`cellRow`, `cellCol`); the scanner maps it through that cell's own homography.
- There are **no explicit bubble radii** in the template: sizes are derived from grid spacing (see §3.1).
- Related endpoints: `GET api-online/exams/{id}/template-params`, `GET api/web/exams/{id}/label-profile` (option labels, `rollStartDigit`, `examSetLabels`), `GET api/web/teacher/exams/{id}/option-area-template/{roll}` (per-question crop rects `{x,y,width,height,pageIndex}` for the review zoom).

---

## 3. Algorithm (module 50086 `Ay` → our `scanSheet`)

### 3.1 Inputs and derived sizes

```ts
// mat: cv.Mat RGB(A) of the photo (pre-resized so the short side ≤ 1280 px, optionally rotated via warpAffine)
// x1,y1,x2,y2: user crop corners in PERCENT of image width/height (Konva drag handles; state "cornerPos")
cv.cvtColor(mat, mat, cv.COLOR_RGB2GRAY, 0);
cv.GaussianBlur(mat, mat, new cv.Size(5, 5), 0);
cv.threshold(mat, mat, 0, 255, cv.THRESH_OTSU);          // GLOBAL Otsu → binary; ink = 0, paper = 255

const gridRows = template.grid.length;
const bubbleRowsSpanned = 5 * (gridRows - 1);           // grid rows are 5 bubble-rows apart
const [imgH, imgW] = mat.matSize;
const left = (x1 * imgW) / 100, top = (y1 * imgH) / 100;
const right = (x2 * imgW) / 100, bottom = (y2 * imgH) / 100;

const expectedMarkPx = ((bottom - top) / bubbleRowsSpanned) * 0.66;   // "E": diameter ≈ 66% of row pitch
const cornerSearchWin = Math.min(right - left, bottom - top) / 5;     // "S": square search window side
```

### 3.2 Corner marker detection (module-local `i`)

```ts
type Pt = { x: number; y: number };
const CORNER_NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];

function findCornerMarker(bin: cv.Mat, cx: number, cy: number, expected: number, win: number, corner: 0|1|2|3) {
  const roi = bin.roi(new cv.Rect(cx - win / 2, cy - win / 2, win, win));
  cv.morphologyEx(roi, roi, cv.MORPH_CLOSE, cv.Mat.ones(5, 5, cv.CV_8U));   // fill specks
  cv.Canny(roi, roi, 50, 100, 3, false);
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  cv.findContours(roi, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const candidates: { center: Pt; length: number }[] = [];
  for (let k = 0; k < contours.size(); k++) {
    const r = cv.boundingRect(contours.get(k));
    const aspect = r.height / r.width;
    if (aspect > 0.8 && aspect < 1.2 && expected / 2 < r.height && r.height < 2 * expected) {
      candidates.push({
        center: { x: r.x + r.width / 2 + (cx - win / 2), y: r.y + r.height / 2 + (cy - win / 2) },
        length: (r.height + r.width) / 2,
      });
    }
  }
  if (!candidates.length) return null;
  // Pick the candidate furthest toward the requested page corner:
  const key = [
    (p: Pt) =>  p.x + p.y,   // 0 TL: smallest x+y
    (p: Pt) =>  p.y - p.x,   // 1 TR: smallest y−x
    (p: Pt) => -p.x - p.y,   // 2 BR: largest  x+y
    (p: Pt) =>  p.x - p.y,   // 3 BL: smallest x−y
  ][corner];
  candidates.sort((a, b) => (key(a.center) - key(b.center) > 0 ? 1 : -1));
  return candidates[0];
}
```

Facts worth noting:
- **No `approxPolyDP`, no convexity/solidity test, no hierarchy inspection** (the hierarchy Mat is computed and ignored). Squareness = bounding-box aspect 0.8–1.2 + size band [½E, 2E].
- Search uses Canny edges on the Otsu image, so both outer and inner edges produce contours; the corner-ordering sort disambiguates.
- Failure → `{ error: true, errorMsg: [{ transMsg: "corner_not_found_msg", cornerName }], status: ScanStatus.error }`.

Detected corners are packed as `dst = [TL.x, TL.y, TR.x, TR.y, BR.x, BR.y, BL.x, BL.y]`.

### 3.3 Global homography → grid refine

```ts
const g = template.grid, last = gridRows - 1;
const src = [                                         // template corners, converted [y,x] → (x,y)
  g[0][0][1], g[0][0][0],
  g[0][g[0].length - 1][1], g[0][g[0].length - 1][0],
  g[last][g[last].length - 1][1], g[last][g[last].length - 1][0],
  g[last][0][1], g[last][0][0],
];
const H = PerspT(src, dst);                           // perspective-transform

// bubble/mark diameter measured from the DETECTED page (used for sampling):
const sampleDiam = ((dst[7] - dst[1]) / bubbleRowsSpanned) * 0.66;   // "C": (BL.y − TL.y)/(5·(rows−1))·0.66

// Re-locate every grid mark near its projected position (window = 2E, same contour test as corners):
const detectedGrid: [x: number, y: number][][] = g.map(row => row.map(([ty, tx]) => {
  const [px, py] = H.transform(tx, ty);
  const hit = findMarkNear(bin, px, py, /*expected*/ expectedMarkPx, /*win*/ 2 * expectedMarkPx); // first passing contour
  return hit ? [hit.x, hit.y] : [px, py];             // fall back to the projection
}));
```

`findMarkNear` is the same MORPH_CLOSE → Canny → findContours → bounding-rect test as §3.2, but takes the **first** passing contour instead of sorting.

### 3.4 Per-cell perspective correction (curl handling)

```ts
// One homography per grid cell, from the template cell's 4 corners to the 4 detected marks.
const cellH: PerspT[][] = [];
for (let r = 0; r < g.length - 1; r++) {
  const rowH: PerspT[] = [];
  for (let c = 0; c < g[r].length - 1; c++) {
    const dstCell = [
      detectedGrid[r][c][0],         detectedGrid[r][c][1],
      detectedGrid[r][c + 1][0],     detectedGrid[r][c + 1][1],
      detectedGrid[r + 1][c + 1][0], detectedGrid[r + 1][c + 1][1],
      detectedGrid[r + 1][c][0],     detectedGrid[r + 1][c][1],
    ];
    const srcCell = [
      g[r][c][1],         g[r][c][0],
      g[r][c + 1][1],     g[r][c + 1][0],
      g[r + 1][c + 1][1], g[r + 1][c + 1][0],
      g[r + 1][c][1],     g[r + 1][c][0],
    ];
    rowH.push(PerspT(srcCell, dstCell));
  }
  cellH.push(rowH);
}
```

Only bubble **centres** are transformed; the image itself is never warped (no `warpPerspective`).

### 3.5 Grid sanity check

```ts
// Each detected grid mark must itself read as "dark" with the 9-point test (§3.6).
const gridVal = detectedGrid.map(row => row.map(([x, y]) => ninePoint(bin, x, y, sampleDiam)));   // [filled, y, x]
const darkPct = 100 * sum(gridVal.flat().map(v => v[0])) / (gridVal.length * gridVal[0].length);
if (darkPct < 80) return { error: true, errorMsg: ["marker_grid_not_match_msg"], status: ScanStatus.error };
```

### 3.6 9-point bubble sampling

```ts
const isBlack = (bin: cv.Mat, x: number, y: number) =>
  bin.ucharPtr(Math.floor(y), Math.floor(x))[0] === 0 ? 1 : 0;

function ninePoint(bin: cv.Mat, x: number, y: number, d: number): [filled: 0|1, y: number, x: number] {
  const o = d / 6;
  const pts = [[0,0],[+o,+o],[-o,+o],[-o,-o],[+o,-o],[+o,0],[-o,0],[0,-o],[0,+o]];
  const hits = pts.reduce((n, [dx, dy]) => n + isBlack(bin, x + dx, y + dy), 0);
  return [hits > 5 ? 1 : 0, y, x];                    // ≥ 6 of 9 black ⇒ filled
}

// Bubble read: map through its own cell, then sample.
function readBubble([ty, tx, cr, cc]: [number, number, number, number]) {
  const [x, y] = cellH[cr][cc].transform(tx, ty);
  return ninePoint(bin, x, y, sampleDiam);
}

const pixelsVal = template.pixels.map(q => q.map(readBubble));
const rollVal   = template.roll.map(row => row.map(readBubble));
const setVal    = template.set ? template.set.map(readBubble) : null;
```

Samples lie on a 3×3 lattice at ±d/6 (≈ ±0.11 × row pitch). Binary only: there is no fill ratio, confidence or erasure handling on the client.

### 3.7 Roll number decode (`Zs`)

```ts
function decodeRollNumber(rollStartDigit: number, rollVal: [0|1, number, number][][]): number {
  const filled = rollVal.map(row => row.map(v => v[0]));      // [symbolRow 0..9][digitCol]
  const digits = new Array(filled[0].length).fill(0);
  for (let s = 0; s < 10; s++)
    for (let d = 0; d < filled[s].length; d++)
      if (filled[s][d] === 1) digits[d] = (s + rollStartDigit) % 10;   // last marked row wins
  return digits.reduce((acc, dgt) => acc * 10 + dgt, 0);              // most-significant digit first
}
```

Blank columns silently become `0`. If `rollStartDigit = 1`, the first printed row means digit 1 and the 10th means 0.

### 3.8 Conflict detection (`oz`)

```ts
function validateRollAndSet(rollVal, setVal, rollNumber) {
  const msgs: string[] = [];
  const multiInColumn = rollVal[0].some((_, col) => rollVal.reduce((n, row) => n + row[col][0], 0) > 1);
  const setMarks = setVal ? setVal.reduce((n, v) => n + v[0], 0) : 0;
  if (setVal && setMarks < 1) msgs.push("please_select_exam_set");
  if (setVal && setMarks > 1) msgs.push("multiple_exam_set_msg");
  if (rollNumber < 1)         msgs.push("zero_not_allowed_msg");
  if (multiInColumn)          msgs.push("multiple_bubble_mark_msg");
  return { error: msgs.length > 0, errorMsg: msgs };
}
// Any error ⇒ result.status = ScanStatus.conflict (result still returned for manual fix).
```

Not validated on the client: multiple marks on **answers**, blank roll columns (other than an all-zero roll), duplicate roll numbers within a batch (handled later, see §4).

### 3.9 Scanner output

```ts
{
  gridVal, pixelsVal, rollVal, setVal,        // [filled, y, x] triples in image px
  markerDiameter,                             // from detected grid
  height: imgH, width: imgW,
  rollNumber, rollStartDigit,
  sheetDimension: { sheetMarkers: [[{x,y}]], predictedMarkers: [], bubbleSize, height, width },
  sheetImageOverlayDto: null,
  status: ScanStatus.scanned | ScanStatus.conflict,
}
```

Overlay (`rd`): filled circles drawn at every sample point – blue `(36,103,198)` = filled, yellow `(240,194,11)` = empty – radius ≈ half the bubble size, rendered with `cv.imshow` to a canvas.

---

## 4. From scan to server

```ts
// exams chunk, "Scan all" sync step
// 1. Only status === scanned (not conflict/error) results are sent.
// 2. Duplicate roll numbers in the batch, or rolls already on the server
//    (GET api/web/teacher/exams/{id}/roll-numbers), are marked toBeOverride and held back for the user.
POST https://evalbee.com/api/exam/scan-results
{
  "examId": "<id>",
  "resultScanTemplates": [
    { "pixels":   [[0,1,0,0], ...],     // per question, per option: 0/1 only
      "roll":     [[0,0,1,...], ...],   // [symbolRow][digitCol]
      "examSet":  [0,1,0,0] | null }
  ]
}
// → statuses become "synced"; grading against the answer key happens server-side.
```

Image upload (Enterprise plans only, `settings/sync-images`): `GET api-online/exam/{examId}/{rollNo}/sheet-image/put-url` → `PUT` to GCS bucket `evalbee-scan-images` → `POST api/sync/exams/{examId}/sheet-images/{rollNo}/{page}`.

Preprocessing before `scanSheet` (module `7199`, `auth`): images < 600 KB are used as-is; otherwise the short side is resized to 1280 px (`INTER_AREA`). Rotation uses `getRotationMatrix2D` + `warpAffine` on a padded square (`copyMakeBorder`, `BORDER_CONSTANT`).

---

## 5. HTTP client (module 18693)

- Base URL chosen by path prefix: `api/`, `api-online/`, `api-ums/`, `api-upastify/` → `https://evalbee.com`; `api-auth/` → separate `REACT_APP_API_AUTH_URL`.
- Every request: Firebase `currentUser.getIdToken()` → header **`x-user-token`**. No session = `alert("User session expired…")`.
- Query strings built manually (`?k=encodeURIComponent(v)&…`); 2xx/3xx → `json()`.
- Helpers: `Jt` GET, `bE` POST, `qB` PUT, `Gx` DELETE, `ly` GET-blob, `dU` GET-encrypted, `FR` GET-no-auth.
- `/e/` endpoints: response = `iv(12 bytes) ‖ AES-GCM ciphertext`; key = SHA-256 of `"<id>:<hex>:<seed>"` with the seed compiled into the bundle (obfuscation only).

Build-time config (`process.env` inlined):

| Key | Value |
|---|---|
| `REACT_APP_BASE_DOMAIN` | `evalbee.com` |
| `REACT_APP_API_*_URL` | `https://evalbee.com` |
| `REACT_APP_API_LOGIN_VERIFY_URL` | `https://evalbee.com/verify` (email-link continue URL) |
| `REACT_APP_API_ONLINE_WEB_SOCKET_URL` / `…UPASTIFY…` | `https://evalbee.com/ws-api-online` / `/ws-api-upastify` (STOMP/SockJS) |
| Firebase project | `omrevaluator` (`omrevaluator.firebaseapp.com`, RTDB `omrevaluator.firebaseio.com`), API key _[redacted]_ |
| GCS buckets | `evalbee-scan-images`, `evalbee-brand-images`, `evalbee-question-papers`, `evalbee-documents`, `upastify-documents`, `upastify-user-biometric` |
| Razorpay key id | _[redacted, live]_ |
| Response AES seed | _[redacted]_ |
| Tawk.to | property + widget ids present |

---

## 6. Critical routes (module 7585)

| Name (from route table) | Method | Path |
|---|---|---|
| postExam | POST | `api/web/exams/exam` |
| postCopyExam | POST | `api/web/exams/exam/copy` |
| _(scan template)_ | GET | `api/exam/{examId}/scan-template` |
| getExamEditTemplate / postExamEditTemplate | GET / POST | `api/exam/{examId}/edit-template` / `api/exam/edit-template` |
| getTemplateParams | GET | `api-online/exams/{examId}/template-params` |
| getExamLabelProfile | GET | `api/web/exams/{examId}/label-profile` |
| getLabelProfiles / postLabelProfile | GET / POST | `api-online/configurations/label-profiles` / `label-profile` |
| getHeaderProfiles / postHeaderProfile | GET / POST | `api-online/configurations/header-profiles` / `header-profile` |
| getAnswersheetPdf | GET (blob) | `api-online/exams/{examId}/answersheet-pdf?sheetPerPage=n` |
| postCreateDownloadJobs | POST | `api-online/exams/{examId}/prefilled-answer-sheet-job` |
| getAllDownloadJobs / getDocumentByJobId | GET | `api-online/exams/{examId}/download-jobs` / `api-online/jobs/{jobId}` |
| getExamAnswerKey / postExamAnswerKey / delete | GET / POST / DELETE | `api/web/exams/{examId}/exam-key` |
| postExamScanResult | POST | `api/exam/scan-results` |
| getExamScanSyncImages / post | GET / POST | `api/web/exams/{examId}/settings/sync-images` |
| generateImagePutUrl | GET | `api-online/exam/{examId}/{rollNo}/sheet-image/put-url` |
| postSheetImageDto | POST | `api/sync/exams/{examId}/sheet-images/{rollNo}/{page}` |
| getStudentAnswerSheetImages | GET | `api-online/exam/{examId}/{rollNo}/sheet-image/get-url` |
| getAnswerSheetImage / PageCount | GET | `api/web/exams/{examId}/answer-sheet-image/{n}` / `answer-sheet-page-count` |
| getSheetImageOveraly / postGenerate… | GET / POST | `api/exams/{examId}/reports/{roll}/scan-overlay/{page}` (`/generate-overlay`) |
| getEditOptionAreaTemplate | GET | `api/web/teacher/exams/{examId}/option-area-template/{roll}` |
| getEditStudentReport / postEditStudentReport | GET / POST | `api/web/teacher/exams/{examId}/reports/{roll}/edit` |
| getExamUniqueRollNumbers | GET | `api/web/teacher/exams/{examId}/roll-numbers` |
| getStudentReportForExam | GET | `api/web/teacher/exams/{examId}/student-reports` |
| getStudentReport | GET | `api/web/teacher/exams/{examId}/student-report/{roll}` |
| getStudentMarksDistribution | GET | `api/web/teacher/exams/{examId}/details/marks-distribution` |
| getStudentReportAnalysis | GET | `api/web/teacher/exams/{examId}/analysis/response-analysis` |
| getStudentReportExcelData | GET | `api/web/teacher/exams/{examId}/exports/excel-data` |
| getSubjectiveMarks / postBulk… | GET / POST | `…/student-report/{roll}/subjective-marks` / `…/student-reports/subjective-marks` |
| postStudentReportJob | POST | `api-online/exams/{examId}/student-report-job` |
| getExamSettings / post | GET / POST | `api/web/exams/{examId}/exam-settings` |
| getProductPrice | GET (public) | `api-ums/web/v2/payment/products` |
| getCurrentUserSubscription | GET | `api-ums/web/users/subscription` |
| postPaymentOrder / postVerifyPayment | POST | `api-ums/web/payment/purchase-orders` / `payment/verify` |

Full extracted list: `docs/evidence/endpoint_map.txt` (256 named routes) and `docs/evidence/endpoints_raw.txt` (197 literal paths).

---

## 7. Payload structures

**Create exam** (`POST api/web/exams/exam`, exams chunk ~line 10 380):
```jsonc
{
  "rollDigits": 5, "examSets": 1,
  "subjects": [{
    "subName": "Subject 1",
    "sections": [{
      "name": "Section 1", "noOfQue": 1,
      "type": "FIVEOPTION",          // TRUEORFALSE|THREEOPTION|FOUROPTION|FIVEOPTION|SIXOPTION|EIGHTOPTION|TENOPTION|MATRIX|DECIMAL
      "positiveMark": 1, "negetiveMark": 0,            // [sic]
      "partialAllowed": false,
      "optionalAllowed": false, "noOfOptionalQue": 1,
      "optionalType": "Default",     // Default | Max Marks | Min Marks
      "primaryOptions": 4, "secondaryOptions": 5,      // MATRIX
      "digits": 5, "hasNegativeSign": false, "decimalAllowed": false   // DECIMAL
    }]
  }],
  "examName": "…", "classNames": ["…"], "examDate": "…",
  "onlineMode": false, "onlineSettings": {…},
  "templateParams": {…}              // sheet layout params (columns, header profile, etc.); not fully observed
}
```

**Label profile** (used by scanner UI): `fourOptionLabels, fiveOptionLabels, threeOptionLabels, sixOptionLabels, eightOptionLabels, tenOptionLabels, trueOrFalseLabel, matrixPrimary, matrixSecondary, examSetLabels, rollStartDigit, rollDigitsLabels`. Defaults: options `A…`, matrix secondary `P…`.

**Price list** (public, observed verbatim): see `docs/evidence/products.json`.

**Subscription fields read by the client:** `accountType (FREE|PROFESSIONAL|ENTERPRISE)`, `productType`, `isActive`, `startDate`, `endDate`, `expiryDate`, `storage`, `storageCount{usedSpace,totalSpace,availableSpacePercentage}`, `storageExpDate`, `credits`, `messageCredits`, `orgId`, `tenantId`, `role`.

---

## 8. Lessons carried into our design

| EvalBee behaviour | Our choice |
|---|---|
| Template in raster pixel space, [y,x] order | **mm, [x,y], fiducial-relative**; printer/DPI independent |
| Bubble size inferred from grid pitch × 0.66 | Explicit `bubble.diameterMm` in template |
| Corner search needs user-dragged crop | QR + fiducials → automatic |
| Bounding-box aspect test only | Add approxPolyDP + solidity + area band |
| Global Otsu | Background normalisation + adaptive threshold |
| 9-point binary vote | Inner-disc darkness score, sheet-adaptive threshold, confidence, erasure flag |
| Per-cell homography from reference grid every 5 rows | **Keep** (same idea), with explicit mark centres in JSON |
| CV on UI thread | Web Worker |
| PDF generated server-side | Client-side vector PDF from the same JSON |
