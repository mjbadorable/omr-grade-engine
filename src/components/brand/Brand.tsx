import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** App mark: crimson tile, white V (verified tick), gold bubble. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#8E1B20" />
      <path d="M14 18 32 48 50 18" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="14" r="5" fill="#C89211" />
    </svg>
  );
}

/** Header lockup: mark + VERITAS + institution badge, with the acronym expansion as tooltip. */
export default function Brand({ page }: { page?: string }) {
  return (
    <h1 className="flex items-center gap-2.5" title={`${BRAND.name}: ${BRAND.expansion}`}>
      <Link href="/designer" className="flex items-center gap-2" aria-label={`${BRAND.name}, ${BRAND.institution}`}>
        <BrandMark />
        <span className="text-[15px] font-bold tracking-[0.14em] text-zinc-900 dark:text-zinc-100">{BRAND.name}</span>
      </Link>
      <span className="hidden rounded-full border border-gold/40 bg-gold-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-hover sm:inline dark:text-gold" data-testid="brand-badge">{BRAND.badge}</span>
      {page && <span className="text-sm font-medium text-zinc-500">{page}</span>}
    </h1>
  );
}

/** Empty-state hero: brand mark, headline, one-liner. */
export function EmptyHero({ title, children, className = "" }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto max-w-lg text-center ${className}`} data-testid="empty-hero">
      <BrandMark className="mx-auto size-12" />
      <p className="mt-3 text-xs font-semibold tracking-[0.2em] text-indigo-600">{BRAND.name}</p>
      <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{BRAND.tagline}</p>
      {children && <div className="mt-3 text-sm text-zinc-500">{children}</div>}
    </div>
  );
}
