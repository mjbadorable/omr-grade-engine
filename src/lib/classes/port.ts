/** What the roster panel needs from "somewhere that keeps classes": this device, or the school's cloud. */
import type { Roster } from "@/lib/roster/schema";

export interface ClassListItem { id: string; name: string; section?: string | null; count: number }

export interface ClassesPort {
  where: "device" | "cloud";
  /** undefined while loading */
  list: ClassListItem[] | undefined;
  /** save the roster as a class; resolves with an error message, or null when saved */
  save: (name: string, section: string | undefined, roster: Roster) => Promise<string | null>;
  /** a copy of the class as a roster, ready to attach to the exam */
  load: (id: string) => Promise<Roster | null>;
  /** resolves with an error message, or null */
  remove: (id: string) => Promise<string | null>;
}
