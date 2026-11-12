import type { Metadata } from "next";
import ScannerApp from "@/components/scanner/ScannerApp";

export const metadata: Metadata = { title: "Scanner", description: "On-device answer-sheet scanner: instant mobile grading, no upload needed to read marks." };

export default function ScanPage() {
  return <ScannerApp />;
}
