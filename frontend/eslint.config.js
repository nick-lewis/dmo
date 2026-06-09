import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Focused lint setup: the react-hooks rules guard hook ordering and effect
// dependency arrays. Intentional dependency omissions carry an inline
// eslint-disable comment explaining why. The wider react-hooks "recommended"
// set (React Compiler rules) is not enabled yet; existing code predates it.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
