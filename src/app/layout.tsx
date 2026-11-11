import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";

export const metadata: Metadata = {
  title: "OMR Grade Engine",
  description: "Design, scan and grade OMR answer sheets.",
};

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const app = <ConvexClientProvider>{children}</ConvexClientProvider>;
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Clerk only when configured, so local-first and dev-auth builds need no Clerk keys */}
        {clerkKey ? <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/grade">{app}</ClerkProvider> : app}
      </body>
    </html>
  );
}
