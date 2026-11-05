import type { NextConfig } from "next";
const config: NextConfig = {
  distDir:
    process.env.FORME_TEST_DIST_DIR === ".next-operations-test"
      ? ".next-operations-test"
      : ".next",
  logging: {
    incomingRequests: false,
    serverFunctions: false,
    browserToTerminal: false,
  },
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingExcludes: {
    "*": [
      "./.local/**/*",
      "./backups/**/*",
      "./.env*",
      "./.tools/**/*",
      "./.npm-cache/**/*",
    ],
  },
};
export default config;
