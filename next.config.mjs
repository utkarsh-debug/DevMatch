/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Native/driver packages must not be bundled by webpack — load them from node_modules at runtime.
  serverExternalPackages: ['pg', 'mongodb', 'bcryptjs'],
};

export default nextConfig;
