import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Normal Vite SPA build (Final Phase, 2026-10-12) -- replaces the library-
// mode build this file used throughout the migration (see git history for
// the old config). `frontend/` is now this app's build OUTPUT, not hand-
// edited source -- it's served as-is by backend/app/main.py's
// StaticFiles(html=True) mount, untouched by this change. `npm run build`
// writes straight there (emptyOutDir clears whatever a previous build left,
// including the old vanilla files once they're deleted from git -- this
// does NOT delete them from git itself, only from the directory before
// writing the new build).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../frontend',
    emptyOutDir: true,
  },
})
