/** @type {import('next').NextConfig} */
// Base44 sandbox override: the preview is served from the proxied origin
// https://3000-<BASE44_PUBLIC_HOST_SUFFIX>, which is a different origin than the
// dev server's own. Next 14.2 only warns about cross-origin /_next/* requests, but
// newer versions block dev assets and HMR without an allowlist entry. Applied only
// while BASE44_PREVIEW_MODE === '1'; when the flag is unset the config is unchanged.
const previewHostSuffix = process.env.BASE44_PUBLIC_HOST_SUFFIX;
const sandboxPreview = process.env.BASE44_PREVIEW_MODE === '1' && previewHostSuffix
  ? { allowedDevOrigins: ['3000-' + previewHostSuffix] }
  : {};

const nextConfig = {
  output: 'standalone',
  ...sandboxPreview,
}

export default nextConfig;
