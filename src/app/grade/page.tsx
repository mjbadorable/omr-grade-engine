import type { Metadata } from "next";
import { Suspense } from "react";
import GradeRoot from "@/components/grading/GradeRoot";

export const metadata: Metadata = { title: "Gradebook", description: "Answer keys, live rescoring, item analysis and Augustinian outcomes attainment." };

export default function GradePage() {
  return <Suspense fallback={null}><GradeRoot /></Suspense>;
}
