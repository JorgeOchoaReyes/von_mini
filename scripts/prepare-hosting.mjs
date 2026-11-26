// Firebase Hosting never uploads folders named node_modules, but `expo export`
// puts font assets under dist/assets/node_modules/. Rename that folder and
// point the bundle at the new path.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const dist = 'dist';
const from = join(dist, 'assets', 'node_modules');
const to = join(dist, 'assets', 'vendor');
if (existsSync(from)) renameSync(from, to);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const textFiles = () => walk(dist).filter((f) => /\.(js|html|css|json)$/.test(f));

// Patch the paths. A patched bundle keeps its content-hashed name, which would
// let browsers serve a stale cached copy, so give each one a new name too.
const renamed = [];
for (const file of textFiles()) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('/assets/node_modules/')) continue;
  writeFileSync(file, src.replaceAll('/assets/node_modules/', '/assets/vendor/'));
  if (file.endsWith('.js')) {
    const next = file.replace(/\.js$/, '-h.js');
    renameSync(file, next);
    renamed.push([basename(file), basename(next)]);
  }
}
for (const file of textFiles()) {
  let src = readFileSync(file, 'utf8');
  let changed = false;
  for (const [a, b] of renamed) {
    if (src.includes(a)) {
      src = src.replaceAll(a, b);
      changed = true;
    }
  }
  if (changed) writeFileSync(file, src);
}
console.log(`prepare-hosting: moved fonts to assets/vendor, renamed ${renamed.length} patched bundle(s)`);
