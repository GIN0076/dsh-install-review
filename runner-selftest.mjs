/**
 * Exercise the real execution generator against a stub ctx: backup, plan,
 * install, build-script retry, config write, verify — without touching the live profile.
 */
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runExecute, activeInstall } from './runner-v7.js'

const scratch = join(process.cwd(), '_selftest-run')
const backupDir = join(process.cwd(), '_selftest-backup')
await rm(scratch, { recursive: true, force: true })
await rm(backupDir, { recursive: true, force: true })
await mkdir(scratch, { recursive: true })

const PKG = 'dsh-find-plugin'
const profileJson = { name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }

function writeProfile(installed) {
  const manifest = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: installed ? { [PKG]: '0.4.0' } : {},
    dsh: { profile: { bundles: installed ? [PKG] : [] } },
  }
  return writeFile(join(scratch, 'package.json'), JSON.stringify(manifest, null, 2))
}
await writeProfile(false)
await writeFile(join(scratch, 'cordis.patch.yml'), '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config: {}\n')
await writeFile(join(scratch, 'cordis.yml'), '[]\n')
await writeFile(join(scratch, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')

let installCalls = []
let installBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable', target: 'spec', bundle: PKG, warnings: ['示例警告'] })
let inspectBehaviour = async spec => ({ status: 'accepted', kind: 'registry', name: spec, bundle: true, registry: 'https://registry.npmjs.org/' })
const edits = []
const entryRow = { options: { id: 'find-dsh-plugin', name: PKG, config: {} } }

const ctx = {
  profileContext: {
    dir: scratch,
    patchPath: join(scratch, 'cordis.patch.yml'),
    installAnchor: 'E:\\DSH-OneClick\\install-manifest.json',
  },
  pluginManager: {
    registries: async () => ({ registry: 'https://registry.npmjs.org/', fallbackRegistries: [], resolved: 'https://registry.npmjs.org/' }),
    inspect: spec => inspectBehaviour(spec),
    listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
    listPlugins: async () => [],
    installBundle: async (spec, options) => {
      installCalls.push({ spec, options })
      return installBehaviour(spec, options)
    },
    cancelInstall: async () => ({ status: 'not-running' }),
  },
  get(name) {
    if (name === 'loader') return { entries: () => [] }
    if (name === 'configEditor') {
      return {
        entries: () => [entryRow],
        configuration: () => [{ entry: entryRow, inherited: {}, override: { a: 1 } }],
        edit: async (entry, change) => { edits.push({ id: entry.options.id, next: change(structuredClone(entry.options.config ?? {}), {}) }) },
      }
    }
    return undefined
  },
}

let failures = 0
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  if (!ok) {
    failures += 1
    console.log(`FAIL ${label}\n  actual ${JSON.stringify(actual)}\n  wanted ${JSON.stringify(wanted)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

async function collect(request) {
  const lines = []
  for await (const line of runExecute(ctx, { backupDir }, request)) lines.push(line)
  return lines
}

/* 1 · plain install succeeds, backup taken, verify runs */
installCalls = []
{
  const lines = await collect({ rawTarget: PKG, approved: [], values: {} })
  const steps = lines.map(line => line.step)
  expect('1 steps', steps.filter(s => ['start', 'plan', 'backup', 'install-start', 'install-result', 'verify', 'done'].includes(s)),
    ['start', 'plan', 'backup', 'install-start', 'install-result', 'verify', 'done'])
  const backup = lines.find(line => line.step === 'backup')
  expect('1 backup files', backup?.files, ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'cordis.yml'])
  expect('1 backup dir exists', existsSync(backup?.dir ?? ''), true)
  expect('1 install called once', installCalls.length, 1)
  expect('1 install spec', installCalls[0].spec, PKG)
  const done = lines.find(line => line.step === 'done')
  expect('1 done ok', done?.succeeded, true)
  expect('1 no active left', activeInstall(), null)
  const verify = lines.find(line => line.step === 'verify')
  expect('1 verify not installed yet (profile untouched)', verify?.installed, false)
}

/* 2 · build scripts blocked → approval → single retry with approvedBuilds */
installCalls = []
{
  let first = true
  installBehaviour = () => {
    if (first) {
      first = false
      return { changed: false, application: 'failed', stage: 'install', target: PKG, pendingBuilds: ['left-pad'] }
    }
    return { changed: true, application: 'restart-required', stage: 'enable', target: PKG, bundle: PKG }
  }
  const lines = await collect({ rawTarget: PKG, approved: ['allowbuild'], values: {} })
  const approval = lines.find(line => line.step === 'build-approval')
  expect('2 approval asked', approval?.retry, true)
  expect('2 approval names', approval?.pendingBuilds, ['left-pad'])
  expect('2 retried twice', installCalls.length, 2)
  expect('2 retry approved builds', installCalls[1].options.approvedBuilds, ['left-pad'])
  expect('2 done restart-required', lines.find(line => line.step === 'done')?.application, 'restart-required')
}

/* 3 · build scripts blocked without approval → no retry, not succeeded */
installCalls = []
{
  installBehaviour = () => ({ changed: false, application: 'failed', stage: 'install', target: PKG, pendingBuilds: ['left-pad'] })
  const lines = await collect({ rawTarget: PKG, approved: [], values: {} })
  expect('3 no retry', installCalls.length, 1)
  expect('3 not succeeded', lines.find(line => line.step === 'done')?.succeeded, false)
  const approval = lines.find(line => line.step === 'build-approval')
  expect('3 approval declined note', approval?.retry, false)
}

/* 4 · blocked report stops before any change */
installCalls = []
{
  inspectBehaviour = async () => ({ status: 'refused', problem: 'not-a-bundle', reason: 'declares no dsh.bundle' })
  const lines = await collect({ rawTarget: PKG, approved: [], values: {} })
  expect('4 stopped', lines.at(-1)?.step, 'error')
  expect('4 no backup', lines.some(line => line.step === 'backup'), false)
  expect('4 no install', installCalls.length, 0)
  inspectBehaviour = async spec => ({ status: 'accepted', kind: 'registry', name: spec, bundle: true, registry: 'https://registry.npmjs.org/' })
}

/* 5 · approved config edit runs after install for a not-yet-installed plugin */
installCalls = []
{
  installBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable', target: PKG, bundle: PKG })
  const lines = await collect({
    rawTarget: PKG,
    approved: ['profile-config'],
    values: { 'profile-config': { config: '{"allowRestart":false}' } },
  })
  const config = lines.find(line => line.step === 'config')
  expect('5 config applied', config?.ok, true)
  expect('5 config phase after', config?.phase, 'after')
  expect('5 config payload', edits.at(-1)?.next, { allowRestart: false })
}

/* 6 · invalid config JSON fails before install */
installCalls = []
edits.length = 0
{
  const lines = await collect({
    rawTarget: PKG,
    approved: ['profile-config'],
    values: { 'profile-config': { config: '{oops' } },
  })
  expect('6 errored', lines.at(-1)?.step, 'error')
  expect('6 no install', installCalls.length, 0)
  expect('6 no edit', edits.length, 0)
}

/* 7 · user-approved build scripts reach installBundle on the first attempt (v5) */
installCalls = []
{
  installBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable', target: PKG, bundle: PKG })
  const lines = await collect({ rawTarget: PKG, approved: [], values: {}, approvedBuilds: ['cloudflared'] })
  expect('7 approvedBuilds passed to installBundle', installCalls[0].options.approvedBuilds, ['cloudflared'])
  expect('7 approval notice line', lines.some(line => line.step === 'build-approval' && line.approved === true), true)
  expect('7 single attempt', installCalls.length, 1)
  expect('7 done', lines.find(line => line.step === 'done')?.succeeded, true)
  expect('7 no pendingBuilds left in UI state', activeInstall(), null)
}

/* 8 · a stale approval (name no longer pending) surfaces as a failed install */
installCalls = []
{
  installBehaviour = () => {
    throw Object.assign(new Error('a name no longer pending refuses the call'), { code: 'stale-approval' })
  }
  const lines = await collect({ rawTarget: PKG, approved: [], values: {}, approvedBuilds: ['gone-name'] })
  expect('8 attempt happened', installCalls.length, 1)
  expect('8 failed install-result', lines.find(line => line.step === 'install-result')?.application, 'failed')
  expect('8 not succeeded', lines.find(line => line.step === 'done')?.succeeded, false)
  installBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable', target: PKG, bundle: PKG })
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
await rm(scratch, { recursive: true, force: true })
await rm(backupDir, { recursive: true, force: true })
if (failures > 0) process.exitCode = 1
void readdir
