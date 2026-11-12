import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/wasm bindings — must not be bundled by Turbopack (Slack chart PNGs).
  serverExternalPackages: ["@resvg/resvg-js"],
  // Keep platform binaries + chart fonts in the standalone Docker image.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@resvg/resvg-js/**/*",
      "./node_modules/@resvg/resvg-js-linux-x64-gnu/**/*",
      "./node_modules/@resvg/resvg-js-linux-x64-musl/**/*",
      "./public/fonts/**/*",
    ],
  },
};

export default nextConfig;
