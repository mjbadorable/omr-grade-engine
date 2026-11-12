import type { Metadata } from "next";
import GradeRoot from "@/components/grading/GradeRoot";

export const metadata: Metadata = { title: "Gradebook", description: "Answer keys, live rescoring, item analysis and Augustinian outcomes attainment." };

export default function GradePage() {
  return <GradeRoot />;
}
