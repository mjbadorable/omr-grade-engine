import type { Metadata } from "next";
import GradeApp from "@/components/grading/GradeApp";

export const metadata: Metadata = { title: "Gradebook", description: "Answer keys, live rescoring, gradebook and item analysis." };

export default function GradePage() {
  return <GradeApp />;
}
