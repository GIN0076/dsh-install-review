/**
 * Dependency-free subset of node-semver with `includePrerelease: true`
 * semantics, used to evaluate `@deepseek-ai/dsh*` peer ranges exactly the way
 * `app-boot/src/plugin-compatibility.ts` does (that package's own semver is not
 * resolvable from a workspace-authored bundle, and this bundle ships no deps).
 *
 * Supported range grammar: `||` clauses, whitespace-separated comparators,
 * `^`, `~`, `>=`, `<=`, `>`, `<`, `=`, bare versions, partial versions (`1.2`,
 * `1.x`), `*`, and `workspace:^|~|*` handled by the caller before reaching here.
 * Anything else reports `false` so the audit fails closed.
 */

/** Parsed semantic version, or null when the text is not one. */
export function parseVersion(input) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(input ?? '').trim())
  if (match === null) return null
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part))
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease }
}

function compareIdentifiers(a, b) {
  const aNumeric = typeof a === 'number'
  const bNumeric = typeof b === 'number'
  if (aNumeric && bNumeric) return a - b
  if (aNumeric) return -1
  if (bNumeric) return 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Full semver precedence: -1 / 0 / 1. */
export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  const left = a.prerelease
  const right = b.prerelease
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (index >= left.length) return -1
    if (index >= right.length) return 1
    const order = compareIdentifiers(left[index], right[index])
    if (order !== 0) return order < 0 ? -1 : 1
  }
  return 0
}

const ANY = { any: true }

/** Upper bound (exclusive) for a caret range, mirroring node-semver. */
function caretUpper(base) {
  if (base.major > 0) return { major: base.major + 1, minor: 0, patch: 0, prerelease: [] }
  if (base.minor > 0) return { major: 0, minor: base.minor + 1, patch: 0, prerelease: [] }
  return { major: 0, minor: 0, patch: base.patch + 1, prerelease: [] }
}

/** Upper bound (exclusive) for a tilde range, mirroring node-semver (`~1` → `<2.0.0`). */
function tildeUpper(base, kind) {
  if (kind === 'major') return { major: base.major + 1, minor: 0, patch: 0, prerelease: [] }
  return { major: base.major, minor: base.minor + 1, patch: 0, prerelease: [] }
}

/** Parse one partial version such as `1`, `1.2`, `1.2.x`, `1.2.3-rc.1`. */
function parsePartial(text) {
  const match = /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (match === null) return null
  const part = (value, fallback) => (value === undefined || value === 'x' || value === '*' ? fallback : Number(value))
  const major = match[1] === 'x' || match[1] === '*' ? null : Number(match[1])
  if (major === null) return { kind: 'any' }
  const minorIsWild = match[2] === undefined || match[2] === 'x' || match[2] === '*'
  const patchIsWild = match[3] === undefined || match[3] === 'x' || match[3] === '*'
  const prerelease = match[4] === undefined ? [] : match[4].split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id))
  return {
    kind: minorIsWild ? 'major' : patchIsWild ? 'minor' : 'full',
    base: { major, minor: part(match[2], 0), patch: part(match[3], 0), prerelease },
  }
}

function at(op, version) {
  return { op, version }
}

/** One comparator as `{ op, version }`, an array of them, `{ any: true }`, or null. */
function parseComparator(token) {
  if (token === '' || token === '*' || token === 'x') return ANY
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(token)
  if (match === null) return null
  const operator = match[1] ?? '='
  const partial = parsePartial(match[2])
  if (partial === null) return null
  if (partial.kind === 'any') return ANY
  const base = partial.base
  const kind = partial.kind
  // Under includePrerelease the host's node-semver appends `-0` to bounds it
  // synthesizes from a partial version and to every caret/tilde upper bound
  // (`^0.1` admits `0.1.0-rc.7` but not `0.2.0-0`); measured in semver-selftest.mjs.
  const zero = version => ({ ...version, prerelease: version.prerelease.length === 0 ? [0] : version.prerelease })
  const lower = kind === 'full' ? base : zero(base)
  const nextMinorStart = () => ({ ...base, minor: base.minor + 1, patch: 0, prerelease: [] })
  const nextMajorStart = () => ({ ...base, major: base.major + 1, minor: 0, patch: 0, prerelease: [] })
  const equalsUpper = kind === 'major'
    ? nextMajorStart()
    : kind === 'minor'
      ? nextMinorStart()
      : { ...base, patch: base.patch + 1, prerelease: [] }
  if (operator === '^') return [at('>=', lower), at('<', zero(caretUpper(base)))]
  if (operator === '~') return [at('>=', lower), at('<', zero(tildeUpper(base, kind)))]
  if (operator === '>=') return at('>=', lower)
  if (operator === '<=') {
    if (kind === 'full') return at('<=', base)
    // `<=1.2` covers every `1.2.x` and stops just below the next minor.
    return at('<', zero(kind === 'major' ? nextMajorStart() : nextMinorStart()))
  }
  if (operator === '<') {
    if (kind === 'full') return at('<', base)
    return at('<', zero(base))
  }
  if (operator === '>') {
    if (kind === 'full') return at('>', base)
    // `>1.2` means `>=1.3.0-0`; `>1` means `>=2.0.0-0`.
    return at('>=', zero(kind === 'major' ? nextMajorStart() : nextMinorStart()))
  }
  if (kind === 'full') return at('=', base)
  return [at('>=', zero(base)), at('<', zero(equalsUpper))]
}

function holds(version, comparator) {
  if (comparator === null) return false
  if (Array.isArray(comparator)) return comparator.every(single => holds(version, single))
  if (comparator.any === true) return true
  const order = compareVersions(version, comparator.version)
  switch (comparator.op) {
    case '=': return order === 0
    case '>': return order > 0
    case '>=': return order >= 0
    case '<': return order < 0
    case '<=': return order <= 0
    default: return false
  }
}

/**
 * Whether `version` satisfies `range` with prerelease participation enabled.
 * @param version - exact version, e.g. `0.1.7-rc.2`.
 * @param range - npm range such as `^0.1.0-rc.7 || ^0.1.1-rc.2`.
 * @returns true when some clause holds for every comparator.
 */
export function satisfies(version, range) {
  const parsed = parseVersion(version)
  if (parsed === null) return false
  const text = String(range ?? '').trim()
  if (text === '') return false
  return text.split('||').some((clause) => {
    const tokens = clause.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return true
    return tokens.every(token => holds(parsed, parseComparator(token)))
  })
}
