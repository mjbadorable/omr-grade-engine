import type { Metadata } from "next";
import SheetDesigner from "@/components/designer/SheetDesigner";

export const metadata: Metadata = { title: "Sheet Designer", description: "Design coordinate-mapped OMR answer sheets." };

export default function DesignerPage() {
  return <SheetDesigner />;
}
