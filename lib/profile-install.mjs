// Application source semantics are shared with harness 0.10.0.
import path from 'node:path';
import { readApplicationSource } from './application-source.mjs';
import { createAdapter } from './backend.mjs';
import { assert, fail } from './util.mjs';
export async function profileBundle(source) {
  assert(
    typeof source === 'string' && source.length,
    'usage',
    'Profile source directory is required',
    {},
    2
  );
  try {
    return await readApplicationSource(path.resolve(source));
  } catch (e) {
    fail('profile_invalid', 'Invalid reviewed application source: ' + e.message);
  }
}
const adapter = (cfg) =>
  createAdapter({
    instance: cfg.instance.path,
    harness: cfg.harness.root,
    node: cfg.harness.node,
    git: cfg.harness.git
  });
export async function checkProfile(cfg, source = cfg.profile_expectation?.source) {
  assert(source, 'usage', 'Specify --source or configure profile_expectation', {}, 2);
  try {
    const result = await adapter(cfg)['profile-status']({ source: path.resolve(source) });
    return {
      ...result,
      source_abs: path.resolve(source),
      matches: result.state === 'in-sync' && !result.recovery_required
    };
  } catch (e) {
    return {
      source_abs: path.resolve(source),
      matches: false,
      files: [],
      problems: [{ code: 'profile_invalid', message: e.message }]
    };
  }
}
export async function installProfile(root, cfg, source) {
  await profileBundle(source); // consistent safe refusal before the transaction
  try {
    const result = await adapter(cfg)['profile-install']({ source: path.resolve(source) });
    return {
      ...result,
      changed: result.status === 'installed',
      ...(await checkProfile(cfg, source))
    };
  } catch (e) {
    fail('profile_invalid', 'Reviewed application source installation refused: ' + e.message);
  }
}
