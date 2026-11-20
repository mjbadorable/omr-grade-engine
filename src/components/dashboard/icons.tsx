/** Small outline icons for the dashboard panels (24px grid, currentColor, decorative). */
const P: Record<string, string> = {
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6M9 11h4",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-3A3.5 3.5 0 0 0 6 17.5V19M11 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1.2a3.2 3.2 0 0 0-2.4-3.1M15.6 5.2a3 3 0 0 1 0 5.6",
  doc: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  check: "M5 12l4 4 10-10M5 5h4M5 19h4",
  upload: "M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 15V4M8 8l4-4 4 4",
};

export function GlyphIcon({ id, className = "size-5" }: { id: keyof typeof P; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[id]} /></svg>;
}

/** Crimson laptop-with-checklist line art for the active-course card. */
export function CourseArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="30" y="18" width="100" height="66" rx="7" fill="var(--brand-tint)" />
      <rect x="38" y="26" width="84" height="50" rx="3" fill="var(--surface)" />
      <path d="M16 96h128l-8 10H24z" fill="var(--brand-tint)" />
      <path d="M48 40l4 4 7-8M66 40h40M48 56l4 4 7-8M66 56h30" />
      <circle cx="116" cy="62" r="2" fill="var(--gold)" stroke="none" />
    </svg>
  );
}

/**
 * Decorative campus backdrop across app pages: subtle top-right Augustinian belfry/facade
 * watermark behind translucent glass cards and a slim crimson-and-gold bottom wave ribbon.
 */
export function CampusBackdrop() {
  return (
    <div aria-hidden="true" data-testid="campus-backdrop" className="pointer-events-none select-none print:hidden absolute inset-0 -z-10 overflow-hidden">
      {/* Warm top-right ambient tint so frosted KPI cards catch the watermark cleanly */}
      <div className="absolute right-0 top-0 z-0 h-[420px] w-full max-w-[680px] bg-[radial-gradient(520px_360px_at_88%_10%,rgba(142,27,32,0.07),transparent_72%)] dark:bg-[radial-gradient(520px_360px_at_88%_10%,rgba(224,62,69,0.09),transparent_72%)]" />

      {/* Top-right Augustinian bell-tower & archway silhouette watermark */}
      <svg
        viewBox="0 0 360 320"
        className="absolute right-1 top-1 z-0 w-[240px] text-[var(--brand)] opacity-[0.09] dark:opacity-[0.12] sm:right-5 sm:top-2 sm:w-[300px] lg:w-[340px]"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="usa-belfry-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.88" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="url(#usa-belfry-fade)">
          {/* Central cross finial */}
          <rect x="178" y="14" width="4" height="26" rx="1.5" />
          <rect x="170" y="21" width="20" height="4" rx="1.5" />

          {/* Swept Baroque central gable + tower */}
          <path d="M180 38C168 54 156 64 138 71V184H222V71C204 64 192 54 180 38ZM164 89A16 16 0 0 1 196 89V113H164V89ZM161 136A19 19 0 0 1 199 136V164H161V136Z" />
          {/* Bells inside upper and lower belfry arches */}
          <path d="M174 106C174 99 176.5 95 180 95C183.5 95 186 99 186 106L188 109H172L174 106Z" />
          <path d="M172 154C172 145 175.5 140 180 140C184.5 140 188 145 188 154L191 158H169L172 154Z" />

          {/* Flanking side spire turrets */}
          <path d="M111 94L125 124V184H97V124L111 94ZM106 142A5 5 0 0 1 116 142V156H106V142Z" />
          <path d="M249 94L263 124V184H235V124L249 94ZM244 142A5 5 0 0 1 254 142V156H244V142Z" />
          <rect x="110" y="83" width="2" height="12" rx="1" />
          <rect x="248" y="83" width="2" height="12" rx="1" />

          {/* Horizontal entablature & cornice trim */}
          <rect x="44" y="182" width="272" height="6" rx="2" />
          <rect x="38" y="191" width="284" height="5" rx="2" />

          {/* Lower colonnade facade + central entrance portal arch + side arched windows */}
          <path d="M46 198H314V296H210V242A30 30 0 0 0 150 242V296H46V198ZM66 226A9 9 0 0 1 84 226V258H66V226ZM104 226A9 9 0 0 1 122 226V258H104V226ZM238 226A9 9 0 0 1 256 226V258H238V226ZM276 226A9 9 0 0 1 294 226V258H276V226Z" />
          {/* Inner sanctuary depth & portico steps */}
          <path d="M161 296V248A19 19 0 0 1 199 248V296H161Z" opacity="0.35" />
          <rect x="32" y="298" width="296" height="6" rx="2" opacity="0.7" />
        </g>
      </svg>

      {/* Bottom crimson-and-gold Augustinian wave ribbon */}
      <svg
        viewBox="0 0 1440 64"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 z-0 h-8 w-full sm:h-11"
        aria-hidden="true"
      >
        <path
          d="M0 44C260 16 540 20 860 36C1100 48 1285 26 1440 10V64H0Z"
          fill="var(--gold)"
          className="opacity-70 dark:opacity-50"
        />
        <path
          d="M0 50C290 22 570 30 890 44C1135 55 1310 34 1440 18V64H0Z"
          fill="var(--brand-solid)"
          className="opacity-90 dark:opacity-80"
        />
      </svg>
    </div>
  );
}
