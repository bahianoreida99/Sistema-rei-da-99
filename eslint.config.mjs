import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

export default ts.config(
  { ignores: [".next/**", "node_modules/**", "backend/dist/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        globalThis: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        Request: "readonly",
        Response: "readonly",
        AbortSignal: "readonly",
        window: "readonly",
        document: "readonly",
        confirm: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        React: "readonly",
        Blob: "readonly",
        BlobPart: "readonly",
        FormData: "readonly",
        HTMLSelectElement: "readonly",
      },
    },
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
