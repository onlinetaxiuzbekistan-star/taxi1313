import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.resolve(artifactDir, "tools/simulation/autodispatch-engine-test.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(artifactDir, "dist/autodispatch-engine-test.mjs"),
  external: ["ws", "pg"],
  // ESM interop for CJS deps (jsonwebtoken) bundled into an ESM output.
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: "error",
});

console.log("autodispatch-engine-test built.");
