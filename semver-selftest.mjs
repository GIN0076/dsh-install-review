/** Compare semver-lite against the host's node-semver for a peer-range corpus. */
import { satisfies as hostSatisfies } from 'file:///E:/DSH-OneClick/src/node_modules/.pnpm/semver@7.8.5/node_modules/semver/index.js'
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

let checked = 0
let mismatched = 0
for (const range of ranges) {
  const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? '0.1.7-rc.2' : range
  for (const version of versions) {
    let host
    try {
      host = requirement.trim() === '' ? false : hostSatisfies(version, requirement, { includePrerelease: true })
    } catch {
      host = '<throws>'
    }
    const mine = liteSatisfies(version, requirement)
    checked += 1
    const hostBool = host === '<throws>' ? 'throws' : String(host)
    if (hostBool !== String(mine)) {
      mismatched += 1
      console.log(`MISMATCH version=${version} range=${JSON.stringify(range)} host=${hostBool} lite=${mine}`)
    }
  }
}
console.log(`checked=${checked} mismatched=${mismatched}`)
if (mismatched > 0) process.exitCode = 1
