import next from "@next/eslint-plugin-next";
import parser from "@typescript-eslint/parser";
import typescript from "@typescript-eslint/eslint-plugin";
import hooks from "eslint-plugin-react-hooks";
import a11y from "eslint-plugin-jsx-a11y-x";
import globals from "globals";
import { reactDeprecationRules } from "./eslint.react-deprecations.mjs";

// Preserve the former Next 15 severities/options. React and import checks run
// in the required native gate; React API bans use supported ESLint core rules.
const rules = {
  "react-hooks/rules-of-hooks": [
    2
  ],
  "react-hooks/exhaustive-deps": [
    1
  ],
  "@next/next/google-font-display": [
    1
  ],
  "@next/next/google-font-preconnect": [
    1
  ],
  "@next/next/next-script-for-ga": [
    1
  ],
  "@next/next/no-async-client-component": [
    1
  ],
  "@next/next/no-before-interactive-script-outside-document": [
    1
  ],
  "@next/next/no-css-tags": [
    1
  ],
  "@next/next/no-head-element": [
    1
  ],
  "@next/next/no-html-link-for-pages": [
    2
  ],
  "@next/next/no-img-element": [
    1
  ],
  "@next/next/no-page-custom-font": [
    1
  ],
  "@next/next/no-styled-jsx-in-document": [
    1
  ],
  "@next/next/no-sync-scripts": [
    2
  ],
  "@next/next/no-title-in-document-head": [
    1
  ],
  "@next/next/no-typos": [
    1
  ],
  "@next/next/no-unwanted-polyfillio": [
    1
  ],
  "@next/next/inline-script-id": [
    2
  ],
  "@next/next/no-assign-module-variable": [
    2
  ],
  "@next/next/no-document-import-in-page": [
    2
  ],
  "@next/next/no-duplicate-head": [
    2
  ],
  "@next/next/no-head-import-in-document": [
    2
  ],
  "@next/next/no-script-component-in-head": [
    2
  ],
  "jsx-a11y/alt-text": [
    1,
    {
      "elements": [
        "img"
      ],
      "img": [
        "Image"
      ]
    }
  ],
  "jsx-a11y/aria-props": [
    1
  ],
  "jsx-a11y/aria-proptypes": [
    1
  ],
  "jsx-a11y/aria-unsupported-elements": [
    1
  ],
  "jsx-a11y/role-has-required-aria-props": [
    1
  ],
  "jsx-a11y/role-supports-aria-props": [
    1
  ],
  "@typescript-eslint/ban-ts-comment": [
    2
  ],
  "no-array-constructor": [
    0
  ],
  "@typescript-eslint/no-array-constructor": [
    2
  ],
  "@typescript-eslint/no-duplicate-enum-values": [
    2
  ],
  "@typescript-eslint/no-empty-object-type": [
    2
  ],
  "@typescript-eslint/no-explicit-any": [
    2
  ],
  "@typescript-eslint/no-extra-non-null-assertion": [
    2
  ],
  "@typescript-eslint/no-misused-new": [
    2
  ],
  "@typescript-eslint/no-namespace": [
    2
  ],
  "@typescript-eslint/no-non-null-asserted-optional-chain": [
    2
  ],
  "@typescript-eslint/no-require-imports": [
    2
  ],
  "@typescript-eslint/no-this-alias": [
    2
  ],
  "@typescript-eslint/no-unnecessary-type-constraint": [
    2
  ],
  "@typescript-eslint/no-unsafe-declaration-merging": [
    2
  ],
  "@typescript-eslint/no-unsafe-function-type": [
    2
  ],
  "no-unused-expressions": [
    0,
    {
      "allowShortCircuit": false,
      "allowTernary": false,
      "allowTaggedTemplates": false,
      "enforceForJSX": false,
      "ignoreDirectives": false
    }
  ],
  "@typescript-eslint/no-unused-expressions": [
    1,
    {
      "allowShortCircuit": false,
      "allowTaggedTemplates": false,
      "allowTernary": false
    }
  ],
  "no-unused-vars": [
    0
  ],
  "@typescript-eslint/no-unused-vars": [
    1
  ],
  "@typescript-eslint/no-wrapper-object-types": [
    2
  ],
  "@typescript-eslint/prefer-as-const": [
    2
  ],
  "@typescript-eslint/prefer-namespace-keyword": [
    2
  ],
  "@typescript-eslint/triple-slash-reference": [
    2
  ]
};
const eslintConfig = [
  { ignores: [".next/**", ".test-build/**", "next-env.d.ts", "node_modules/**"] },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "@next/next": next, "@typescript-eslint": typescript, "react-hooks": hooks, "jsx-a11y": a11y },
    rules: { ...rules, ...reactDeprecationRules },
  },
  { files: ["**/*.{ts,tsx,mts,cts}"], rules: {
  "constructor-super": [
    0
  ],
  "getter-return": [
    0,
    {
      "allowImplicit": false
    }
  ],
  "no-class-assign": [
    0
  ],
  "no-const-assign": [
    0
  ],
  "no-dupe-args": [
    0
  ],
  "no-dupe-class-members": [
    0
  ],
  "no-dupe-keys": [
    0
  ],
  "no-func-assign": [
    0
  ],
  "no-import-assign": [
    0
  ],
  "no-new-native-nonconstructor": [
    0
  ],
  "no-new-symbol": [
    0
  ],
  "no-obj-calls": [
    0
  ],
  "no-redeclare": [
    0,
    {
      "builtinGlobals": true
    }
  ],
  "no-setter-return": [
    0
  ],
  "no-this-before-super": [
    0
  ],
  "no-undef": [
    0,
    {
      "typeof": false
    }
  ],
  "no-unreachable": [
    0
  ],
  "no-unsafe-negation": [
    0,
    {
      "enforceForOrderingRelations": false
    }
  ],
  "no-var": [
    2
  ],
  "no-with": [
    0
  ],
  "prefer-const": [
    2,
    {
      "destructuring": "any",
      "ignoreReadBeforeAssign": false
    }
  ],
  "prefer-rest-params": [
    2
  ],
  "prefer-spread": [
    2
  ]
} },
];

export default eslintConfig;
