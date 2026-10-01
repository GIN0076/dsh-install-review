/**
 * Self-test for the v1.3 capability path — all five additions, all local:
 * 「换源重试」/「配置模板自动填好」/「打开没启用的行」/「更新保配置」/「装完验一遍真生效」.
 *
 * The audit runs against a fixture directory (no registry/GitHub fetch) with a
 * dead catalog port, and every service the plugin calls is stubbed.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runAudit, configDefaultsFromPatch } from './audit-v6.js'
import { buildProposals } from './proposals-v3.js'
import { runExecute } from './runner-v7.js'

const root = join(process.cwd(), '_selftest-enhance')
const profile = join(root, 'profile')
const targetDir = join(root, 'target')
const backupDir = join(root, 'backups')
await rm(root, { recursive: true, force: true })
await mkdir(profile, { recursive: true })
await mkdir(targetDir, { recursive: true })

/* the profile: the fixture is already installed at 0.9.0 and selected as a bundle */
await writeFile(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dependencies: { 'fixture-enhance': '0.9.0' },
  dsh: { profile: { bundles: ['fixture-enhance'] } },
}, null, 2))
await writeFile(join(profile, 'cordis.patch.yml'), '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config: {}\n')
const anchor = join(profile, 'install-manifest.json')
await writeFile(anchor, JSON.stringify({ npmName: 'dsh-v0.2.0-rc.2' }, null, 2))

/* the target: 1.0.0 on disk, its own patch carries config defaults */
await writeFile(join(targetDir, 'package.json'), JSON.stringify({
  name: 'fixture-enhance',
  version: '1.0.0',
  description: 'local fixture for the capability self-test',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  scripts: { prepare: 'node -e 0' },
}, null, 2))
await writeFile(join(targetDir, 'cordis.patch.yml'), [
  '- insert:',
  '    - id: fixture-enhance',
  "      name: './index.js'",
  '      config:',
  '        enabled: true',
  '        depth: 3',
  "        label: 'fixture'",
  '        nested:',
  '          a: 1',
  '        script: !!js process.cwd()',
  '',
].join('\n'))

const installCalls = []
const enabledCalls = []
const bundleCalls = []
const entryRow = { options: { id: 'fixture-enhance', name: 'fixture-enhance', config: {} } }

const ctx = {
  profileContext: { dir: profile, patchPath: join(profile, 'cordis.patch.yml'), installAnchor: anchor },
  pluginManager: {
    registries: async () => ({
      registry: 'https://registry.npmjs.org/',
      fallbackRegistries: ['https://registry.npmmirror.com/'],
      resolved: null,
    }),
    inspect: async () => ({ status: 'accepted', kind: 'path', name: 'fixture-enhance', bundle: true, registry: null }),
    listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
    listPlugins: async () => ([
      { entryId: 'include:fixture-enhance', patchId: 'fixture-enhance', moduleName: './index.js', enabled: false, fiberPhase: null },
    ]),
    listBundles: async () => ([
      {
        name: 'fixture-enhance',
        version: '0.9.0',
        enabled: false,
        installed: true,
        rows: [{ rowId: 'fixture-enhance', moduleName: './index.js', entryId: 'include:fixture-enhance' }],
        overrides: [],
      },
    ]),
    installBundle: async (spec, options) => {
      installCalls.push({ spec, options })
      return { changed: true, application: 'applied', stage: 'enable', bundle: 'fixture-enhance' }
    },
    cancelInstall: async () => ({ status: 'not-running' }),
    setPluginEnabled: async (id, enabled) => {
      enabledCalls.push({ id, enabled })
      return { changed: true, application: 'applied', stage: 'enable' }
    },
    setBundleEnabled: async (name, enabled) => {
      bundleCalls.push({ name, enabled })
      return { changed: true, application: 'applied', stage: 'enable' }
    },
  },
  get(name) {
    if (name === 'loader') return { entries: () => [{ options: { id: 'fixture-enhance' } }] }
    if (name === 'clientModules') return { graph: () => [{ id: '@local/install-review' }] }
    if (name === 'configEditor') {
      return {
        entries: () => [entryRow],
        configuration: () => [{ entry: entryRow, inherited: {}, override: { keep: true, note: 'hi' } }],
        edit: async () => {},
      }
    }
    return undefined
  },
  on() {},
  effect(fn) { fn(); return () => {} },
}

const options = {
  backupDir,
  catalogUrl: 'http://127.0.0.1:9/no-such-catalog.json',
  catalogTimeoutMs: 1500,
  fetchTimeoutMs: 1500,
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
  for await (const line of runExecute(ctx, options, request)) lines.push(line)
  return lines
}

