import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "out/**", "node_modules/**", "src/generated/**"],
  },
  {
    rules: {
      // Disallow console.error to prevent debug statements in production
      // Use the app's alert/toast system for user-facing errors instead
      "no-console": ["error", { allow: ["warn"] }],
    },
  },
];
