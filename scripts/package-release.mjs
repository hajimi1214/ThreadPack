import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const release = join(root, 'release', `v${version}`);
mkdirSync(release, { recursive: true });
const html = `ThreadPack-${version}.html`;
const cli = `threadpack-${version}.mjs`;
copyFileSync(join(root, 'dist/index.html'), join(release, html));
copyFileSync(join(root, 'dist-cli/threadpack.mjs'), join(release, cli));
const archive = `ThreadPack-${version}-source.zip`;
execFileSync('git', ['archive', '--format=zip', `--prefix=ThreadPack-${version}/`, '-o', join(release, archive), 'HEAD'], { cwd: root });
const checksums = [html, cli, archive].map(name => `${createHash('sha256').update(readFileSync(join(release, name))).digest('hex')}  ${name}`).join('\n') + '\n';
writeFileSync(join(release, 'SHA256SUMS.txt'), checksums);
console.log(`Prepared ThreadPack ${version}: offline HTML, standalone CLI, source archive, and SHA-256 checksums.`);
