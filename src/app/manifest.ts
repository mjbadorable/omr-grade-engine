import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.title,
    short_name: BRAND.shortName,
    description: `${BRAND.expansion}. ${BRAND.tagline}`,
    start_url: "/designer",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BRAND.backgroundColor,
    theme_color: BRAND.themeColor.light,
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/veritas-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/veritas-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/veritas-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
