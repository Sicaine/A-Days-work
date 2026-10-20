// Copies the static game into _site/ for GitHub Pages. No bundler needed.
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../_site/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of ['index.html', 'style.css', 'src', 'vendor']) cpSync(new URL(`../${f}`, import.meta.url), new URL(f, out), { recursive: true });
writeFileSync(new URL('.nojekyll', out), '');
console.log('built _site/');
