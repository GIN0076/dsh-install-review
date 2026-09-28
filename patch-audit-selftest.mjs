/**
 * Tests for the precheck-style override audit: parsing Loader patches into
 * insert vs override rows, judging missing/double-written targets, and the
 * end-to-end append (offline, against a local path target).
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePatchRows, checkOverrides, auditPatchOverrides } from './patch-audit.js'

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

/* --- parsing --------------------------------------------------------------- */
const bundlePatch = [
  '# comment',
  '- insert:',
  '    - id: dsh-market',
  "      name: 'dshmarket'",
  '',
].join('\n')
expect('bundle patch = inserts only', parsePatchRows(bundlePatch), { insertIds: ['dsh-market'], overrides: [] })

const profilePatch = [
  '- insert:',
  '    - id: install-review',
  "      name: '@local/dsh-install-review'",
  '      config: {}',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      a: 1',
  '- id: plan-mode',
  '  disabled: true',
].join('\n')
const parsed = parsePatchRows(profilePatch)
expect('profile patch inserts', parsed.insertIds, ['install-review'])
expect('profile patch overrides count', parsed.overrides.length, 2)
expect('override captures name', parsed.overrides[0], { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', hasConfig: true })
expect('override captures disabled', parsed.overrides[1], { id: 'plan-mode', disabled: true })

/* --- judging ---------------------------------------------------------------- */
const liveIds = new Set(['llm-pi-ai', 'plan-mode'])
const none = new Map()
const withOthers = new Map([['llm-pi-ai', ['dsh-someone-else']]])

expect('no overrides → no check', checkOverrides({ overrideIds: [], liveIds, bundleOverrides: none }), undefined)

const missingCheck = checkOverrides({ overrideIds: ['ghost-id'], liveIds, bundleOverrides: none })
expect('missing target warns', [missingCheck.status, missingCheck.id], ['warn', 'patch-override'])
expect('missing target detail names it', missingCheck.detail.includes('ghost-id'), true)

const doubledCheck = checkOverrides({ overrideIds: ['llm-pi-ai'], liveIds, bundleOverrides: withOthers, self: '@local/dsh-install-review' })
expect('double write warns', doubledCheck.status, 'warn')
expect('double write names the other bundle', doubledCheck.detail.includes('dsh-someone-else'), true)

const selfCheck = checkOverrides({ overrideIds: ['llm-pi-ai'], liveIds, bundleOverrides: new Map([['llm-pi-ai', ['self-pkg']]]), self: 'self-pkg' })
expect('own rows are not a conflict', selfCheck.status, 'info')

const okCheck = checkOverrides({ overrideIds: ['llm-pi-ai', 'plan-mode'], liveIds, bundleOverrides: none, self: 'self-pkg' })
expect('valid overrides are info', [okCheck.status, okCheck.detail.includes('llm-pi-ai, plan-mode')], ['info', true])

/* --- end-to-end append against a local path target --------------------------- */
const scratch = join(process.cwd(), '_selftest-patch')
await mkdir(scratch, { recursive: true })

const ctx = {
  pluginManager: {
    listPlugins: async () => [{ patchId: 'llm-pi-ai' }, { patchId: 'plan-mode' }],
    listBundles: async () => [{ name: 'dsh-someone-else', overrides: ['llm-pi-ai'] }, { name: '@local/dsh-install-review', overrides: [] }],
  },
}

/* target overrides one live row that someone else also rewrites → warn */
await writeFile(join(scratch, 'cordis.patch.yml'), [
  '- insert:',
  '    - id: their-plugin',
  "      name: 'their-plugin'",
  '- id: llm-pi-ai',
  '  config:',
  '    x: 1',
  '',
].join('\n'))
const ghostReport = {
  target: { kind: 'path', path: scratch },
  manifest: { name: 'their-plugin', bundlePatch: './cordis.patch.yml' },
  checks: [{ id: 'a', status: 'pass' }],
  summary: { block: 0, warn: 0, pass: 1, info: 0 },
}
const appended = await auditPatchOverrides(ctx, ghostReport, {})
expect('append warns on double write', [appended.status, ghostReport.checks.length, ghostReport.summary.warn], ['warn', 2, 1])
expect('append detail mentions the other bundle', appended.detail.includes('dsh-someone-else'), true)

/* target with only inserts → no check appended */
await writeFile(join(scratch, 'cordis.patch.yml'), '- insert:\n    - id: their-plugin\n      name: their-plugin\n')
const insertOnly = {
  target: { kind: 'path', path: scratch },
  manifest: { name: 'their-plugin', bundlePatch: './cordis.patch.yml' },
  checks: [],
  summary: { block: 0, warn: 0, pass: 0, info: 0 },
}
const nothing = await auditPatchOverrides(ctx, insertOnly, {})
expect('insert-only target adds no check', [nothing, insertOnly.checks.length], [undefined, 0])

/* unreadable patch → info check, not a crash */
const broken = {
  target: { kind: 'path', path: join(scratch, 'nope') },
  manifest: { name: 'x', bundlePatch: './cordis.patch.yml' },
  checks: [],
  summary: { block: 0, warn: 0, pass: 0, info: 0 },
}
const failed = await auditPatchOverrides(ctx, broken, {})
expect('unreadable patch → info not crash', [failed.status, failed.id], ['info', 'patch-override'])

await rm(scratch, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
