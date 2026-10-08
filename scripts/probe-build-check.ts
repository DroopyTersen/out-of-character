// Compile probes without executing their browser, database or paid provider calls.
const entrypoints = [...new Bun.Glob('scripts/*.{mjs,ts}').scanSync('.')];
// These absolute imports run inside page.evaluate and are served by Vite in the browser.
const result = await Bun.build({ entrypoints, target: 'bun', packages: 'external', external: ['/interview-engine/*', '/app/*'], write: false });
if (!result.success) throw new AggregateError(result.logs, 'Probe compilation failed.');
console.log(`Probe compilation passed for ${entrypoints.length} scripts (no calls executed).`);
