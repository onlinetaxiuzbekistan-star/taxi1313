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
    // Enforced coverage gate (>30%) over the critical/tested layer (money, auth,
    // services, request validation, webhook compare). The full codebase incl.
    // admin-CRUD and simulation is intentionally out of scope for this floor.
    coverage: {
      enabled: true,
      provider: "v8",
      include: [
        "src/lib/ledger.ts",
        "src/lib/completion.ts",
        "src/lib/secure-compare.ts",
        "src/lib/services/**",
        "src/middlewares/validate.ts",
        "src/middlewares/request-schemas.ts",
      ],
      reporter: ["text-summary"],
      thresholds: { statements: 30, lines: 30 },
    },
  },
});
