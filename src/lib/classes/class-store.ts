/** This device's saved classes (IndexedDB `meta`, one list). Used in local-first mode, i.e. without the cloud. */
import { getMeta, setMeta } from "@/lib/storage/scan-store";
import { parseSavedClasses, type SavedClass } from "./classes";

const KEY = "classes:v1";

export async function readClasses(): Promise<SavedClass[]> {
  return parseSavedClasses(await getMeta<unknown>(KEY).catch(() => null));
}

export async function writeClasses(list: readonly SavedClass[]): Promise<void> {
  await setMeta(KEY, [...list]);
}
