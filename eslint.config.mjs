import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Pre-existing debt in upstream components, flagged by the React Compiler
    // era react-hooks rules. Kept visible as warnings so CI can gate on
    // everything else; tighten again as those components are refactored.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Desktop build staging area (contains a copied Next.js server tree).
    "src-tauri/**",
    // Vite build output and dev-only spike pages.
    "dist/**",
    "spike/**",
  ]),
]);

export default eslintConfig;
