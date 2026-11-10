import type { Metadata } from "next";
import ScannerApp from "@/components/scanner/ScannerApp";

export const metadata: Metadata = { title: "OMR Scanner", description: "On-device OMR answer-sheet scanner (OpenCV.js in a Web Worker)." };

export default function ScanPage() {
  return <ScannerApp />;
}
