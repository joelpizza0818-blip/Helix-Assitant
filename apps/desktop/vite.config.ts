import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: resolve(__dirname, 'electron/main.ts'),
        onstart(options) {
          // Delay startup to ensure Vite HTTP server is fully bound
          setTimeout(() => options.startup(), 3000)
        },
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron', 'ws', 'path', 'child_process', 'fs', 'os']
            }
          }
        }
      },
      {
        entry: resolve(__dirname, 'electron/preload.ts'),
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  root: 'renderer',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'renderer/src')
    }
  },
  server: {
    port: 5173
  }
})
