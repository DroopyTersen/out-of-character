import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEngine } from './engine-boundary-check';

async function engine(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'engine-boundary-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await Bun.write(join(root, path), content);
  }
  try { return (await checkEngine(root)).violations.map(item => `${item.file}:${item.line} ${item.reason}`); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('a portable folder passes', async () => {
  expect(await engine({
    'shared/spec.ts': "import { z } from 'zod';\nimport type { Passage } from './transcript';\nexport * from './snapshot';",
    'session/run.server.ts': "import { streamText } from 'ai';\nimport { x } from '../providers/judgeProvider.server';\nconst later = await import('@ai-sdk/azure/internal');",
    'judging/coverage.test.ts': "import { test } from 'bun:test';",
    'README.md': 'Hosted by a Durable Object per attempt.',
  })).toEqual([]);
});

test('app, platform and unlisted imports fail with their line', async () => {
  expect(await engine({
    'shared/a.ts': "import { x } from '../../core/interview';\nimport type { Y } from '~/server/thing';\nimport { DurableObject as D } from 'cloudflare:workers';",
    'shared/b.ts': "import { useState } from 'react';\nimport { readFile } from 'node:fs';\nimport { test } from 'bun:test';\nexport { thing } from 'lodash/fp';\nconst m = import('virtual:react-router/server-build');",
  })).toEqual([
    'shared/a.ts:1 relative import leaves interview-engine/: ../../core/interview',
    'shared/a.ts:2 platform or app import: ~/server/thing',
    'shared/a.ts:3 platform identifier DurableObject',
    'shared/a.ts:3 platform or app import: cloudflare:workers',
    'shared/b.ts:1 platform or app import: react',
    'shared/b.ts:2 platform or app import: node:fs',
    'shared/b.ts:3 platform or app import: bun:test',
    'shared/b.ts:4 package not in the allow list: lodash/fp',
    'shared/b.ts:5 platform or app import: virtual:react-router/server-build',
  ]);
});

test('browser folders cannot reach server files, and engine files cannot reach host reports', async () => {
  expect(await engine({
    'client/live.ts': "import { x } from '../providers/gptLive.server';",
    'shared/s.ts': "import type { X } from '../seams.server.ts';",
    'session/run.server.ts': "import { z } from '../../app/reports/reportWriter.server';\nexport type Host = { env: Env; db: D1Database; ctx: ExecutionContext; state: DurableObjectState };",
  })).toEqual([
    'client/live.ts:1 client/ imports a server file: ../providers/gptLive.server',
    'session/run.server.ts:1 relative import leaves interview-engine/: ../../app/reports/reportWriter.server',
    'session/run.server.ts:2 platform identifier Env',
    'session/run.server.ts:2 platform identifier D1Database',
    'session/run.server.ts:2 platform identifier ExecutionContext',
    'session/run.server.ts:2 platform identifier DurableObjectState',
    'shared/s.ts:1 shared/ imports a server file: ../seams.server.ts',
  ]);
});
