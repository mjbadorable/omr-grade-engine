import type { TutorialCategory } from "./tutorial-state";

export type IconName = "upload" | "sliders" | "download" | "qr" | "camera" | "wand" | "key" | "refresh" | "chart" | "users" | "shield" | "list";
/**
 * One guided step. `route` is the page the step lives on (it may carry a query such as `?tab=key`) and
 * `selectors` are CSS selectors for the real control to spotlight, tried in order; if none is on screen
 * (hidden on a phone, a different mode, local-first notice) the card is simply centered.
 */
export interface TutorialStep { icon: IconName; title: string; body: string; route: string; selectors: string[] }
export interface TutorialSection { id: TutorialCategory; tab: string; short: string; heading: string; steps: TutorialStep[]; tipTitle: string; tip: string; visit: string }

export const TUTORIAL: TutorialSection[] = [
  {
    id: "design", tab: "1 · Design", short: "Design", heading: "Design an Exam", visit: "/designer",
    steps: [
      { icon: "list", route: "/", selectors: ['[data-testid="quick-actions"]'], title: "Start from your Dashboard",
        body: "Your Dashboard has four quick actions (Design Exam, Scan Sheets, Grade Exam and Reports) and lists your recent examinations. You can use the navigation menu to move between pages at any time." },
      { icon: "upload", route: "/designer", selectors: ['[data-testid="designer-steps"]'], title: "Follow the three steps",
        body: "Design Exam has three steps: Exam Details, Answer Sheet, and Review & Download. In Exam Details, name your exam and, if you like, drop your course syllabus PDF to fill in the outcomes and the Table of Specifications for you." },
      { icon: "sliders", route: "/designer", selectors: ['[data-testid="step-tab-2"]'], title: "Choose the answer sheet",
        body: "Open step 2, Answer Sheet. Tap a Quick Preset (20, 50 or 100 items) for a print-ready sheet in one click, then adjust the paper size, student ID digits, exam sets and question sections." },
      { icon: "download", route: "/designer", selectors: ['[data-testid="design-canvas"]'], title: "Check the preview, then download",
        body: "The preview shows exactly what will print. When the status says Ready to Print, open step 3, Review & Download, and click Download Answer Sheet (PDF). Layout and developer options are tucked away under Advanced." },
    ],
    tipTitle: "Pro Tip", tip: "Always print at “100% / Actual Size” (never “Fit to Page”) so the corner fiducial markers align cleanly during scanning.",
  },
  {
    id: "scan", tab: "2 · Scan", short: "Scan", heading: "Scan & Upload", visit: "/scan",
    steps: [
      { icon: "qr", route: "/scan", selectors: ['[aria-label="How to scan"]'], title: "Choose how to scan",
        body: "Use Upload Files for photos or scans you already have, or Use Camera to scan with your phone or webcam. The layout comes from the exam you designed, and the QR code on each sheet double-checks it." },
      { icon: "camera", route: "/scan", selectors: ['[data-testid="scan-primary"]'], title: "Add your sheets",
        body: "In Upload Files, drag photos into the box or choose them. In Use Camera, line up the four corner brackets with the black corner squares, then press Scan Now." },
      { icon: "wand", route: "/scan", selectors: ['[data-testid="autosnap-toggle"]'], title: "Let Auto-Snap do the work",
        body: "With Auto-Snap on, the camera scans by itself once all four corners hold steady, and a quick result shows the student ID, set and score. The Scanning tips below help when a sheet will not read." },
      { icon: "list", route: "/scan", selectors: ['[data-testid="scan-queue"]'], title: "Follow the queue, then grade",
        body: "Every sheet shows as Waiting, Scanning, Done or Needs review. When your sheets are finished, click Proceed to Grade." },
    ],
    tipTitle: "Pro Tip", tip: "Avoid heavy shadows across the four corner registration marks, and ask students to fill bubbles completely with dark ink or an HB/2B pencil.",
  },
  {
    id: "grade", tab: "3 · Grade", short: "Grade", heading: "Gradebook & Reports", visit: "/grade",
    steps: [
      { icon: "chart", route: "/grade", selectors: ['[data-testid="grade-nav"]', '[data-testid="gradebook-empty"]'], title: "Find your way around",
        body: "Results lists every scored sheet. Answer Key sets the correct answers. Review Exceptions handles duplicate scans and class-list problems. Item Analysis and OBE Outcomes are your reports." },
      { icon: "key", route: "/grade?tab=key", selectors: ['[data-testid="key-canvas"]', '[data-testid="nav-key"]'], title: "Set the answer key",
        body: "Click the bubbles to set the correct answers for each exam set (mark two for alternate credit), or import a key. The scoring rules and key tools sit beside the key." },
      { icon: "refresh", route: "/grade?tab=key", selectors: ['[data-testid="key-status"]'], title: "Scores update by themselves",
        body: "Change a key, a point weight or a bonus and every paper is rescored instantly, with no rescanning. This line shows how many questions are keyed and how many papers are scanned." },
      { icon: "download", route: "/grade", selectors: ['[data-testid="export-menu"]', '[data-testid="gradebook-empty"]'], title: "Export your records",
        body: "Use Export for Excel, CSV or student scorecards. Item Analysis shows how each question performed, and OBE Outcomes shows course-outcome attainment and can export the accreditation PDF." },
    ],
    tipTitle: "Pro Tip", tip: "Found an ambiguous question after scanning? Change its key or mark it as a bonus in the Answer Key tab. Every student’s score updates automatically, with no rescanning.",
  },
  {
    id: "admin", tab: "Admin", short: "Admin", heading: "Administration", visit: "/admin",
    steps: [
      { icon: "chart", route: "/admin?view=overview", selectors: ['[data-testid="admin-overview"]'], title: "See the school at a glance",
        body: "The Overview shows faculty accounts, pending access requests, syllabi and examinations for the whole school." },
      { icon: "users", route: "/admin?view=overview", selectors: ['[data-testid="system-modules"]'], title: "Open a management area",
        body: "Faculty Management changes roles. User Access & Roles approves requests or pre-authorizes @usa.edu.ph emails. Syllabi Management, Audit Trail and Policy & Grading (domains and the grading formula) each have their own page." },
      { icon: "shield", route: "/admin?view=overview", selectors: ['[data-testid="recent-activity"]'], title: "Keep an eye on changes",
        body: "Recent System Activity lists answer-key updates, grade corrections and admin actions. Open the Audit Trail to search all of them." },
    ],
    tipTitle: "Good to know", tip: "Admin tools are for EdTech staff, supervisors and deans. Teachers who open /admin see a clear “Admins only” message, and the server enforces this too.",
  },
];

export const sectionFor = (id: TutorialCategory) => TUTORIAL.find((s) => s.id === id)!;
