import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The source uses NodeNext-style ".js" import specifiers that actually point at
// ".ts" files (e.g. `import { logger } from "./logger.js"`). Vite doesn't rewrite
// those by default, so map relative "*.js" → "*.ts" when the .ts file exists.
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
    include: ["src/**/*.test.ts"],
    clearMocks: true,
  },
});
