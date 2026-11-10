import type { ItemQuality } from "@/lib/grading/types";

const STYLE: Record<ItemQuality, { dot: string; badge: string; label: string }> = {
  STRONG: { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", label: "Strong" },
  AVERAGE: { dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", label: "Average" },
  POOR: { dot: "bg-red-500", badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300", label: "Poor" },
};

export function QualityDot({ quality }: { quality: ItemQuality }) {
  return <span className={`inline-block size-2.5 rounded-full ${STYLE[quality].dot}`} title={STYLE[quality].label} aria-label={STYLE[quality].label} />;
}

export default function QualityBadge({ quality, miskey }: { quality: ItemQuality; miskey?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STYLE[quality].badge}`}>
      <span className={`size-1.5 rounded-full ${STYLE[quality].dot}`} />
      {miskey ? "Miskey?" : STYLE[quality].label}
    </span>
  );
}
