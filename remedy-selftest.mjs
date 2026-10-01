/**
 * Self-test for the v1.2 remedy path — a blocked report must offer a way
 * through, and only the human's own acknowledgement may take it.
 *
 * Everything here is local: the target is a fixture directory on disk (so no
 * registry/GitHub fetch) and the catalog URL points at a dead port.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runAudit } from './audit-v6.js'
import { buildProposals } from './proposals-v3.js'
import { runExecute } from './runner-v7.js'

const root = join(process.cwd(), '_selftest-remedy')
const profile = join(root, 'profile')
const targetDir = join(root, 'target')
const backupDir = join(root, 'backups')
await rm(root, { recursive: true, force: true })
await mkdir(profile, { recursive: true })
await mkdir(targetDir, { recursive: true })

await writeFile(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
}, null, 2))
await writeFile(join(profile, 'cordis.patch.yml'), '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config: {}\n')
const anchor = join(profile, 'install-manifest.json')
await writeFile(anchor, JSON.stringify({ npmName: 'dsh-v0.2.0-rc.2' }, null, 2))

/* the fixture: an engines range far above this runtime, and a peer range 0.2.x fails */
await writeFile(join(targetDir, 'package.json'), JSON.stringify({
  name: 'fixture-remedy',
  version: '1.0.0',
  description: 'local fixture for the remedy self-test',
  dsh: { bundle: { patch: './cordis.patch.yml' }, engines: { dsh: '>=99.0.0' } },
  peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0' },
}, null, 2))
await writeFile(join(targetDir, 'cordis.patch.yml'), "- insert:\n    - id: fixture-remedy\n      name: './index.js'\n      config: {}\n")

let exemptions = {}
const exemptionCalls = []
const installCalls = []
let exemptionBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable' })
let installBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable', target: 'fixture-remedy', bundle: 'fixture-remedy' })

