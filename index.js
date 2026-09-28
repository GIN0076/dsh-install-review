/**
 * Package entry facade — kept so `package.json` `exports['.']` resolves.
 *
 * The LIVE Host half is whatever `./host-vN.js` the loader row names in
 * `cordis.patch.yml` (currently `./host-v6.js`). Node ESM caches modules by
 * URL for the life of the process, so a Host-half fix cannot land in a file
 * that has already been imported: bump to the next `host-vN.js`, point the row
 * there, then `remove_bundle` + `install_bundle` (a full `dsh web` restart also
 * works but interrupts live sessions). Lesson:
 * `.memory/esm-url-cache-blocks-plugin-reload`.
 *
 * Superseded generations kept for history: `host-v1.js` … `host-v5.js`
 * (with their `audit.js`/`audit-v2.js` / `runner*.js`), which this process
 * may still hold.
 */
export { inject, apply } from './host-v6.js'
