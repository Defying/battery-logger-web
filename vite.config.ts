import { defineConfig } from 'vite'
import type { UserConfig } from 'vite'
import { execSync } from 'child_process'

// Get git commit hash at build time
const commitHash = execSync('git rev-parse --short HEAD').toString().trim()

const config: UserConfig = {
  plugins: [
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        return html.replace('__COMMIT_HASH__', commitHash)
      },
    },
  ],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
  },
  base: './'
}

export default defineConfig(config) 