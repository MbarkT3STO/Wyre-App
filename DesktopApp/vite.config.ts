import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

// https://github.com/electron-vite/vite-plugin-electron
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    plugins: [
      electron([
        {
          // Main process entry
          entry: 'src/main/index.ts',
          onstart(options) {
            // In dev mode, start Electron; in build mode, do nothing extra
            options.startup();
          },
          vite: {
            build: {
              sourcemap: !isBuild,
              minify: isBuild,
              outDir: 'dist/main',
              rollupOptions: {
                external: [
                  'electron',
                  'electron-store',
                  // Node built-ins
                  'path', 'fs', 'os', 'net', 'dgram', 'crypto', 'events',
                  'stream', 'util', 'url', 'http', 'https', 'child_process',
                ],
              },
            },
            resolve: {
              alias: {
                '@main': resolve(__dirname, 'src/main'),
                '@shared': resolve(__dirname, 'src/shared'),
              },
            },
          },
        },
        {
          // Preload script
          entry: 'src/preload/index.ts',
          onstart(options) {
            // Reload the renderer when preload changes
            options.reload();
          },
          vite: {
            build: {
              sourcemap: !isBuild ? 'inline' : false,
              minify: isBuild,
              outDir: 'dist/preload',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
      renderer(),
    ],

    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },

    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
      },
    },
  };
});
