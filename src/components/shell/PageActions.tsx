"use client";
/** Renders a page's status badge and action buttons into the second header tier (see AppHeader). */
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PageActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("page-actions")); }, []);
  return slot ? createPortal(children, slot) : null;
}
