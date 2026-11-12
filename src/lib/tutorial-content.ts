import type { TutorialCategory } from "./tutorial-state";

export type IconName = "upload" | "sliders" | "download" | "qr" | "camera" | "wand" | "key" | "refresh" | "chart" | "users" | "shield" | "list";
export interface TutorialStep { icon: IconName; title: string; body: string }
export interface TutorialSection { id: TutorialCategory; tab: string; short: string; heading: string; steps: TutorialStep[]; tipTitle: string; tip: string; visit: string }

export const TUTORIAL: TutorialSection[] = [
  {
    id: "design", tab: "1 · Design", short: "Design", heading: "Sheet Designer & OBE Setup", visit: "/designer",
    steps: [
      { icon: "upload", title: "Auto-configure via syllabus (optional)", body: "Drop your USA course syllabus PDF into the top banner. VERITAS extracts the Course Outcomes (CO), Program Outcomes (PO) and exam metadata, and builds the Table of Specifications for you." },
      { icon: "sliders", title: "Customize layout & identity", body: "Tap a Quick Preset (20, 50 or 100 items) for a print-ready sheet in one click, then fine-tune paper size, roll number digits, exam set codes (A/B/C/D) and question sections (MCQ, True/False, Numeric) in the sidebar." },
      { icon: "download", title: "Validate & export a print-ready PDF", body: "Check the green “Layout valid” badge, then click “Download PDF” to print your official answer sheets, or “Download JSON” to save the template." },
    ],
    tipTitle: "Pro Tip", tip: "Always print at “100% / Actual Size” (never “Fit to Page”) so the corner fiducial markers align cleanly during scanning.",
  },
  {
    id: "scan", tab: "2 · Scan", short: "Scan", heading: "Mobile Camera & Batch OMR Capture", visit: "/scan",
    steps: [
      { icon: "qr", title: "Load the exam layout", body: "Make sure the active sheet layout matches the printed exam paper. The QR code on each sheet also verifies the layout automatically." },
      { icon: "camera", title: "Capture with the camera or upload images", body: "Use your phone camera in good light, or upload batches of scanned images. Line up the 4 corner brackets with the black corner squares: they turn green and, with Auto-Snap on, the sheet is captured and scored by itself." },
      { icon: "wand", title: "Instant perspective warp & bubble read", body: "The on-device OpenCV engine flattens tilted pages, detects filled bubbles, and flags low-confidence or double-marked items. An instant result banner shows the student ID, set and score, with Scan Next Sheet and Inspect Paper." },
    ],
    tipTitle: "Pro Tip", tip: "Avoid heavy shadows across the four corner registration marks, and ask students to fill bubbles completely with dark ink or an HB/2B pencil.",
  },
  {
    id: "grade", tab: "3 · Grade", short: "Grade", heading: "Answer Key, Rescoring & OBE Analytics", visit: "/grade",
    steps: [
      { icon: "key", title: "Set the answer key & multi-set mapping", body: "Click the bubbles to set the key for Sets A/B/C/D (mark two for alternate credit, ★ for bonus), or import it. If you used the syllabus drop, each question is already mapped to its Course Outcome (CO)." },
      { icon: "refresh", title: "Live rescoring & audit", body: "Edit point weights, grant bonus or drop items, and resolve flagged sheets. VERITAS rescores thousands of sheets instantly (5,000 in under two seconds in our benchmark)." },
      { icon: "chart", title: "Export class records & OBE analytics", body: "Review item difficulty and discrimination, CO attainment percentages, then export Excel (.xlsx) or CSV for your grading sheet, or the accreditation PDF." },
    ],
    tipTitle: "Pro Tip", tip: "Found an ambiguous question after scanning? Change its key or mark it as a bonus in the Answer Key panel. Every student’s score updates automatically, with no rescanning.",
  },
  {
    id: "admin", tab: "Admin", short: "Admin", heading: "Institutional Governance", visit: "/admin",
    steps: [
      { icon: "users", title: "Manage faculty roles", body: "Pre-authorize faculty by pasting their @usa.edu.ph emails, or approve pending “Request Faculty Access” requests with one click. Roles: Admin (governance), Teacher (build, scan and grade) or Viewer (read-only). The owner’s role is fixed." },
      { icon: "shield", title: "Domain & security policies", body: "Set the allowed institutional email domains and the global grading formula. Sign-in is always limited to verified @usa.edu.ph accounts." },
      { icon: "list", title: "Syllabi repository & audit trail", body: "Browse every uploaded syllabus and search the audit trail of answer-key updates, grade overrides, conflict resolutions and role changes." },
    ],
    tipTitle: "Good to know", tip: "Admin tools are for EdTech staff, supervisors and deans. Teachers who open /admin see a clear “Admins only” message, and the server enforces this too.",
  },
];

export const sectionFor = (id: TutorialCategory) => TUTORIAL.find((s) => s.id === id)!;
