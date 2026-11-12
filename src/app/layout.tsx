import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import AboutModal from "@/components/brand/AboutModal";
import { THEME_INIT_SCRIPT } from "@/components/brand/ThemeToggle";
import { BRAND } from "@/lib/brand";
import ConvexClientProvider from "./ConvexClientProvider";

const description = `${BRAND.expansion}. ${BRAND.tagline}`;
export const metadata: Metadata = {
  title: { default: BRAND.title, template: `%s · ${BRAND.name}` },
  description,
  applicationName: BRAND.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: BRAND.shortName, statusBarStyle: "default" },
  openGraph: { title: BRAND.title, description, siteName: BRAND.name, type: "website", locale: "en_PH" },
  twitter: { card: "summary", title: BRAND.title, description },
  icons: { icon: "/icon.svg", apple: "/icons/veritas-192.png" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: BRAND.themeColor.light }, { media: "(prefers-color-scheme: dark)", color: BRAND.themeColor.dark }],
};

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const app = <ConvexClientProvider>{children}</ConvexClientProvider>;
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body className="antialiased">
        {/* Clerk only when configured, so local-first and dev-auth builds need no Clerk keys */}
        {clerkKey ? <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/grade">{app}</ClerkProvider> : app}
        <AboutModal />
      </body>
    </html>
  );
}
