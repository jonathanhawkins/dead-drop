import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The capture page + Photon webhook are reached through a public HTTPS tunnel
  // (cloudflared / ngrok) during dev. Allow those origins so Next doesn't block them.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.loca.lt",
  ],
};

export default nextConfig;
