/**
 * Locate the host packages a self-test compares against (node-semver, React).
 *
 * These paths used to be hardcoded to one machine's source checkout
 * (`E:/DSH-OneClick/src/node_modules/.pnpm/…`). The packaged Desktop app
 * replaced that checkout, so the two self-tests that used it crashed on
 * import while the plugin itself was fine — a dev-only layout leak, same family
 * as the v6 `backupDir` one. Candidates are probed in order across the layouts
 * this repo has lived in, and a package that cannot be found yields `undefined`
 * so the caller prints SKIP instead of failing.
 *
 * Overrides: `DSH_SELFTEST_ROOT` (a source checkout root), plus one env var per
 * package (`DSH_SELFTEST_SEMVER`, `DSH_SELFTEST_REACT`, `DSH_SELFTEST_REACT_DOM`)
 * naming the exact file to import.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Roots a dev-only self-test may find host packages under, best first.
 * @returns absolute directory roots.
 */
export function hostRoots() {
  const roots = []
  const push = root => {
    if (typeof root === 'string' && root !== '' && !roots.includes(root)) roots.push(root)
  }
  push(process.env.DSH_SELFTEST_ROOT)
  push('E:/DSH-OneClick/src')
  push(process.cwd())
  push(join(process.cwd(), '..'))
  const execDir = typeof process.execPath === 'string' ? dirname(process.execPath) : ''
  push(join(execDir, 'resources', 'app.asar', 'dsh'))
  push(join(execDir, 'resources', 'runtime'))
  return roots
}

/**
 * Every plausible file for one package under those roots, `.pnpm` store included.
 * @param pkg - package name, e.g. `react-dom`.
 * @param entry - file inside it, e.g. `server.node.js`.
 * @returns candidate paths, best first.
 */
export function hostPackageCandidates(pkg, entry) {
  const out = []
  const store = pkg.replace('/', '+')
  for (const root of hostRoots()) {
    out.push(join(root, 'node_modules', pkg, entry))
    const pnpm = join(root, 'node_modules', '.pnpm')
    if (!existsSync(pnpm)) continue
    try {
      for (const dir of readdirSync(pnpm)) {
        if (dir === store || dir.startsWith(`${store}@`)) out.push(join(pnpm, dir, 'node_modules', pkg, entry))
      }
    } catch {
      /* an unreadable store is simply skipped */
    }
  }
  return out
}

/**
 * Import the first candidate that loads.
 * @param pkg - package name.
 * @param entry - file inside it.
 * @param envName - env var naming an exact file to try first.
 * @returns `{ module, path }`, or undefined when nothing on this machine loads.
 */
export async function importHostModule(pkg, entry, envName) {
  const explicit = envName === undefined ? undefined : process.env[envName]
  const candidates = [...(explicit ? [explicit] : []), ...hostPackageCandidates(pkg, entry)]
  for (const candidate of candidates) {
    const url = candidate.startsWith('file://') ? candidate : pathToFileURL(candidate).href
    try {
      return { module: await import(url), path: candidate }
    } catch {
      /* try the next candidate */
    }
  }
  return undefined
}
