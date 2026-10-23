/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async redirects() {
    return [{ source: '/cipher', destination: '/', permanent: false }];
  },
}

export default nextConfig;
