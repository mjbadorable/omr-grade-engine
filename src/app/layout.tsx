import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";

export const metadata: Metadata = {
  title: "OMR Sheet Designer",
  description: "Deterministic OMR answer-sheet designer with coordinate-mapped vector PDF export.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased"><ConvexClientProvider>{children}</ConvexClientProvider></body>
    </html>
  );
}
