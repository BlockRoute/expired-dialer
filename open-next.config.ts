import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every page and route is dynamic (session cookies, force-dynamic), so no
// incremental cache (R2/KV) is configured: the adapter's default no-op cache.
export default defineCloudflareConfig({});
