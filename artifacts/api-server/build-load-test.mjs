import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.resolve(artifactDir, "src/load-test.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(artifactDir, "dist/load-test.mjs"),
  external: ["ws", "pg"],
  logLevel: "error",
});

console.log("Load test built successfully.");
