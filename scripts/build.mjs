import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const item of ['index.html', 'styles.css', 'src', 'fonts', 'sounds']) {
  await cp(path.join(root, item), path.join(output, item), { recursive: true });
}
console.log('Built Fuzukue in dist/');
