import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Enforced dependency rules (architecture section 5, CLAUDE.md "Project guardrails").
 * Each group is forbidden everywhere except in the directory that owns it.
 *
 * Interpretation logged in the tracker: `src/server/db` (client factory, schema, migrations) is
 * the internals of the repository layer (architecture section 5), so it may import Drizzle too.
 */
const GROUPS = {
  drizzle: {
    group: ["drizzle-orm", "drizzle-orm/*", "drizzle-kit", "@neondatabase/serverless"],
    message: "Only src/server/repositories (and its src/server/db internals) may import Drizzle or the Neon driver.",
  },
  neonAuth: {
    group: ["@neondatabase/auth", "@neondatabase/auth/*", "otpauth", "better-auth", "better-auth/*", "@better-auth/*"],
    message: "Only src/server/auth may import the Neon Auth SDK, otpauth or Better Auth.",
  },
  storage: {
    group: ["aws4fetch", "@aws-sdk/*"],
    message: "Only src/server/media may import the object storage client.",
  },
  resend: {
    group: ["resend", "resend/*"],
    message: "Resend was removed (ADR-036). Nothing may import it.",
  },
  adminLibs: {
    group: ["recharts", "recharts/*", "**/components/admin/**", "@/components/admin/*", "**/shadcn/**"],
    message: "Admin libraries and components must never reach a public route or public component.",
  },
};

const restrict = (...names) => ({
  "no-restricted-imports": ["error", { patterns: names.map((n) => GROUPS[n]) }],
});

const everything = ["drizzle", "neonAuth", "storage", "resend"];
const without = (name) => everything.filter((n) => n !== name);

const config = [
  { ignores: [".next/**", ".open-next/**", "node_modules/**", "public/sw.js", "public/swe-worker-*.js", "next-env.d.ts", "cloudflare-env.d.ts", ".lighthouseci/**", "playwright-report/**", "test-results/**", ".wrangler/**", "scripts/.generated/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      ...restrict(...everything),
    },
  },
  // Each owner directory may import its own package (and still not the others).
  { files: ["src/server/repositories/**", "src/server/db/**", "drizzle.config.ts"], rules: restrict(...without("drizzle")) },
  { files: ["src/server/auth/**"], rules: restrict(...without("neonAuth")) },
  { files: ["src/server/media/**"], rules: restrict(...without("storage")) },
  // Public components: additionally no admin libraries.
  { files: ["src/components/public/**", "src/app/**/(public)/**"], rules: restrict(...everything, "adminLibs") },
  // Tests and tooling may reach the drivers directly to build fixtures; boundary tests live in tests/unit.
  { files: ["tests/**", "scripts/**", "worker/**"], rules: { "no-restricted-imports": "off" } },
];

export default config;
