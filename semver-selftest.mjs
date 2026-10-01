/**
 * Compare semver-lite against the host's node-semver for a peer-range corpus.
 *
 * The host copy is resolved at run time (see `selftest-host.mjs`): the old
 * hardcoded `E:/DSH-OneClick/src/node_modules/.pnpm/semver@7.8.5/…` path died
 * with the source checkout the packaged Desktop app replaced. Run this file
 * with the Desktop's Electron node (`ELECTRON_RUN_AS_NODE=1`) and the semver
 * shipped in `app.asar/dsh/node_modules` is found, so the 1280-case parity
 * comparison still really runs; anywhere else it prints SKIP instead of
 * crashing on import.
 */
import { importHostModule } from './selftest-host.mjs'
import { satisfies as liteSatisfies } from './semver-lite.js'

const ranges = [
  '^0.1.0-rc.7 || ^0.1.1-rc.2 || ^0.1.2-alpha.2',
  '^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2 || ^0.1.3-alpha.2 || ^0.1.5-alpha.1 || ^0.1.6-alpha.1 || ^0.1.7-alpha.1',
  '^4.0.1', '^3.18.1', '^1.2.3', '~1.2.3', '~1.2', '~1', '^1', '^0.1', '^0.0.1',
  '1.2.3', '>=1.0.0 <2.0.0', '<0.2.0', '>=0.1.0-rc.7', '^0.1.7-rc.1', '^0.2.0',
  '*', '>=1.2', '<=1.2', '>1.2', '>=1', '<0.1', '>=0.1', '>0.1', '<=0.1', '0.1',
  '^0.1.0', '~0.1.0', '1.2', '<1.2', '>1', '^1.2.3', '~1.2.3', '^0.1.0',
  'workspace:^', 'workspace:*',
  '^0.1.0-rc.7', '^0.1.7-alpha.1 || ^0.1.6-alpha.1', '>=1.0.0-alpha.1',
]
const versions = [
  '0.1.7-rc.2', '0.1.0-rc.7', '0.1.7', '1.0.0', '4.0.1', '4.1.0', '3.18.1',
  '2.0.0', '1.2.5', '1.3.0', '0.2.0', '0.1.7-rc.1', '0.1.6-alpha.1', '5.0.0',
  '1.2.3', '1.2.4', '0.0.1', '0.1.0', '1.1.9', '0.3.0',
  '0.1.0-0', '0.2.0-0', '0.2.0-alpha', '1.0.0-0', '2.0.0-0', '2.0.0-alpha',
  '1.3.0-0', '1.3.0-alpha', '0.1.9', '0.0.9', '1.0.0-alpha.1', '0.1.0-rc.8',
]

const host = await importHostModule('semver', 'index.js', 'DSH_SELFTEST_SEMVER')
if (host === undefined) {
  console.log(`SKIP host parity: 本机找不到 node-semver（${ranges.length * versions.length} 例语料未与宿主比对）`)
  console.log('     用桌面版 node 跑（ELECTRON_RUN_AS_NODE=1 "…\\DeepSeek Harness.exe" semver-selftest.mjs）或设 DSH_SELFTEST_SEMVER=<semver/index.js> 可恢复比对。')
  process.exitCode = 0
} else {
  const hostSatisfies = host.module.satisfies
  console.log(`host semver: ${host.path}`)
  let checked = 0
  let mismatched = 0
  for (const range of ranges) {
    const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? '0.1.7-rc.2' : range
    for (const version of versions) {
      let host2
      try {
        host2 = requirement.trim() === '' ? false : hostSatisfies(version, requirement, { includePrerelease: true })
      } catch {
        host2 = '<throws>'
      }
      const mine = liteSatisfies(version, requirement)
      checked += 1
      const hostBool = host2 === '<throws>' ? 'throws' : String(host2)
      if (hostBool !== String(mine)) {
        mismatched += 1
        console.log(`MISMATCH version=${version} range=${JSON.stringify(range)} host=${hostBool} lite=${mine}`)
      }
    }
  }
  console.log(`checked=${checked} mismatched=${mismatched}`)
  if (mismatched > 0) process.exitCode = 1
}