/* 0 · the patch scanner only keeps what it can be sure about */
{
  const text = '- insert:\n    - id: x\n      config:\n        a: 1\n        b: true\n        c:\n          d: 2\n        e: !!js Date.now()\n'
  expect('scanner keeps plain scalars', configDefaultsFromPatch(text, ['x']), { config: { a: 1, b: true }, skipped: ['c', 'e'] })
  expect('scanner ignores other rows', configDefaultsFromPatch(text, ['y']), { config: {}, skipped: [] })
}

/* 1 · audit facts: registry candidates, config template, activation, update */
const report = await runAudit(ctx, options, { rawTarget: targetDir })
{
  expect('audit: registry candidates ordered', report.registries, ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/'])
  expect('audit: config template merges patch defaults with the profile row', report.configTemplate.value,
    { enabled: true, depth: 3, label: 'fixture', keep: true, note: 'hi' })
  expect('audit: template reports what it skipped', report.configTemplate.skipped, ['nested', 'script'])
  expect('audit: activation sees the disabled row', report.activation.disabledRows.map(row => row.rowId), ['fixture-enhance'])
  expect('audit: activation sees the bundle off', report.activation.bundle.enabled, false)
  expect('audit: update available', report.update, { installedSpec: '0.9.0', latest: '1.0.0', available: true })
}

/* 2 · proposals: upgrade / rows / config template（and no bare `version`) */
{
  const proposals = buildProposals(report)
  const ids = proposals.map(proposal => proposal.id)
  expect('proposals: upgrade offered', proposals.find(p => p.id === 'upgrade')?.editable?.[0]?.value, '1.0.0')
  expect('proposals: version suppressed while an upgrade is offered', ids.includes('version'), false)
  expect('proposals: rows offered, phase before (already installed)', proposals.find(p => p.id === 'rows')?.phase, 'before')
  expect('proposals: config starts from the template', JSON.parse(proposals.find(p => p.id === 'profile-config').editable[0].value),
    { enabled: true, depth: 3, label: 'fixture', keep: true, note: 'hi' })

  const registryReport = {
    target: { kind: 'registry', name: 'x' },
    manifest: { name: 'x', version: '1.0.0' },
    checks: [],
    registries: ['https://a.example/', 'https://b.example/'],
    installed: { isInstalled: false },
  }
  const registryProposal = buildProposals(registryReport).find(proposal => proposal.id === 'registry')
  expect('proposals: registry offered for a registry target', registryProposal?.editable?.[0]?.options, ['https://a.example/', 'https://b.example/'])
  expect('proposals: no registry button for a local path target', buildProposals(report).some(proposal => proposal.id === 'registry'), false)
}

/* 3 · runner: upgrade pins the version and keeps the config untouched */
{
  installCalls.length = 0
  const lines = await collect({ rawTarget: targetDir, approved: ['upgrade'], values: { upgrade: { version: '1.0.0' } } })
  expect('upgrade: spec pinned', installCalls[0]?.spec, 'fixture-enhance@1.0.0')
  expect('upgrade: no config edit ran', lines.some(line => line.step === 'config'), false)
  expect('upgrade: done names where it came from', lines.find(line => line.step === 'done')?.upgradeFrom, '0.9.0')
}

/* 4 · runner: a chosen registry reaches installBundle */
{
  installCalls.length = 0
  await collect({ rawTarget: targetDir, approved: ['registry'], values: { registry: { registry: 'https://registry.npmmirror.com/' } } })
  expect('registry: passed through', installCalls[0]?.options?.registry, 'https://registry.npmmirror.com/')
}

/* 5 · runner: rows are enabled through the official channel, bundle first */
{
  installCalls.length = 0
  enabledCalls.length = 0
  bundleCalls.length = 0
  const lines = await collect({ rawTarget: targetDir, approved: ['rows'], values: {} })
  const rowsLine = lines.find(line => line.step === 'rows')
  expect('rows: bundle enabled', bundleCalls, [{ name: 'fixture-enhance', enabled: true }])
  expect('rows: row enabled by entryId', enabledCalls, [{ id: 'include:fixture-enhance', enabled: true }])
  expect('rows: line reports what it did', [rowsLine?.ok, rowsLine?.enabled], [true, ['fixture-enhance(bundle)', 'fixture-enhance']])
}

/* 6 · runner: verify says whether it actually took effect */
{
  enabledCalls.length = 0
  const lines = await collect({ rawTarget: targetDir, approved: [], values: {} })
  const verify = lines.find(line => line.step === 'verify')
  expect('verify: profile facts', [verify?.installed, verify?.selected], [true, true])
  expect('verify: notes name the disabled row', (verify?.notes ?? []).some(note => note.includes('停用')), true)
  expect('verify: client half not declared', verify?.clientHalf, undefined)
}

await rm(root, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
