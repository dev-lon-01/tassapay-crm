/** @type {import('next').NextConfig} */
const nextConfig = {
  // Twilio and other Node.js-only packages must not be bundled by webpack
  experimental: {
    serverComponentsExternalPackages: ["twilio", "bcryptjs", "jsonwebtoken"],
  },
};

export default nextConfig;
