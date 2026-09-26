import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const database = 'SIMULATOR_ARCHIVE';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const usage = 'Usage: bun scripts/simulator-transcripts.ts list [--local] | export <attempt-uuid> [--local]';

export function parseArgs(args: string[]) {
  const local = args.at(-1) === '--local';
  const values = local ? args.slice(0, -1) : args;
  if (values.length === 1 && values[0] === 'list') return { action: 'list' as const, local };
  if (values.length === 2 && values[0] === 'export' && uuid.test(values[1]!)) {
    return { action: 'export' as const, id: values[1]!.toLowerCase(), local };
  }
  throw new Error(usage);
}

export function parseRows(output: string): Record<string, unknown>[] {
  const statements: unknown = JSON.parse(output);
  if (!Array.isArray(statements) || statements.length !== 1) throw new Error('Unexpected Wrangler D1 result.');
  const result = statements[0] as { success?: unknown; results?: unknown } | undefined;
  if (!result || result.success !== true || !Array.isArray(result.results)) throw new Error('Wrangler D1 query failed.');
  return result.results;
}

export function parseArchive(row: Record<string, unknown>) {
  const {
    id, scenario_id, client_id, started_at, updated_at, ended_at,
    archive_state, session_status, finalization, feedback_status, usage_seconds, message,
    transcript_json, evaluation_json, provenance_json, cues_json,
  } = row;
  if (typeof id !== 'string' || !uuid.test(id) || typeof transcript_json !== 'string' ||
      typeof provenance_json !== 'string' || typeof cues_json !== 'string') {
    throw new Error('Archive row is incomplete.');
  }
  return {
    id, scenario_id, client_id, started_at, updated_at, ended_at,
    archive_state, session_status, finalization, feedback_status, usage_seconds, message,
    transcript: JSON.parse(transcript_json),
    evaluation: typeof evaluation_json === 'string' ? JSON.parse(evaluation_json) : null,
    provenance: JSON.parse(provenance_json),
    cues: JSON.parse(cues_json),
  };
}

async function query(sql: string, local: boolean) {
  const process = Bun.spawn([
    'bunx', 'wrangler', 'd1', 'execute', database, local ? '--local' : '--remote',
    '--json', '--command', sql,
  ], { cwd: root, stdout: 'pipe', stderr: 'inherit' });
  const [stdout, exitCode] = await Promise.all([new Response(process.stdout).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`Wrangler query failed (exit ${exitCode}). Check Cloudflare authentication and the D1 binding.`);
  return parseRows(stdout);
}

async function main(args: string[]) {
  const command = parseArgs(args);
  if (command.action === 'list') {
    const rows = await query(`SELECT id, scenario_id, client_id, started_at, updated_at, ended_at,
      archive_state, session_status, finalization, feedback_status, usage_seconds
      FROM simulator_attempts ORDER BY updated_at DESC LIMIT 20`, command.local);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  // The only interpolated value is a validated UUID; Wrangler has no bind flag.
  const rows = await query(`SELECT * FROM simulator_attempts WHERE id = '${command.id}' LIMIT 1`, command.local);
  if (rows.length !== 1 || rows[0]?.id !== command.id) throw new Error(`Archive attempt ${command.id} was not found.`);
  const archive = parseArchive(rows[0]);
  const destination = resolve(root, 'output', `simulator-transcript-${command.id}.json`);
  await mkdir(resolve(root, 'output'), { recursive: true });
  await writeFile(destination, JSON.stringify(archive, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${destination}`);
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : 'Transcript review failed.');
    process.exitCode = 1;
  });
}
