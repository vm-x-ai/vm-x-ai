//@ts-check

const { composePlugins, withNx } = require('@nx/next');

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},

  // The playground accepts image / audio / file uploads inline on chat
  // requests. The default Next.js Server Action body limit is 1 MB which
  // refuses any meaningfully-sized attachment; bump to 100 MB to match
  // the API-side Fastify limit. (Server Actions only — route handlers
  // already accept up to the platform default.)
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },

  compiler: {
    // For other options, see https://nextjs.org/docs/architecture/nextjs-compiler#emotion
    emotion: true,
  },
  compress: true,
  images: {
    remotePatterns: [
      // Allow images to be loaded from the local server
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3000',
        pathname: '**',
      },
    ],
    // Allow images to be loaded from the local server
    dangerouslyAllowLocalIP: true,
  },
  output: 'standalone',
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      fs: {
        browser: './empty.js',
      },
    },
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
