import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Same NodeNext ".js" -> ".ts" resolver as the unit config.
const jsToTsResolver = {
  name: "js-to-ts-resolver",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined) {
    if (importer && source.startsWith(".") && source.endsWith(".js")) {
      const candidate = resolve(dirname(importer), source.slice(0, -3) + ".ts");
      if (existsSync(candidate)) return candidate;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [jsToTsResolver],
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    // Container start + schema push is slow; give hooks/tests plenty of headroom.
    hookTimeout: 180_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
