import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cache Components (and partialPrefetching, which requires it) are off until we
  // settle caching patterns for authenticated, per-workspace pages. See docs/adr when we revisit.
  reactCompiler: true,
  transpilePackages: [
    '@greenfield/db',
    '@greenfield/crypto',
    '@greenfield/authz',
    '@greenfield/providers',
    '@greenfield/contracts',
    '@greenfield/agent',
    '@greenfield/sandbox-runner',
  ],
  serverExternalPackages: ['pg'],
  // The FigCraft web release in public/editor (scripts/fetch-editor.mjs).
  // Hashed .wasm/.js names make them immutable; index.html must revalidate. Next already serves
  // .wasm as application/wasm. No COOP/COEP: the build doesn't use SharedArrayBuffer.
  async headers() {
    return [
      {
        source: '/editor/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
      {
        source: '/editor/:file(.*\\.(?:wasm|js))',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      { source: '/editor/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
