/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Smaller Docker / Railway image via Dockerfile multi-stage
  output: "standalone",
  // Avoid failing build on optional lint noise in CI
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
