import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT } from "@/components/brand/ThemeToggle";

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsx(p));
    else if (entry.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("Option 1 editorial-slop-guard tokens & motion", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("defines all six required semantic CSS token names", () => {
    for (const token of ["--bg-canvas", "--bg-surface", "--text-primary", "--text-muted", "--border-hairline", "--accent-primary"]) {
      expect(css).toContain(`${token}:`);
    }
  });

  it("supports [data-motion='reduced'] in globals.css and THEME_INIT_SCRIPT", () => {
    expect(css).toContain('[data-motion="reduced"]');
    expect(THEME_INIT_SCRIPT).toContain("data-motion");
  });

  it("has no banned from-indigo- gradients or animate-pulse in src/components", () => {
    for (const file of walkTsx(join(process.cwd(), "src/components"))) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from-indigo-/);
      expect(src, file).not.toMatch(/\banimate-pulse\b/);
    }
  });
});
