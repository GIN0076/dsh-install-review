/**
 * Offline-ish self-test: run the real audit engine against a stub ctx, so
 * parse/manifest/catalog/slot/peer logic is exercised before the bundle is
 * installed into the live profile. Pure-function cases run first.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseTarget, insertedIds, registeredSlotKeys, peerCheck, runAudit, readRuntimeVersion, resolveDshEngines, slotKeysFromCatalogText, slotCatalogCandidates } from './audit-v4.js'
import { buildProposals, blockingChecks } from './proposals.js'

let failures = 0
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  if (!ok) {
    failures += 1
    console.log(`FAIL ${label}\n  actual  ${JSON.stringify(actual)}\n  wanted  ${JSON.stringify(wanted)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

/* parseTarget */
expect('npm name', parseTarget('dsh-find-plugin').kind, 'registry')
expect('scoped npm', parseTarget('@scope/pkg').name, '@scope/pkg')
expect('pinned npm', parseTarget('dsh-find-plugin@0.4.0').pin, '0.4.0')
expect('github shorthand', parseTarget('github:owner/repo').spec, 'github:owner/repo')
expect('repo slug', parseTarget('owner/repo').kind, 'git')
expect('github url', parseTarget('https://github.com/owner/repo/tree/main/pkg').repo, 'owner/repo')
expect('empty', parseTarget('   ').kind, 'unknown')
expect('unsupported host', parseTarget('https://example.com/x').kind, 'unknown')

/* insertedIds */
const bundlePatch = `- insert:\n    - id: dsh-market\n      name: 'dshmarket'\n`
expect('bundle insert ids', insertedIds(bundlePatch), ['dsh-market'])
const profilePatch = [
  '# comment',
  '- insert:',
  '    - id: install-review',
  "      name: '@local/dsh-install-review'",
  '      config: {}',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      a:',
  '        models: []',
].join('\n')
expect('profile insert ids only', insertedIds(profilePatch), ['install-review'])

/* registeredSlotKeys */
const clientSample = `
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'x' }, C))
  const name = 'some.label'
  ctx.slots.register({ name: 'sidebar.panellist' }, D)
`
expect('slot keys', [...registeredSlotKeys(clientSample)].sort(), ['settings.section', 'sidebar.panellist'])

/* slotKeysFromCatalogText: source (single quotes) and packaged (double quotes) catalogs */
expect('catalog source quoting', [...slotKeysFromCatalogText("  key: 'settings.section',\n  key: 'conversation.chat.node',")].sort(),
  ['conversation.chat.node', 'settings.section'])
expect('catalog packaged quoting', [...slotKeysFromCatalogText('{ key: "settings.plugins.tab", kind: "list" },\n{ key: "shell.overlay", kind: "list" }')].sort(),
  ['settings.plugins.tab', 'shell.overlay'])
expect('catalog skips non-dotted keys', [...slotKeysFromCatalogText('key: "slots", key: \'locale\', key: "settings.section"')], ['settings.section'])
expect('catalog tolerates junk', [...slotKeysFromCatalogText(undefined)].length, 0)

/* slotCatalogCandidates: explicit config first, then packaged runtime next to the anchor, source tree last */
const packagedCtx = { profileContext: { dir: 'C:\\p', installAnchor: 'D:\\app\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh\\package.json' } }
const candidates = slotCatalogCandidates({}, packagedCtx)
const packagedHit = candidates.findIndex(p => p.includes('dsh-cordis-client-runner') && p.includes('lib')) 
expect('candidates put the packaged catalog first', packagedHit >= 0 && packagedHit < candidates.findIndex(p => p.endsWith('slot-catalog.ts')), true)
expect('explicit slotCatalogPath wins', slotCatalogCandidates({ slotCatalogPath: 'X:\\pin\\slot-catalog.ts' }, packagedCtx)[0], 'X:\\pin\\slot-catalog.ts')

