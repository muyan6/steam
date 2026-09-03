import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { build as esbuildBuild } from 'esbuild'

function preloadPlugin() {
  const buildPreload = async () => {
    await esbuildBuild({
      entryPoints: ['src/preload.ts'],
      outfile: 'dist-electron/preload.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron']
    })
  }

  return {
    name: 'custom-preload-builder',
    async buildStart() {
      await buildPreload()
    },
    async configureServer(server: any) {
      await buildPreload()
      server.watcher.add(path.resolve(__dirname, 'src/preload.ts'))
      server.watcher.on('change', async (file: string) => {
        if (file.includes('preload.ts')) {
          await buildPreload()
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    preloadPlugin(),
    electron([
      {
        entry: 'src/main/main.ts',
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@main': path.resolve(__dirname, 'src/main')
    }
  },
  server: {
    port: 5173
  }
})