const ctx = {
  profileContext: { dir: profile, patchPath: join(profile, 'cordis.patch.yml'), installAnchor: anchor },
  pluginManager: {
    registries: async () => ({ registry: null, fallbackRegistries: [], resolved: null }),
    inspect: async spec => ({ status: 'accepted', kind: 'path', name: 'fixture-remedy', bundle: true, registry: null }),
    listVersionExemptions: () => ({ exemptions, warnings: [] }),
    listPlugins: async () => [],
    listBundles: async () => [],
    installBundle: async (spec, options) => {
      installCalls.push({ spec, options })
      return installBehaviour(spec, options)
    },
    cancelInstall: async () => ({ status: 'not-running' }),
    setVersionExemption: async (packageVersion, runtimeVersion, enabled, acceptRisk) => {
      exemptionCalls.push({ packageVersion, runtimeVersion, enabled, acceptRisk })
      return exemptionBehaviour(packageVersion, runtimeVersion, enabled)
    },
  },
  get: () => undefined,
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

/* 0 · the audit explains how each block may be crossed, and offers the pair */
const report = await runAudit(ctx, options, { rawTarget: targetDir })
{
  const peer = report.checks.find(item => item.id === 'peer-compat')
  const engines = report.checks.find(item => item.id === 'engines')
  expect('audit: runtime read from the anchor', report.runtime.version, '0.2.0-rc.2')
  expect('audit: peer blocked', peer?.status, 'block')
  expect('audit: peer points at the exemption remedy', peer?.remedyIds, ['exemption'])
  expect('audit: peer may NOT be waved through by an ack', peer?.overridable === true, false)
  expect('audit: exemption pair is exact', [report.exemption?.packageVersion, report.exemption?.runtimeVersion], ['fixture-remedy@1.0.0', '0.2.0-rc.2'])
  expect('audit: engines blocked but overridable', [engines?.status, engines?.overridable === true, typeof engines?.ackLabel], ['block', true, 'string'])
  const proposals = buildProposals(report)
  const exemption = proposals.find(proposal => proposal.id === 'exemption')
  expect('audit: exemption proposal offered', [exemption?.kind, exemption?.resolves, typeof exemption?.acknowledge?.label], ['exemption', ['peer-compat'], 'string'])
  expect('audit: no revoke button while not exempted', proposals.some(proposal => proposal.id === 'revoke-exemption'), false)
}

/* 1 · an unresolved block runs nothing at all */
{
  exemptionCalls.length = 0
  installCalls.length = 0
  const lines = await collect({ rawTarget: targetDir, approved: [], acknowledged: [], values: {} })
  expect('1 refused at the end', lines.at(-1)?.step, 'error')
  expect('1 names the unresolved blocks', /peer-compat/.test(lines.at(-1)?.message ?? ''), true)
  expect('1 nothing was called', [exemptionCalls.length, installCalls.length], [0, 0])
}

/* 2 · acknowledging engines alone is not enough: the peer block still holds */
{
  const lines = await collect({ rawTarget: targetDir, approved: [], acknowledged: ['engines'], values: {} })
  expect('2 still stopped by the peer block', /peer-compat/.test(lines.at(-1)?.message ?? ''), true)
  expect('2 nothing was called', [exemptionCalls.length, installCalls.length], [0, 0])
}

/* 3 · a ticked exemption without the human risk token is refused (imported
     revisions cannot self-approve a risky remedy) */
{
  const lines = await collect({ rawTarget: targetDir, approved: ['exemption'], acknowledged: ['engines'], values: {} })
  expect('3 refused for the missing risk token', /risk:exemption/.test(lines.at(-1)?.message ?? ''), true)
  expect('3 nothing was called', [exemptionCalls.length, installCalls.length], [0, 0])
}

/* 4 · full approval: the exemption is granted BEFORE the install */
{
  exemptionCalls.length = 0
  installCalls.length = 0
  const lines = await collect({ rawTarget: targetDir, approved: ['exemption'], acknowledged: ['engines', 'risk:exemption'], values: {} })
  const steps = lines.map(line => line.step)
  expect('4 exemption runs before install', steps.indexOf('exemption') < steps.indexOf('install-start'), true)
  expect('4 grant call', exemptionCalls, [{ packageVersion: 'fixture-remedy@1.0.0', runtimeVersion: '0.2.0-rc.2', enabled: true, acceptRisk: true }])
  expect('4 exemption line reports ok', lines.find(line => line.step === 'exemption')?.ok, true)
  expect('4 installed once', installCalls.length, 1)
  expect('4 done succeeded', lines.find(line => line.step === 'done')?.succeeded, true)
}

/* 5 · a failed grant aborts before anything is installed */
{
  exemptionCalls.length = 0
  installCalls.length = 0
  exemptionBehaviour = () => ({ changed: false, application: 'failed', error: { code: 'operation-error', diagnostic: 'no such exemption' } })
  const lines = await collect({ rawTarget: targetDir, approved: ['exemption'], acknowledged: ['engines', 'risk:exemption'], values: {} })
  expect('5 stopped', lines.at(-1)?.step, 'error')
  expect('5 error names the grant', /豁免未授予/.test(lines.at(-1)?.message ?? ''), true)
  expect('5 no install ran', installCalls.length, 0)
  exemptionBehaviour = () => ({ changed: true, application: 'applied', stage: 'enable' })
}

/* 6 · revoke is a standalone run: no install, no config write */
{
  exemptions = { 'fixture-remedy@1.0.0': ['0.2.0-rc.2'] }
  exemptionCalls.length = 0
  installCalls.length = 0
  const lines = await collect({ rawTarget: targetDir, approved: ['revoke-exemption'], acknowledged: ['engines', 'risk:revoke-exemption'], values: {} })
  expect('6 revoke call', exemptionCalls, [{ packageVersion: 'fixture-remedy@1.0.0', runtimeVersion: '0.2.0-rc.2', enabled: false, acceptRisk: undefined }])
  expect('6 nothing installed', installCalls.length, 0)
  expect('6 done = exemption-revoked', lines.find(line => line.step === 'done')?.application, 'exemption-revoked')
  exemptions = {}
}

await rm(root, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
