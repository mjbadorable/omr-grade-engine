import type { Metadata } from "next";
import AdminPortal from "@/components/admin/AdminPortal";

export const metadata: Metadata = { title: "Admin", description: "Faculty roles, institutional policy, syllabi repository and audit trail." };

export default function AdminPage() {
  return <AdminPortal />;
}
