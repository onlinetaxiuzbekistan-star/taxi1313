// Post-build step: make the modern CSS Tailwind v4 emits work on OLD Android System
// WebViews used by the driver APK (it serves this CSS offline-first). Two problems:
//   1. oklch()/oklab()/color-mix() — unsupported < Chrome 111. lightningcss rewrites
//      these with rgb()/hex fallbacks (progressive enhancement), fixing color.
//   2. @layer — unsupported < Chrome 99. A WebView that doesn't know @layer SKIPS the
//      whole block, so EVERYTHING (layout + colors) vanishes → unstyled page (giant
//      fonts, overlapping header, white background). lightningcss does NOT flatten
//      @layer, so we flatten it with postcss (which tokenises Tailwind's escaped
//      selectors correctly), preserving source order (≈ layer order so utilities still
//      win). We then re-run lightningcss to PROVE the result is valid + re-minify; if
//      flattening ever produced invalid CSS we keep the colors-only output, so a broken
//      stylesheet can never ship.
// Desktop browsers render identically (rgb fallbacks come before the modern values;
// Tailwind utilities stay last in source order so the flattened cascade matches).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", ".."); // scripts -> taxi-app -> artifacts -> repo root
const assetsDir = join(here, "..", "dist", "public", "assets");
const pnpmDir = join(repoRoot, "node_modules", ".pnpm");

function resolvePkg(prefix, sub) {
  const d = readdirSync(pnpmDir).find((x) => x.startsWith(prefix));
  if (!d) throw new Error(`${prefix} not found in node_modules/.pnpm`);
  return join(pnpmDir, d, "node_modules", ...sub);
}

const { transform } = await import(resolvePkg("lightningcss@", ["lightningcss", "node", "index.mjs"]));
const postcss = (await import(resolvePkg("postcss@", ["postcss", "lib", "postcss.mjs"]))).default;

// Old-WebView floor (~late 2020). Version encoded as major<<16 | minor<<8 | patch.
const targets = {
  android: 87 << 16, chrome: 87 << 16, edge: 87 << 16,
  firefox: 78 << 16, safari: (13 << 16) | (1 << 8), ios_saf: (13 << 16) | (4 << 8),
};

const lc = (filename, code) =>
  transform({ filename, code: Buffer.from(code), minify: true, targets, errorRecovery: true }).code.toString();

// Flatten @layer using postcss's parser (escape/string-safe).
function flattenLayers(css) {
  const root = postcss.parse(css);
  let again = true;
  while (again) {
    again = false;
    root.walkAtRules("layer", (at) => {
      again = true;
      if (at.nodes && at.nodes.length) at.replaceWith(at.nodes); // unwrap block (keeps source order)
      else at.remove(); // drop `@layer a, b;` declaration
    });
  }
  return root.toString();
}

const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".css"));
for (const f of cssFiles) {
  const p = join(assetsDir, f);
  const original = readFileSync(p, "utf8");

  // Step 1: rgb/hex fallbacks for oklch/oklab/color-mix (+ minify).
  let result = lc(f, original);

  // Step 2: flatten @layer, then re-validate + re-minify; on any failure keep step 1.
  if (result.includes("@layer")) {
    try {
      const reminified = lc(f, flattenLayers(result)); // throws if flatten produced invalid CSS
      if (!reminified.includes("@layer")) result = reminified;
      else console.warn(`[downlevel-css] ${f}: @layer still present after flatten — kept colors-only`);
    } catch (e) {
      console.warn(`[downlevel-css] ${f}: flatten failed (${e.message}) — kept colors-only`);
    }
  }

  writeFileSync(p, result);
  console.log(`[downlevel-css] ${f}: colors downleveled${result.includes("@layer") ? "" : " + @layer flattened"}`);
}
console.log("[downlevel-css] done");
