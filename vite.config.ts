import { defineConfig } from 'vite'
import type { UserConfig } from 'vite'
import { execSync } from 'child_process'
import react from '@vitejs/plugin-react'
import path from 'path'

// Get git commit hash at build time
const commitHash = execSync('git rev-parse --short HEAD').toString().trim()

const config: UserConfig = {
  plugins: [
    react(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        return html.replace('__COMMIT_HASH__', commitHash)
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
  },
  base: './'
}

export default defineConfig(config) 