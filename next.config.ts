import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/wasm bindings — must not be bundled by Turbopack (Slack chart PNGs).
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