/* peerCheck (host mirror) */
expect('peer ok', peerCheck({ peerDependencies: { '@deepseek-ai/dsh-client-locale': '^0.1.0-rc.7' } }, '0.1.7-rc.2', {}).status, 'ok')
expect('peer bad', peerCheck({ name: 'x', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-settings': '^9.0.0' } }, '0.1.7-rc.2', {}).status, 'bad')
expect('peer dsh range ok', peerCheck({ peerDependencies: { '@deepseek-ai/dsh': '>=0.1.0-rc.6' } }, '0.1.7-rc.2', {}).status, 'ok')
expect('workspace range', peerCheck({ peerDependencies: { '@deepseek-ai/dsh': 'workspace:^' } }, '0.1.7-rc.2', {}).status, 'ok')
expect('exempted', peerCheck({ name: 'p', version: '2.0.0', peerDependencies: { '@deepseek-ai/dsh': '^9.0.0' } }, '0.1.7-rc.2', { 'p@2.0.0': ['0.1.7-rc.2'] }).exempted, true)

/* engines: both placements publishers use (v5 fix — dsh-remote-web-ui declares only the bundle face) */
expect('engines top-level placement', resolveDshEngines({ engines: { dsh: '>=0.1.0-rc.6' } }), { range: '>=0.1.0-rc.6', source: 'engines.dsh' })
expect('engines bundle-face placement', resolveDshEngines({ dsh: { engines: { dsh: '>=0.1.7-rc.2' } } }), { range: '>=0.1.7-rc.2', source: 'dsh.engines.dsh' })
expect('engines absent (node-only)', resolveDshEngines({ engines: { node: '^22' } }), undefined)
expect('engines top level wins', resolveDshEngines({ engines: { dsh: 'a' }, dsh: { engines: { dsh: 'b' } } }).source, 'engines.dsh')
expect('engines blank ignored', resolveDshEngines({ engines: { dsh: '   ' } }), undefined)

/* buildProposals */
const fakeReport = {
  target: { kind: 'git', repo: 'o/r', spec: 'github:o/r' },
  manifest: { name: 'r', version: '1.2.3', scripts: { prepare: 'tsc' } },
  catalog: { ok: true, entry: { npm: 'r-npm' } },
  installed: { isInstalled: false },
  row: undefined,
}
expect('git→npm proposal', buildProposals(fakeReport).map(p => p.id), ['source', 'allowbuild', 'profile-config'])
expect('blocking list', blockingChecks({ checks: [{ status: 'block' }, { status: 'warn' }] }).length, 1)

/* runtime version */
console.log(`runtime: ${readRuntimeVersion({ profileContext: { installAnchor: 'E:\\DSH-OneClick\\install-manifest.json' } })}`)

/* full audit against a stub ctx (network) */
const scratch = join(process.cwd(), '_selftest-profile')
await mkdir(scratch, { recursive: true })
await writeFile(join(scratch, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
}, null, 2))
await writeFile(join(scratch, 'cordis.patch.yml'), '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config: {}\n')

const ctx = {
  profileContext: {
    dir: scratch,
    patchPath: join(scratch, 'cordis.patch.yml'),
    installAnchor: 'E:\\DSH-OneClick\\install-manifest.json',
  },
  pluginManager: {
    registries: async () => ({ registry: 'https://registry.npmjs.org/', fallbackRegistries: [], resolved: 'https://registry.npmjs.org/' }),
    inspect: async spec => ({ status: 'accepted', kind: 'registry', name: spec, bundle: true, registry: 'https://registry.npmjs.org/' }),
    listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
    listPlugins: async () => [],
  },
  get: () => undefined,
}

try {
  const report = await runAudit(ctx, {}, { rawTarget: 'dsh-find-plugin' })
  console.log('\n== live audit: dsh-find-plugin ==')
  console.log(`summary: ${JSON.stringify(report.summary)}`)
  for (const item of report.checks) console.log(`  [${item.status}] ${item.id} — ${item.title}：${item.detail}`)
  console.log(`proposals: ${buildProposals(report).map(p => p.id).join(', ')}`)
  expect('audit has no blocks', report.summary.block, 0)
  expect('audit saw the manifest', report.manifest?.name, 'dsh-find-plugin')

  const market = await runAudit(ctx, {}, { rawTarget: 'dshmarket' })
  console.log('\n== live audit: dshmarket ==')
  console.log(`summary: ${JSON.stringify(market.summary)}`)
  for (const item of market.checks) console.log(`  [${item.status}] ${item.id} — ${item.title}：${item.detail}`)
  console.log(`proposals: ${buildProposals(market).map(p => p.id).join(', ')}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
