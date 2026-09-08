import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths — this build gets served from a subpath (an IvoryOS Core plugin
  // mount, e.g. /plugins/arm_loc_helper/), not the server root, so absolute "/assets/..."
  // references would 404 there.
  base: './',
})
