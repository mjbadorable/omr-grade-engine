import type { TutorialCategory } from "./tutorial-state";

export type IconName = "upload" | "sliders" | "download" | "qr" | "camera" | "wand" | "key" | "refresh" | "chart" | "users" | "shield" | "list" | "book" | "layers" | "bolt";
/**
 * One guided step. `route` is the page the step lives on (it may carry a query such as `?tab=key`) and
 * `selectors` are CSS selectors for the real control to spotlight, tried in order; if none is on screen
 * (hidden on a phone, a different mode, local-first notice) the card is simply centered.
 */
export interface TutorialStep { icon: IconName; title: string; body: string; route: string; selectors: string[] }
export interface TutorialSection { id: TutorialCategory; tab: string; short: string; heading: string; steps: TutorialStep[]; tipTitle: string; tip: string; visit: string }

export const TUTORIAL: TutorialSection[] = [
  {
    id: "dashboard", tab: "1 · Dashboard", short: "Dashboard", heading: "Dashboard & Courses", visit: "/",
    steps: [
      { icon: "book", route: "/", selectors: ['[data-testid="my-courses"]', '[data-testid="at-a-glance"]'], title: "Organize by Course",
        body: "The strip on top counts your Course, Sections, Examinations and sheets For Grading (a dash means it is still loading). Below it, My Course holds the course you are working in: + Add Course makes a new one, switcher pills appear when you have several, Edit Course changes it, and Delete removes it while its exams stay in your library, unfiled." },
      { icon: "layers", route: "/", selectors: ['[data-testid="course-sections"]'], title: "Manage Sections & Bulk Apply",
        body: "Add a section with New section, link a saved class roster to it, or use Import a class roster to bring one in. Tick sections (or Select all), choose a design, and Apply Design creates one exam per selected section in a single step. Each row also has Design Exam for that section and a ⋮ menu to remove it." },
      { icon: "list", route: "/", selectors: ['[data-testid="course-exams"]'], title: "Filter, Open, Scan & Reprint",
        body: "Section pills filter the table, and an exam’s name opens it in the Gradebook. The ⋯ menu has Open Gradebook, Scan Sheets, Print Sheet PDF (the stored sheet, no designing again), Copy, Archive or Restore, and Delete. View All → opens every exam with your Semester Folders." },
      { icon: "bolt", route: "/", selectors: ['[data-testid="quick-actions"]'], title: "Jump Anywhere from Quick Actions",
        body: "Design Exam starts a new sheet for the course you are viewing, Scan & Upload goes to scanning, and View Gradebook opens your results. Reports → jumps straight to the Item Analysis report." },
    ],
    tipTitle: "Pro Tip", tip: "Design once, then tick every section and Apply Design to make all their exams together. Need extra blank copies later? Open ⋯ → Print Sheet PDF on any exam.",
  },
  {
    id: "design", tab: "2 · Design", short: "Design", heading: "Design an Exam", visit: "/designer",
    steps: [
      { icon: "upload", route: "/designer", selectors: ['[data-testid="course-context-banner"]', '[data-testid="designer-steps"]'], title: "Follow the three steps",
        body: "Design Exam has three steps: Exam Details, Answer Sheet, and Review & Download. Opened from a course, a banner pre-fills the title and course line and lets you pick a section or Bulk Apply to Sections. In Exam Details you can also drop your syllabus PDF to fill in the outcomes and the Table of Specifications." },
      { icon: "sliders", route: "/designer", selectors: ['[data-testid="step-tab-2"]'], title: "Choose the answer sheet",
        body: "Open step 2, Answer Sheet. Tap a Quick Preset (20, 50 or 100 items) for a print-ready sheet in one click, then adjust the paper size, student ID digits, exam sets A to F, and multiple-choice, numeric or matching sections." },
      { icon: "download", route: "/designer", selectors: ['[data-testid="design-canvas"]'], title: "Check the preview, then download",
        body: "The preview shows exactly what will print. When the status says Ready to Print, open step 3, Review & Download, and download the sheet as a PDF or PNG. Layout and developer options are tucked away under Advanced." },
    ],
    tipTitle: "Pro Tip", tip: "Always print at “100% / Actual Size” (never “Fit to Page”) so the corner fiducial markers align cleanly during scanning.",
  },
  {
    id: "scan", tab: "3 · Scan", short: "Scan", heading: "Scan & Upload", visit: "/scan",
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
    id: "grade", tab: "4 · Grade", short: "Grade", heading: "Gradebook & Reports", visit: "/grade",
    steps: [
      { icon: "chart", route: "/grade", selectors: ['[data-testid="grade-nav"]', '[data-testid="gradebook-empty"]'], title: "Find your way around",
        body: "Results lists every scored sheet, with section pills to filter it when your class list has two or more sections. Answer Key sets the correct answers. Review Exceptions handles duplicate scans and class-list problems. Item Analysis and OBE Outcomes are your reports." },
      { icon: "key", route: "/grade?tab=key", selectors: ['[data-testid="key-canvas"]', '[data-testid="nav-key"]'], title: "Set the answer key",
        body: "Click the bubbles to set the correct answers for each exam set: mark two for alternate credit, or tap ★ to give everyone full credit on a question. Scoring rules and Grading Scale & Key Tools sit beside the key, with Letter, Percent, Philippine college and USA Grading (1.0 to 5.0) presets plus your own saved scales." },
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
