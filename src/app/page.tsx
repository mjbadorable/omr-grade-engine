import type { Metadata } from "next";
import Dashboard from "@/components/dashboard/Dashboard";

export const metadata: Metadata = { title: "Dashboard", description: "Design exams, scan answer sheets and grade them, with your recent examinations at a glance." };

export default function Home() {
  return <Dashboard />;
}
