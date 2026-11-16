"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { classFromRoster, classToRoster, removeClass, summarizeClass, upsertClass, type SavedClass } from "@/lib/classes/classes";
import { readClasses, writeClasses } from "@/lib/classes/class-store";
import type { ClassesPort } from "@/lib/classes/port";

/** Classes kept on this device (local-first mode). */
export function useLocalClasses(): ClassesPort {
  const [list, setList] = useState<SavedClass[] | undefined>(undefined);
  useEffect(() => { let live = true; readClasses().then((l) => { if (live) setList(l); }); return () => { live = false; }; }, []);

  const save = useCallback<ClassesPort["save"]>(async (name, section, roster) => {
    const current = await readClasses();   // re-read: another tab may have saved since
    const r = upsertClass(current, classFromRoster(roster, name, section), { now: Date.now(), newId: () => crypto.randomUUID() });
    if ("error" in r) return r.error;
    try { await writeClasses(r.list); } catch { return "Could not save on this device. Is browser storage blocked?"; }
    setList(r.list);
    return null;
  }, []);
  const load = useCallback<ClassesPort["load"]>(async (id) => {
    const c = (await readClasses()).find((x) => x.id === id);
    return c ? classToRoster(c, Date.now()) : null;
  }, []);
  const remove = useCallback<ClassesPort["remove"]>(async (id) => {
    try { const next = removeClass(await readClasses(), id); await writeClasses(next); setList(next); return null; } catch { return "Could not remove the class."; }
  }, []);

  return useMemo(() => ({ where: "device", list: list?.map(summarizeClass), save, load, remove }), [list, save, load, remove]);
}
