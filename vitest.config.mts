import { fileURLToPath } from "node:url";
import { transformWithOxc, type Plugin } from "vite";
import { defineConfig as defineVitestConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/**
 * A few unit tests render components to HTML. The project's tsconfig keeps `jsx: "preserve"` because Next.js compiles JSX
 * itself, so Vite is told how to compile `.tsx` for the tests only: the automatic React runtime, nothing else changed.
 */
const tsxForTests: Plugin = {
  name: "tsx-automatic-runtime",
  enforce: "pre",
  async transform(code, id) {
    if (!id.endsWith(".tsx") || id.includes("node_modules")) return null;
    const result = await transformWithOxc(code, id, { lang: "tsx", jsx: { runtime: "automatic" } });
    return { code: result.code, map: result.map };
  },
};

export default defineVitestConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        plugins: [tsxForTests],
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        // Needs a Postgres reachable at TEST_DATABASE_URL (CI uses a service container; see docs/stage-0-runbook.md).
        // The suites skip themselves, loudly, when it is not set.
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
