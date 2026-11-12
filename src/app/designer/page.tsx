import type { Metadata } from "next";
import SheetDesigner from "@/components/designer/SheetDesigner";

export const metadata: Metadata = { title: "Sheet Designer", description: "Design coordinate-mapped answer sheets, or drop a syllabus to configure the exam automatically." };

export default function DesignerPage() {
  return <SheetDesigner />;
}
