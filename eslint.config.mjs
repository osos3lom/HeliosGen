import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist/**",
    // Dev-only spike/test pages.
    "spike/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      // Intentional patterns used throughout: best-effort `catch {}` blocks and
      // `cond && fn()` / ternary statements.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // Unused values are warnings; a leading underscore marks intentional ones.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Pre-existing debt in upstream components, flagged by the React Compiler
      // era react-hooks rules. Kept visible as warnings so CI can gate on
      // everything else; tighten again as those components are refactored.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
]);
