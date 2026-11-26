// Runs all ActoMind unit/integration tests: `node tests/run.mjs [filter]`
import { run } from './harness.mjs';
import './core.test.mjs';
import './audio.test.mjs';
import './app.test.mjs';
import './server.test.mjs';

const failed = await run(process.argv[2]);
process.exit(failed ? 1 : 0);
