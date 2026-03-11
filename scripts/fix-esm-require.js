// Post-build fix for @vercel/ncc ESM compatibility.
//
// ncc emits `eval("require")("...")` for some optional/dynamic modules.
// When package.json has "type": "module", Node.js runs the bundle as ESM
// where bare `require` is not defined — causing a ReferenceError at runtime.
//
// ncc already imports createRequire at the top of the bundle:
//   import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
// and uses it for Node builtins. This script patches the remaining
// eval("require") calls to use the same mechanism.

import { readFileSync, writeFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
    console.error('Usage: node scripts/fix-esm-require.js <bundle.js>');
    process.exit(1);
}

const content = readFileSync(file, 'utf8');
const fixed = content.replaceAll(
    'eval("require")',
    '__WEBPACK_EXTERNAL_createRequire(import.meta.url)',
);

if (fixed !== content) {
    writeFileSync(file, fixed);
    const count = (content.match(/eval\("require"\)/g) || []).length;
    console.log(`fix-esm-require: patched ${count} eval("require") call(s) in ${file}`);
} else {
    console.log(`fix-esm-require: no eval("require") found in ${file}`);
}
