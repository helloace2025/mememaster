/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Smaller Docker / Railway image via Dockerfile multi-stage
  output: "standalone",
  // Avoid failing build on optional lint noise in CI
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Unified Railway image only (UNIFIED_DEPLOY=1 at docker build).
  // Local `next dev` keeps talking to NEXT_PUBLIC_API_BASE (default :8000).
  async rewrites() {
    if (process.env.UNIFIED_DEPLOY !== "1" && !process.env.INTERNAL_API_URL) {
      return [];
    }
    const internal = (
      process.env.INTERNAL_API_URL || "http://127.0.0.1:8001"
    ).replace(/\/$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${internal}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
