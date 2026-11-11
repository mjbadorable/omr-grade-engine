import { mulberry32 } from "@/lib/grading/simulate";

const FIRST = ["Ana", "Ben", "Carla", "Diego", "Elena", "Felix", "Grace", "Hiro", "Isabel", "Jonas", "Kira", "Luis", "Maya", "Noah", "Olivia", "Paolo", "Quinn", "Rosa", "Sam", "Tala", "Uma", "Victor", "Wen", "Ximena", "Yusuf", "Zara"];
const LAST = ["Santos", "Reyes", "Cruz", "Garcia", "Tan", "Lim", "Nguyen", "Okafor", "Silva", "Bautista", "Kumar", "Mendoza", "Ramos", "Aquino", "Chen", "Dela Cruz", "Torres", "Flores", "Castillo", "Navarro"];

export function studentName(i: number, seed = 1): string {
  const r = mulberry32(seed * 7919 + i * 104729);
  return `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
}
