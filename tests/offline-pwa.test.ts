import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import manifest from "../src/app/manifest";
import { formatScanAnnouncement } from "@/lib/scan-announcer";

describe("Phase C: Offline PWA & cache headers", () => {
  it("opens the installed PWA at /", () => {
    expect(manifest().start_url).toBe("/");
  });

  it("configures immutable Cache-Control for /vendor/* and no-cache for /sw.js", async () => {
    const rules = await nextConfig.headers!();
    const vendor = rules.find((r) => r.source.includes("/vendor"));
    const sw = rules.find((r) => r.source === "/sw.js");
    expect(vendor?.headers.find((h) => h.key.toLowerCase() === "cache-control")?.value).toContain("immutable");
    expect(sw?.headers.find((h) => h.key.toLowerCase() === "cache-control")?.value).toContain("no-cache");
  });

  it("provides public/sw.js precaching the OpenCV worker and app routes", () => {
    const swPath = join(process.cwd(), "public/sw.js");
    expect(existsSync(swPath)).toBe(true);
    const sw = readFileSync(swPath, "utf8");
    expect(sw).toContain("/vendor/opencv-4.10.0-release.1.js");
    for (const route of ['"/"', '"/designer"', '"/scan"', '"/grade"', '"/admin"']) {
      expect(sw).toContain(route);
    }
    expect(sw).toContain("extractWebpackChunks");
    expect(sw).toContain("/manifest.webmanifest");
    expect(sw).toContain("origin !== self.location.origin");
  });

  it("labels the status badge Online when connected and Offline when disconnected", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shell/OfflineStatus.tsx"), "utf8");
    expect(src).toContain('{!online ? "Offline" : "Online"}');
    expect(src).not.toContain("Ready to scan offline");
  });

  it("only reloads on controllerchange when replacing an existing service worker", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shell/OfflineStatus.tsx"), "utf8");
    expect(src).toContain("reloadOnControl = !!navigator.serviceWorker.controller");
  });
});

describe("Phase D: Scan screen-reader announcements", () => {
  it("formats clear polite announcements for done, flagged, and failed scans", () => {
    expect(formatScanAnnouncement({
      status: "done",
      rollNumber: "240103",
      studentName: "Olivia Aquino",
      scoreText: "18/20",
      flaggedCount: 0,
    })).toContain("Olivia Aquino");

    expect(formatScanAnnouncement({
      status: "done",
      rollNumber: null,
      studentName: null,
      scoreText: null,
      flaggedCount: 2,
    })).toContain("2 flagged");

    expect(formatScanAnnouncement({
      status: "error",
      errorMessage: "Could not find all 4 corner markers",
    })).toContain("Could not find all 4 corner markers");
  });
});
