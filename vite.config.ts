import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative asset paths (`base: './'`): the same build is served from a domain root (Vercel), from a
// subpath (the ivoryos-next plugin mounts it at /plugins/arm_loc_helper/), by `python -m arm_loc_helper`,
// or opened from any static file server. The build goes into the Python package, which ships it; on
// Vercel (VERCEL=1) it goes to dist/ instead.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: process.env.VERCEL ? 'dist' : 'arm_loc_helper/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
