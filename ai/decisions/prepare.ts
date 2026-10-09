import { writeFile } from 'node:fs/promises';
import { hash, prepareCases } from './cases';

const directory = '.data/openai-decisions-evals';
const cases = await prepareCases(directory);
const result = { version: 1, hash: hash(cases), cases };
await writeFile(`${directory}/cases-v1.json`, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ hash: result.hash, cases: cases.length, development: cases.filter(item => item.split === 'development').length,
  validation: cases.filter(item => item.split === 'validation').length }));
