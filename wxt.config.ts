import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    name: 'Pseudo',
    description: 'A fake wallet that shows you the real danger',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['injected.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
    ],
  },
});
