import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPortal from "@/components/admin/AdminPortal";

export const metadata: Metadata = { title: "Admin", description: "Faculty roles, institutional policy, syllabi repository and audit trail." };

export default function AdminPage() {
  return <Suspense fallback={null}><AdminPortal /></Suspense>;
}
