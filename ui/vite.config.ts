import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig } from 'vitest/config'

// The build is one self-contained dist/index.html: the web server embeds that
// single file in its binary, and the desktop app loads the same folder.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 4410,
    strictPort: true,
    // The backend only answers requests whose Host is 127.0.0.1 or localhost.
    proxy: { '/api': { target: 'http://127.0.0.1:4402', changeOrigin: true } },
  },
})
