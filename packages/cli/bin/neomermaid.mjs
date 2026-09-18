#!/usr/bin/env node
// Thin launcher so the CLI works from a git checkout, a global install, or npx.
import { run } from '../dist/index.js';

const code = await run(process.argv.slice(2));
process.exit(code);
