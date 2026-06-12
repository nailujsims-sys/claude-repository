import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project site from /claude-repository/.
// In dev we want the root base; in production we want the repo subpath so
// hashed assets resolve correctly. HashRouter handles client-side routing,
// so deep links never hit the server.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/claude-repository/' : '/',
  plugins: [react()],
}))
