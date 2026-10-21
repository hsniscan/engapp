// QA only: stubs virtual:pwa-register while the PWA plugin is being wired up by another agent.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    root: '/home/claude/engapp',
    server: { hmr: false },
    plugins: [
      {
        name: 'pwa-register-stub',
        enforce: 'pre',
        resolveId: (id: string) => (id.startsWith('virtual:pwa-register') ? '\0pwa-stub' : null),
        load: (id: string) => (id === '\0pwa-stub' ? 'export function registerSW(){ return () => Promise.resolve(); }' : null),
      },
    ],
  }),
);
