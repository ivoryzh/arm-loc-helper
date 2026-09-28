import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'save-scene-plugin',
      configureServer(server) {
        server.middlewares.use('/api/save-scene', (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                fs.writeFileSync(path.resolve(__dirname, 'src/scene_config.json'), body);
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: (err as Error).message }));
              }
            });
          } else {
            res.statusCode = 405;
            res.end('Method Not Allowed');
          }
        });
      }
    }
  ],
  // Relative asset paths — this build gets served from a subpath (an IvoryOS Core plugin
  // mount, e.g. /plugins/arm_loc_helper/), not the server root, so absolute "/assets/..."
  // references would 404 there.
  base: './',
})
