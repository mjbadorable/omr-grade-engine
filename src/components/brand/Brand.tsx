import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** App mark: the VERITAS squircle (white ribbon V, gold dot). */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return <Image src="/logos/veritas-mark.png" alt="" width={128} height={128} unoptimized aria-hidden className={`${className} shrink-0 object-contain`} />;
}

/** Wordmark lockup (mark + VERITAS). Two files swap with the theme so the text stays legible. */
export function BrandLockup({ className = "h-8" }: { className?: string }) {
  return (
    <>
      <Image src="/logos/veritas-lockup.png" alt={BRAND.name} width={834} height={195} unoptimized priority className={`${className} w-auto dark:hidden`} />
      <Image src="/logos/veritas-lockup-dark.png" alt={BRAND.name} width={834} height={195} unoptimized priority className={`${className} hidden w-auto dark:block`} />
    </>
  );
}

/** Header lockup: logo + institution badge, with the acronym expansion as tooltip. */
export default function Brand() {
  return (
    <div className="flex items-center gap-2.5" title={`${BRAND.name}: ${BRAND.expansion}`}>
      <Link href="/designer" className="flex items-center" aria-label={`${BRAND.name}, ${BRAND.institution}`}><BrandLockup className="h-8" /></Link>
      <span className="hidden rounded-full border border-gold/40 bg-gold-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-hover lg:inline dark:text-gold" data-testid="brand-badge">{BRAND.badge}</span>
    </div>
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
