/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
 
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
 
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "replicate.delivery",
      },
      {
        protocol: "https",
        hostname: "image.pollinations.ai",
      },
    ],
  },
 
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        '127.0.0.1:3000',
        '0.0.0.0:3000',
      ],
    },
  },
};
 
export default nextConfig;