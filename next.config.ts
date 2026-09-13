import type { NextConfig } from "next";

// No external scripts, styles, fonts or API hosts are loaded anywhere in app/ (verified
// during the security review), so default-src 'self' is safe. 'unsafe-inline' on
// script/style is still needed because Next.js injects inline hydration data and styled-
// jsx/Tailwind output without a nonce here; tightening that further would mean wiring a
// per-request nonce through middleware, a larger change than this pass covers.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          // Belt-and-braces alongside frame-ancestors above: older browsers that don't
          // parse CSP still get clickjacking protection from this header.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
