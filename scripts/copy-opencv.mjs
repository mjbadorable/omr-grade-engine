// Copies the pinned OpenCV.js build into public/vendor so the scanner worker can load it
// with importScripts() (cacheable static asset, never part of the main JS bundles).
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("@techstark/opencv-js/package.json");
const src = require.resolve("@techstark/opencv-js");
const outDir = path.join(process.cwd(), "public", "vendor");
const out = path.join(outDir, `opencv-${pkg.version}.js`);
mkdirSync(outDir, { recursive: true });
if (!existsSync(out) || statSync(out).size !== statSync(src).size) copyFileSync(src, out);
console.log(`opencv.js ${pkg.version} -> ${path.relative(process.cwd(), out)}`);
