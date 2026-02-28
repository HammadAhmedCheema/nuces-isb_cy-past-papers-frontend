import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: `${env.VITE_SUPABASE_URL}/functions/v1`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy, _options) => {
             proxy.on('proxyReq', (proxyReq, req, _res) => {
                // If the frontend explicitly attached an Admin JWT, respect it. 
                // Otherwise, automatically inject the public Anon Key natively on the server.
                if (!req.headers.authorization) {
                   proxyReq.setHeader('Authorization', `Bearer ${env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY}`);
                }
             });
          },
        },
      },
    },
  };
})
