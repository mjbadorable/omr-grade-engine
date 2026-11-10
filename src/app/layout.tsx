import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OMR Sheet Designer",
  description: "Deterministic OMR answer-sheet designer with coordinate-mapped vector PDF export.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
