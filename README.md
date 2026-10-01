<div align="center">
<img src="assets/logo.jpg" width="170" alt="Pre-install Review">

# Pre-install Review · 插件装前审查

**Know what it is before you let it in.**

English · [简体中文](./README.zh.md) · [CHANGELOG](./CHANGELOG.md)

![](https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-blue?style=flat-square)
![](https://img.shields.io/badge/checks-13~14-brightgreen?style=flat-square)
![](https://img.shields.io/badge/runtime%20deps-0-orange?style=flat-square)
![](https://img.shields.io/badge/host%20source%20changes-0-red?style=flat-square)
![](https://img.shields.io/badge/license-MIT-green?style=flat-square)

</div>

> **Every plugin you install holds your keys.** It can read every session, call every model,
> rewrite your profile. And "the author says it's harmless" —
> **that is exactly what every plugin that ever went bad has said too.**

## Three uncomfortable facts

1. **Being on a list is not a safety endorsement.** When the upstream list carries no capability
   scan, this panel says so — *"upstream did not annotate capabilities"* — instead of inventing a
   green checkmark for it.
2. **The ecosystem default is "install first, ask later."** No backup, no plan approval, no
   post-install verification — when something breaks, your only rollback is the whole profile.
3. **All-green still does not mean harmless.** But a red light always does: one **block** means
   the right move is to close the page.

**This plugin does exactly one thing: before you hit *Install*, force the package to show its
face — what it is, what it can touch, what it will change — and let you approve every change
yourself.**

## Screenshots

| 📋 Audit report (seconds, capabilities & red lines included) |
| --- |
| ![](assets/report.jpg) |

| 🗂 Browsable catalog (4,377-entry snapshot; server-side search / filter / sort) |
| --- |
| ![](assets/catalog.jpg) |

| ✅ Change plan · your note · import a revision |
| --- |
| ![](assets/plan-amend.jpg) |

## What it checks (13–14 checks, all read-only)

| Check | Detail |
| --- | --- |
| Local runtime | DSH version and profile (**path auto-masked** — screenshots are safe to share) |
| Official inspect | `pluginManager.inspect`: `dsh.bundle` / `dsh.client` / `dsh.tool` / `dsh.page` / `dsh.configForm` |
| Peer compatibility | Mirrors the host's own resolution (incl. `includePrerelease`) — **1,280 cases match host semver exactly** |
| Catalog entry | Registry, repository, stars, 30-day downloads (**no repo stars passed off as package stars**) |
| Install state | Installed / not installed (recognises 4 loader-id shapes) |
| Loader-id collision | Intersects with every live loader row — a duplicate id crashes host startup; this check is bought with a real lesson |
| Patch override rows | The target patch's override rows: do their targets exist? double-written by another plugin? (self-review never flags itself) |
| Slot audit | Checked one by one against the local slot catalog — the source `slot-catalog.ts`, or on a **packaged Desktop install** the catalog compiled into `app.asar/…/dsh-cordis-client-runner/lib/client.js` — **a slot check that cannot run is a warning**: unknown ≠ pass |
| Install scripts | `prepare` / `postinstall` etc. → enters the "approve & retry" flow automatically |
| Terminal-shaped surface | CLI-flavoured description → warns it may do nothing in a web profile |
| engines | **Both placements read**: `engines.dsh` and `dsh.engines.dsh` (missing one misreports "undeclared") |
| Host-tampering language | Description talks about patching the DSH core → warning |
| Capabilities & red lines | The list's 10 capability tags plus red-line sentences, **translated**; unannotated stays unannotated |

## The loop: audit → plan → approve → change → install → verify

1. **Audit**: type `npm package` / `owner/repo` / `github:owner/repo` / a GitHub URL → report in seconds
2. **Plan**: only **executable change kinds** — nothing runs unless you tick it. **Select all / Clear all**
   next to the title ticks every runnable item at once; two kinds are deliberately left alone and the
   panel says why — anything that still owes *your* risk acknowledgement, and the download-source lever
   (selecting it would re-point the source; it is a fix for a failure, not a plan item)
   - **Pin / update the version** (when a newer release exists it offers *"update to X"* — the
     dependency version moves, your profile config is left alone)
   - **Clear the version check** (`peer-compat` red): grant the host's own exact-version exemption for
     *this exact pair* (package@version + your DSH version) and continue installing. You must first tick
     **"I have read and accept the risk"** — a human step an imported revision cannot take for you; the
     exemption covers that one pair only, expires by itself when either side moves, and can be revoked
     from the same panel (a standalone action that installs nothing)
   - **Change the download source** (pick a registry; when a registry-shaped failure happens the panel
     also offers a one-click *"retry from another source"*)
   - **Turn on features it declares but the loader is not running** (enabled row by row, only for ids
     this package declares)
   - **Approve build scripts** (when pnpm blocks one, it retries once with the **exact package name pnpm
     reported** — never a guessed wildcard)
   - **Write profile config** (through the official `configEditor` channel: lock, validate, roll back;
     the template is **pre-filled from the package's own patch defaults merged with your current
     config**, so you only review it)
   - **Switch source** (git repository → pinned npm package)
3. **Your note**: disagree with the plan? Write it under *your note* → press **"Copy report for
   review"** and paste it into your chat session → the agent returns a **revision JSON** → paste
   it into *Import revision* to flip tick boxes and values in one click (a mismatched target is
   rejected outright)
4. **Execute**: backs up `package.json`, `cordis.patch.yml`, `pnpm-workspace.yaml`, `cordis.yml`
   (plus `compatibility.json` when an exemption record exists) **first** → applies the approved
   changes → installs → **verifies**
5. **Verification checks that it really took effect**: not just "is it installed / any duplicate loader
   id", but whether the package's rows are actually **active** (`failed` is called out), whether its
   bundle is selected, and whether a declared browser half reached the client module graph — with plain
   conclusions such as *"row X is not active yet — a dsh restart is usually required"*
6. **Build scripts blocked?** The panel shows an inline *"Approve `<name>` build scripts &
   retry"* button — no deadlock, no overreach (a name that is no longer pending is refused by
   the official `stale-approval` guard)

## After a red light: not a dead end any more

- **Peer mismatch** (the usual "cannot install"): the host itself leaves one way through — an
  exact-version exemption. The panel turns it into a button: off by default, granted only after you
  tick and confirm the risk, scoped to that one version pair, auto-expiring when either side moves.
- **`engines.dsh` mismatch**: it stays a **block** (the author's declaration is a real signal), but the
  report says plainly that the host checks **`peerDependencies` only** and never refuses a plugin over
  `engines` — so you get an "I understand, install anyway" box, plus a "use a version that satisfies it"
  option.
- Some findings stay hard blockers with **no safe remedy** (unreadable manifest, no `dsh.bundle`,
  a loader-id collision): the report says so and advises against installing.

## Boundaries (trust is built by saying what you will NOT do)

- **Never edits third-party plugin code.** It only touches four kinds of *your own* config:
  source, version, build approval, profile config.
- **Never patches host source.** Zero host patches; everything goes through public services and
  profile files.
- **Unannotated capabilities ≠ safe.** We show the facts; we do not vouch for upstream.
- **This is a pre-flight check, not a code audit.** It answers *"can I install it, and what
  will it touch?"* — not *"is there a backdoor?"*

## Install

```sh
dsh plugin --profile web add github:GIN0076/dsh-install-review
```

- Requires DeepSeek Harness **0.2.0-rc.2** (the version this was tested against), on a web profile **or the Desktop app**
- **Zero runtime dependencies**, no build step, no postinstall
- Add `@local/dsh-install-review` to the profile's `dsh.profile.bundles` and add its insert row to
  `cordis.patch.yml`; running only the `add` command puts the repository in `node_modules` but
  **does not mount the interface**
- Restart `dsh web`, then hard-refresh (Ctrl+Shift+R) → Settings → **插件装前审查 / Pre-install Review**

**Desktop (packaged app, measured on 0.2.0-rc.2)**: Settings → Plugins → **Add plugin** with the
local directory path (or `install_bundle` from the plugin-manager tooling), then restart DeepSeek
Harness. Two things differ from a browser hitting the Host directly, and v1.1.0 handles both:
① the runtime lives inside `resources/app.asar` and ships **no `src/` tree**, so the slot audit reads
the **compiled** catalog (`…/dsh-cordis-client-runner/lib/client.js`);
② the window's origin is `dsh-app://app` and its protocol handler **deletes `Origin` / `Sec-Fetch-Site`
/ `Cookie`** before forwarding, then injects the Host's own session cookie → the panel no longer
compares Origin itself but asks the Host's `connection.requestRejection` (the same channel the
official `@deepseek-ai/dsh-host-open-in-app` uses; no cookie → 401, cross-site Origin → 403, and the
refusal now carries a `hint` plus the headers it saw). The host half advanced to `host-v8.js`.

> Prefer not to use git? Copy the repository locally and point the plugin manager's
`install_bundle` at the directory, then complete the same two profile configuration steps.

## Uninstall

Settings → Plugins → remove, or `remove_bundle` in the plugin manager.
**Uninstall does not delete your backups** — every pre-execution backup is
written to `<profile>/install-review-backup` (the row's `backupDir` can move it).

## Self-tests

```sh
node semver-selftest.mjs          # 1,280 cases, identical to host semver (SKIP when no host semver)
node catalog-view-selftest.mjs    # categories / capabilities / red lines / projection
node patch-audit-selftest.mjs     # override-row parsing and verdicts
node audit-selftest.mjs           # parsing / peers / both engines placements / end-to-end
node remedy-selftest.mjs          # remedies: exemption before install, nothing without the human tick,
                                  # an imported revision cannot self-approve, revoke is standalone
node enhance-selftest.mjs         # capability proposals: config-template scanner / registry order /
                                  # upgrade keeps config / rows enabled by entryId / post-install activation
node runner-selftest.mjs          # backups / config edits / approvedBuilds / stale-approval
node host-selftest.mjs            # routes and same-origin fence
node client-selftest.mjs          # revision-import loop (+ SSR render when react-dom exists)
```

**Nine self-tests — zero test framework, zero dependencies.** The two end-to-end tests read the
live upstream catalog: when the target declares peers incompatible with the current DSH, that
block is expected. A green run is not an installation approval.

> The self-tests resolve their host packages themselves (`selftest-host.mjs`: source checkout →
> local `node_modules` → packaged runtime) — **no install path is hardcoded any more**. To get the
> real 1,280-case semver comparison on the Desktop build:
> `$env:ELECTRON_RUN_AS_NODE=1; & "…\DeepSeek Harness.exe" semver-selftest.mjs` — it uses the
> semver inside `app.asar`. When node-semver / react-dom cannot be found, that pass prints `SKIP`
> (never FAIL); point `DSH_SELFTEST_SEMVER` / `DSH_SELFTEST_REACT` / `DSH_SELFTEST_REACT_DOM` at an
> exact file to restore it. The username in the fixtures is fake (`localtester`) precisely so the
> tests can prove that local paths in reports are always masked.

## Disclaimer

This tool checks *installability and blast radius* before installation. No automated check
replaces your own judgement of where a plugin comes from. Catalog data is an upstream snapshot
(4,377 entries; downloads window shown in the UI) and reflects the moment it was fetched.

## License

[MIT](./LICENSE) © 2026 GIN0076
