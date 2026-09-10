#!/usr/bin/env node
// Installs a logo file into public/ and switches the branding on.
//
//   node scripts/install-logo.mjs path/to/artfresh-logo.png
//
// Copies the file to public/logo.<ext>, derives public/favicon.png where it
// can, and sets NEXT_PUBLIC_HAS_LOGO / NEXT_PUBLIC_LOGO_URL in .env.local so
// the Logo component stops rendering its fallback wordmark.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ENV = join(ROOT, '.env.local');

const src = process.argv[2];
if (!src) {
  console.error('\nUsage: node scripts/install-logo.mjs <path-to-logo>\n');
  console.error('Accepts .svg, .png, .jpg or .webp. SVG is sharpest.\n');
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`\nNot found: ${src}\n`);
  process.exit(1);
}

const ext = extname(src).toLowerCase();
const allowed = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
if (!allowed.includes(ext)) {
  console.error(`\n${ext} is not a supported image type. Use one of: ${allowed.join(', ')}\n`);
  process.exit(1);
}

const target = join(PUBLIC, `logo${ext}`);
copyFileSync(src, target);
console.log(`  logo      public/logo${ext}  (from ${basename(src)})`);

// A raster logo doubles as the favicon; an SVG one needs a separate PNG,
// which we cannot generate without an image library.
let favicon = false;
if (ext !== '.svg') {
  copyFileSync(src, join(PUBLIC, 'favicon.png'));
  favicon = true;
  console.log('  favicon   public/favicon.png');
} else {
  console.log('  favicon   skipped — export a square PNG to public/favicon.png for the tab icon');
}

// --- update .env.local ------------------------------------------------------
let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';

function setKey(key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
}

setKey('NEXT_PUBLIC_HAS_LOGO', 'true');
setKey('NEXT_PUBLIC_LOGO_URL', `/logo${ext}`);
writeFileSync(ENV, env, 'utf8');

console.log('  .env.local NEXT_PUBLIC_HAS_LOGO=true');
console.log(`\nLocal is ready — run: npm run dev`);
console.log('\nFor production, set the same two variables on Vercel:');
console.log('  npx vercel env add NEXT_PUBLIC_HAS_LOGO production     # true');
console.log(`  npx vercel env add NEXT_PUBLIC_LOGO_URL production     # /logo${ext}`);
console.log('  git add public && git commit -m "Add logo" && git push');
if (!favicon) console.log('\nRemember the favicon.png for the browser tab.');
console.log();
