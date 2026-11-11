"use client";
import { CloudExamProvider } from "@/components/cloud/CloudExam";
import { useCloudSession } from "@/components/cloud/CloudSession";
import GradeApp from "./GradeApp";

/** Mounts the live Convex exam data only when cloud mode is configured. */
export default function GradeRoot() {
  const session = useCloudSession();
  return session ? <CloudExamProvider><GradeApp /></CloudExamProvider> : <GradeApp />;
}
