import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Keeps interview-engine/ portable: nothing in it may reach this app, Cloudflare, Bun or Node, and the two phases
 * never import each other. Test files may additionally import bun:test, the only exception.
 */
export const ALLOWED_PACKAGES = ['ai', '@ai-sdk/azure', '@ai-sdk/typesafe-ai', 'zod'];
const FORBIDDEN_PREFIXES = ['~/', '@/', 'bun:', 'node:', 'virtual:'];
const FORBIDDEN_PACKAGES = ['cloudflare:workers', 'react-router', 'react', 'react-dom'];
const TEST_ONLY = 'bun:test';
const FORBIDDEN_WORDS = /\b(?:Env|D1Database|DurableObject|DurableObjectState|ExecutionContext)\b/g;
// Static imports and re-exports (`import x from`, `import 'x'`, `export * from`) and dynamic `import('x')`.
const SPECIFIER = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export type Violation = { file: string; line: number; text: string; reason: string };

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;
const packageName = (specifier: string) => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
const phase = (path: string) => path.split('/')[0];

function specifierProblem(specifier: string, file: string, root: string): string | null {
  if (specifier === TEST_ONLY && file.endsWith('.test.ts')) return null;
  if (specifier.startsWith('.')) {
    const target = relative(root, resolve(root, dirname(file), specifier)).split(sep).join('/');
    if (target === '..' || target.startsWith('../')) return 'relative import leaves interview-engine/';
    const from = phase(file), to = phase(target);
    if ((from === 'client' || from === 'shared') && /\.server(?:\.ts)?$/.test(target)) return `${from}/ imports a server file`;
    if ((from === 'narrative' && to === 'interview') || (from === 'interview' && to === 'narrative')) return 'the Interview and Narrative phases import each other';
    return null;
  }
  if (FORBIDDEN_PREFIXES.some(prefix => specifier.startsWith(prefix))) return 'platform or app import';
  if (FORBIDDEN_PACKAGES.includes(packageName(specifier))) return 'platform or app import';
  if (!ALLOWED_PACKAGES.includes(packageName(specifier))) return 'package not in the allow list';
  return null;
}

/** Checks every file under root; returns the violations, empty when the folder is portable. */
export async function checkEngine(root: string): Promise<{ violations: Violation[]; files: number }> {
  const violations: Violation[] = [];
  let files = 0;
  for await (const file of new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true })) {
    const path = file.split(sep).join('/');
    const source = await Bun.file(join(root, file)).text();
    files++;
    const lines = source.split('\n');
    for (const match of source.matchAll(FORBIDDEN_WORDS)) {
      const line = lineAt(source, match.index);
      violations.push({ file: path, line, text: lines[line - 1]!.trim(), reason: `platform identifier ${match[0]}` });
    }
    if (!path.endsWith('.ts')) continue;
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2]!;
      const reason = specifierProblem(specifier, path, root);
      if (!reason) continue;
      const line = lineAt(source, match.index);
      violations.push({ file: path, line, text: lines[line - 1]!.trim(), reason: `${reason}: ${specifier}` });
    }
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { violations, files };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '../interview-engine');
  const { violations, files } = await checkEngine(root);
  for (const item of violations) console.error(`interview-engine/${item.file}:${item.line}  ${item.reason}\n    ${item.text}`);
  if (violations.length) {
    console.error(`Engine boundary check failed: ${violations.length} violation${violations.length === 1 ? '' : 's'}.`);
    process.exit(1);
  }
  console.log(`Engine boundary check passed for ${files} files.`);
}
