import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import ts from "typescript-eslint";
import globals from "globals";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import stylistic from "@stylistic/eslint-plugin";
import stylisticTs from "@stylistic/eslint-plugin-ts";
import stylisticJs from "@stylistic/eslint-plugin-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default ts.config(
  {
    ignores: [
      "**/out",
      "**/dist",
      "**/*.d.ts",
      "**/node_modules/",
      "**/out/",
      "**/*.vsix",
      "**/package-lock.json",
      "eslint.config.mjs"
    ],
  },
  ts.configs.recommended,
  js.configs.recommended,
  stylistic.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: true,
    jsx: false,
    braceStyle: "1tbs"
  }),
  {
    files: ["**/*.cjs"],
    plugins: {
      "@stylistic/js": stylisticJs,
    },
    languageOptions: {
      globals: {
        ...globals.builtin,
        ...globals.node,
      },
      ecmaVersion: 6,
      sourceType: "script"
    },
    rules: {
        // Note: you must disable the base rule as it can report incorrect errors
        "no-unused-vars": ["error",
            {
              "args": "all",
              "argsIgnorePattern": "^_",
              "caughtErrors": "all",
              "caughtErrorsIgnorePattern": "^_",
              "destructuredArrayIgnorePattern": "^_",
              "varsIgnorePattern": "^_",
              "ignoreRestSiblings": true
            },
          ],

        // Typescript Eslint Rules
        "@typescript-eslint/naming-convention": ["warn",
          {
            selector: "default",
            format: ["camelCase"],
            leadingUnderscore: "allowSingleOrDouble",
            trailingUnderscore: "allow",
          },
          {
            selector: 'import',
            format: ['camelCase', 'PascalCase'],
            leadingUnderscore: "allowSingleOrDouble",
          },
          {
            selector: "variable",
            format: ["camelCase", "UPPER_CASE"],
            leadingUnderscore: "allowSingleOrDouble",
            trailingUnderscore: "allow",
          },
          {
            selector: "typeLike",
            format: ["PascalCase"],
            leadingUnderscore: "allow",
          },
        ],
        "@typescript-eslint/no-require-imports": "off",
        "@typescript-eslint/no-inferrable-types": "off",
        "@typescript-eslint/explicit-function-return-type": "warn",
        "@typescript-eslint/explicit-member-accessibility": "warn",
    }
  },
  {
    files: ["**/*.mjs", "**/*.ts"],
    ignores: ["src/**/*.mjs"],
    plugins: {
      "@stylistic/ts": stylisticTs,
    },
    languageOptions: {
      globals: globals.builtin,
      ecmaVersion: 6,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      }
    },
    rules: {
      // Note: you must disable the base rule as it can report incorrect errors
      "no-unused-vars": "off",

      // Typescript Eslint Rules
      "@typescript-eslint/naming-convention": ["warn",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allowSingleOrDouble",
          trailingUnderscore: "allow",
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: "allowSingleOrDouble",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allowSingleOrDouble",
          trailingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
          leadingUnderscore: "allow",
        },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/explicit-member-accessibility": "warn",
      "@typescript-eslint/no-unused-vars": ["error",
        {
          "args": "all",
          "argsIgnorePattern": "^_",
          "caughtErrors": "all",
          "caughtErrorsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "ignoreRestSiblings": true
        },
      ],
    }
  },
  {
    plugins: {
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      // Eslint Rules
      "curly": "warn",
      "eqeqeq": "error",
      "no-redeclare": "error",
      "no-throw-literal": "warn",
      "no-unused-expressions": "error",
      "no-unused-vars": "off",
      "semi": "off",
      "semi-style": "off",

      // Stylistic Rules
      "@stylistic/semi": "warn",
      "@stylistic/operator-linebreak": ["error", "after"],
      "@stylistic/spaced-comment": ["error", "always", {
        line: {
          markers: ["@ts-nocheck"],
        },
      }],

      // Unicorn Rules
      "unicorn/no-array-reduce": "off",
      "unicorn/no-null": "off",
      "unicorn/numeric-separators-style": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
);
