import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The commit this bundle is actually built from.
//
// On the GitHub Actions runner `GITHUB_SHA` is authoritative: the checkout is
// detached and the workflow must not depend on a git binary being on PATH.
// Locally we ask git. Neither exists in every sandbox, hence the fallback —
// the app then honestly reports an unknown commit rather than a wrong one.
function buildCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

// Writes dist/version.json next to the bundle. Same three values the app shows,
// but machine-readable — the deploy workflow fetches it from the live URL after
// publishing and fails if the commit served is not the commit it just built.
function versionManifest(info) {
  return {
    name: 'mind-whiteboard-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(info, null, 2)}\n`,
      })
    },
  }
}

// GitHub Pages serves this project site from /claude-repository/.
// In dev we want the root base; in production we want the repo subpath so
// hashed assets resolve correctly. HashRouter handles client-side routing,
// so deep links never hit the server.
export default defineConfig(({ command }) => {
  const info = {
    version: pkg.version,
    commit: buildCommit(),
    builtAt: new Date().toISOString(),
  }

  return {
    base: command === 'build' ? '/claude-repository/' : '/',
    plugins: [react(), versionManifest(info)],
    // Compile-time constants, so the running app needs no fetch to know what it
    // is. src/lib/version.js reads them behind `typeof` guards.
    define: {
      __APP_VERSION__: JSON.stringify(info.version),
      __BUILD_COMMIT__: JSON.stringify(info.commit),
      __BUILD_TIME__: JSON.stringify(info.builtAt),
    },
  }
})
