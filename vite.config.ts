import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { build as esbuildBuild } from 'esbuild'

function preloadPlugin() {
  return {
    name: 'custom-preload-builder',
    async buildStart() {
      await esbuildBuild({
        entryPoints: ['src/preload.ts'],
        outfile: 'dist-electron/preload.js',
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron']
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
