"use client";
/**
 * 3D crystal custom dropdown listbox rendered in a document.body portal.
 * Replaces native OS <select> popups with frosted glass depth, smooth entrance motion,
 * full keyboard navigation, and 44px coarse-pointer touch targets.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

export interface SelectProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  dataTestId?: string;
  className?: string;
  size?: "sm" | "md";
}

interface PopPos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  flip: boolean;
}

export default function Select({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  ariaLabel,
  dataTestId,
  className = "w-full",
  size = "md",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [pos, setPos] = useState<PopPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const typeBuf = useRef("");
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const firstEnabled = () => options.findIndex((o) => !o.disabled);
  const selectedEnabledIdx = () => {
    const idx = options.findIndex((o) => o.value === value && !o.disabled);
    return idx >= 0 ? idx : firstEnabled();
  };

  const stepEnabled = (from: number, dir: 1 | -1): number => {
    if (!options.length) return -1;
    let i = from;
    for (let k = 0; k < options.length; k++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i]?.disabled) return i;
    }
    return -1;
  };

  const openMenu = (initialIdx?: number) => {
    if (disabled || !options.some((o) => !o.disabled)) return;
    setActiveIdx(initialIdx !== undefined ? initialIdx : selectedEnabledIdx());
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) requestAnimationFrame(() => btnRef.current?.focus());
  };

  const commit = (opt: SelectOption) => {
    if (opt.disabled) return;
    closeMenu(true);
    if (opt.value !== value) onChange(opt.value);
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom - 10;
      const spaceAbove = r.top - 10;
      const estHeight = Math.min(280, Math.max(88, options.length * 38 + 20));
      const flip = spaceBelow < estHeight && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(300, flip ? spaceAbove : spaceBelow));
      const width = Math.min(vw - 16, Math.max(r.width, 168));
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      setPos(
        flip
          ? { left, width, bottom: vh - r.top + 6, maxHeight, flip: true }
          : { left, width, top: r.bottom + 6, maxHeight, flip: false },
      );
    };
    place();
    window.addEventListener("resize", place);
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      closeMenu(false);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      closeMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-opt-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.key === "ArrowUp" ? stepEnabled(0, -1) : selectedEnabledIdx());
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "Tab") {
      closeMenu(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx((cur) => stepEnabled(cur < 0 ? -1 : cur, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx((cur) => stepEnabled(cur < 0 ? 0 : cur, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx(firstEnabled());
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx(stepEnabled(0, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const opt = options[activeIdx];
      if (opt && !opt.disabled) commit(opt);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation();
      typeBuf.current = `${typeBuf.current}${e.key.toLowerCase()}`;
      if (typeTimer.current) clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(() => { typeBuf.current = ""; }, 450);
      const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typeBuf.current));
      if (hit >= 0) setActiveIdx(hit);
    }
  };

  const sizeCls = size === "sm" ? "min-h-8 px-2.5 py-1 text-xs" : "min-h-9 px-3 py-1.5 text-sm";

  return (
    <>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={open && activeIdx >= 0 ? `${listId}-opt-${activeIdx}` : undefined}
        data-testid={dataTestId}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={`v-select-trigger inline-flex items-center justify-between gap-2 rounded-lg text-left font-medium ${sizeCls} ${open ? "is-open" : ""} ${disabled ? "cursor-not-allowed opacity-45" : ""} ${className} [@media(pointer:coarse)]:min-h-11`}
      >
        <span className={`min-w-0 truncate ${selected ? "text-[var(--fg)]" : "text-[var(--muted)]"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`size-4 shrink-0 text-[var(--muted)] transition-transform duration-200 ${open ? "rotate-180 text-[var(--brand)]" : ""}`}
        >
          <path d="M5.5 7.5L10 12l4.5-4.5" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel ?? "Options"}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
            }}
            data-flip={pos.flip ? "up" : "down"}
            className="v-select-popover z-[70] overflow-y-auto p-1.5"
          >
            {options.map((opt, idx) => {
              const prevGroup = idx > 0 ? options[idx - 1]?.group : undefined;
              const showGroup = !!opt.group && opt.group !== prevGroup;
              const isSelected = opt.value === value;
              const isActive = idx === activeIdx;
              return (
                <div key={`${opt.value}:${idx}`}>
                  {showGroup && (
                    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {opt.group}
                    </div>
                  )}
                  <div
                    id={`${listId}-opt-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled || undefined}
                    data-opt-idx={idx}
                    onMouseEnter={() => { if (!opt.disabled) setActiveIdx(idx); }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(opt)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors [@media(pointer:coarse)]:min-h-11 ${
                      opt.disabled
                        ? "cursor-not-allowed opacity-40"
                        : isSelected
                          ? "cursor-pointer bg-[var(--brand-tint)] font-semibold text-[var(--brand-text-on-tint)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-none"
                          : isActive
                            ? "cursor-pointer bg-zinc-100 text-[var(--fg)] dark:bg-zinc-800/85"
                            : "cursor-pointer text-[var(--fg)] hover:bg-zinc-100/90 dark:hover:bg-zinc-800/70"
                    }`}
                  >
                    <span className="min-w-0 truncate">{opt.label}</span>
                    {isSelected && (
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 shrink-0 text-[var(--brand)]">
                        <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
