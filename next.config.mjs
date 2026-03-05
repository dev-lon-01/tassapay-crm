/** @type {import('next').NextConfig} */
const nextConfig = {
  // Twilio and other Node.js-only packages must not be bundled by webpack
  experimental: {
    serverComponentsExternalPackages: ["twilio", "bcryptjs", "jsonwebtoken"],
  },
  // ESLint plugin 'import' has a tsconfig-paths resolution issue on Node 16.
  // TypeScript type-checking is still enforced at build time via tsc.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
