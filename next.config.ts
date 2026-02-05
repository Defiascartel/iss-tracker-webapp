import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'; " +
              "style-src 'self' 'unsafe-inline' https://basemaps.cartocdn.com; " +
              "img-src 'self' data: blob: https://*.cartocdn.com https://*.openstreetmap.org; " +
              "connect-src 'self' https://api.wheretheiss.at https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com; " +
              "worker-src 'self' blob:; " +
              "font-src 'self' data:; ",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
