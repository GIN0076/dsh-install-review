/**
 * Package entry facade — kept so `package.json` `exports['.']` resolves.
 *
 * The LIVE Host half is whatever `./host-vN.js` the loader row names in
 * `cordis.patch.yml` (currently `./host-v10.js`). Node ESM caches modules by
 * URL for the life of the process, so a Host-half fix cannot land in a file
 * that has already been imported: bump to the next `host-vN.js`, point the row
 * there, then `remove_bundle` + `install_bundle` (a full `dsh` restart also
 * works but interrupts live sessions). Lesson:
 * `.memory/esm-url-cache-blocks-plugin-reload`.
 *
 * Superseded generations kept for history: `host-v1.js` … `host-v6.js`,
 * `host-v8.js`, `host-v9.js` (with their `audit*.js` / `proposals*.js` /
 * `runner*.js`), which this process may still hold. `host-v7.js` was retired
 * the day it was written, before v1.1.0 shipped.
 */
export { inject, apply } from './host-v10.js'
