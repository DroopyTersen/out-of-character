import { $ } from 'bun';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Proves interview-engine/ compiles on its own: copies it into an empty directory with only its four allowed
 * dependencies (at this repo's versions) and the engine tsconfig, installs, and type-checks there.
 */
const repo = resolve(import.meta.dir, '..');
const manifest = await Bun.file(join(repo, 'package.json')).json() as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
const packages = ['ai', '@ai-sdk/azure', '@ai-sdk/typesafe-ai', 'zod'];

const scratch = await mkdtemp(join(tmpdir(), 'interview-engine-copy-'));
let status = 1;
try {
  await cp(join(repo, 'interview-engine'), join(scratch, 'interview-engine'), { recursive: true });
  await Bun.write(join(scratch, 'tsconfig.engine.json'), Bun.file(join(repo, 'tsconfig.engine.json')));
  await Bun.write(join(scratch, 'package.json'), JSON.stringify({
    name: 'interview-engine-copy-check', private: true, type: 'module',
    dependencies: Object.fromEntries(packages.map(name => {
      const version = manifest.dependencies[name];
      if (!version) throw new Error(`package.json does not list ${name}.`);
      return [name, version];
    })),
    devDependencies: { typescript: manifest.devDependencies.typescript },
  }, null, 2));
  const install = await $`bun install --silent`.cwd(scratch).nothrow();
  if (install.exitCode) {
    console.error('Engine copy check could not install its dependencies.');
    status = install.exitCode;
  } else {
    const tsc = await $`./node_modules/.bin/tsc -p tsconfig.engine.json --noEmit`.cwd(scratch).nothrow();
    status = tsc.exitCode;
    console.log(status ? 'Engine copy check failed: the copied folder does not type-check alone.' : 'Engine copy check passed.');
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
process.exit(status);
