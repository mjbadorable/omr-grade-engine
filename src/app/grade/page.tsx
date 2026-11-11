import type { Metadata } from "next";
import GradeRoot from "@/components/grading/GradeRoot";

export const metadata: Metadata = { title: "Gradebook", description: "Answer keys, live rescoring, gradebook and item analysis." };

export default function GradePage() {
  return <GradeRoot />;
}
