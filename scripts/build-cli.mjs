import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['cli/index.ts'], outfile: 'dist-cli/threadpack.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  define: { __THREADPACK_VERSION__: JSON.stringify(metadata.version) },
  legalComments: 'none',
});
