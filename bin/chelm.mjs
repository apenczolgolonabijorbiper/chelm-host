#!/usr/bin/env node

import fs from 'node:fs';
import {
  pathToFileURL
} from 'node:url';
import {
  execute
} from '../lib/app.mjs';
import {
  ChelmError
} from '../lib/util.mjs';
export function parse(argv) {
  const words = [],
    options = {},
    flags = new Set(['sandbox', 'hard', 'deep', 'all-ready', 'rows']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (!flags.has(key) && !['runtime', 'input', 'harness', 'label', 'instance-path', 'purpose', 'profile',
          'python', 'instance', 'subject-header', 'conversation', 'intake-stores', 'requests', 'scope',
          'subject', 'kinds', 'filter', 'id', 'status', 'note', 'package'
        ].includes(key)) throw new ChelmError('usage', 'Unknown option: ' + key, {}, 2);
      if (Object.hasOwn(options, key)) throw new ChelmError('usage', 'Duplicate option: ' + key, {}, 2);
      if (flags.has(key)) options[key] = true;
      else {
        if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new ChelmError('usage',
          'Missing option value: ' + key, {}, 2);
        options[key] = argv[++i];
      }
    } else words.push(arg);
  }
  if (words.length < 1) throw new ChelmError('usage', 'Expected a command', {}, 2);
  options._rest = words.slice(2);
  return {
    command: words[0],
    sub: words[1],
    options
  };
}
export async function run(argv) {
  try {
    const {
      command,
      sub,
      options
    } = parse(argv);
    let input = {};
    if (options.input) {
      try {
        input = JSON.parse(fs.readFileSync(options.input === '-' ? 0 : options.input, 'utf8'));
      } catch {
        throw new ChelmError('usage', 'Input must be a JSON object', {}, 2);
      }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ChelmError('usage',
      'Input must be a JSON object', {}, 2);
    const result = await execute(command, sub, options, input);
    return {
      exit: 0,
      value: {
        ok: true,
        messages: [],
        ...result
      }
    };
  } catch (e) {
    return {
      exit: e instanceof ChelmError ? e.exit : 3,
      value: {
        ok: false,
        messages: [],
        error: {
          code: e.code ?? 'internal_error',
          message: e.message,
          details: e.details ?? {}
        }
      }
    };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result.value) + '\n');
  process.exitCode = result.exit;
}
