import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Normal Vite SPA build. `frontend/` holds both the source (this file,
// `src/`, `index.html`, `package.json`) and the build output (`dist/` --
// `backend/app/main.py` serves exactly that subfolder as static files, and
// the Dockerfile copies only it into the image, never the source or
// `node_modules`). One `frontend/` folder, not a separate `frontend-react/`
// source tree next to a `frontend/` output tree (2026-10-12, consolidated
// after the React migration's Final Phase settled -- see
// .claude-notes/REACT-MIGRATION-PLAN.md) -- `outDir: 'dist'` is actually
// Vite's own default and could be omitted, but it's spelled out here since
// backend/app/main.py's serving path depends on it matching exactly.
export default defineConfig({
  plugins: [react()],
  // Dev only: the app calls the API at a relative `/api/v1` (src/lib/api.ts),
  // which in production is served by the same FastAPI origin. Under
  // `vite dev` forward it to the local backend.
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
