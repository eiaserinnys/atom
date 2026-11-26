// Entry for `npm run setup`. A fresh checkout runs the TypeScript source through tsx right after `npm ci`
// (before any build); a production image has no devDependencies, so it runs the compiled dist/setup/main.js.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let entry = path.join(root, 'dist/setup/main.js');
try {
  const { register } = await import('tsx/esm/api');
  register();
  entry = path.join(root, 'src/setup/main.ts');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

try {
  await import(pathToFileURL(entry).href);
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.error('Setup cannot run yet. Run `npm ci` first (it installs tsx) or `npm run build`.');
  process.exitCode = 1;
}
