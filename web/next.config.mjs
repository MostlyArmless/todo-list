/** @type {import('next').NextConfig} */
import withPWA from 'next-pwa';

const nextConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  // Service worker enabled in all environments for mobile performance
  disable: false,
  // Cache strategies for offline support
  runtimeCaching: [
    {
      urlPattern: /^https?:\/\/.*\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-assets',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
      },
    },
    {
      urlPattern: /^https?:\/\/.*\/api\/v1\/(lists|recipes|pantry)$/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60, // 1 minute
        },
        networkTimeoutSeconds: 3,
      },
    },
    {
      urlPattern: /^https?:\/\/.*\.(png|jpg|jpeg|svg|gif|ico|woff|woff2)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'image-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        },
      },
    },
  ],
})({
  reactStrictMode: true,
  output: 'standalone',
  turbopack: {}, // Silence webpack/turbopack warning for next-pwa
});

export default nextConfig;
