import {
  randomBytes
} from 'node:crypto';
import {
  read,
  write,
  file,
  assert,
  now,
  actor
} from './util.mjs';
export function propose(root, cfg, input) {
  assert(cfg.requests.kinds.includes(input.kind), 'request_kind_unknown', 'Request kind is not allowed');
  assert(typeof input.subject_id === 'string' && input.subject_id.length && typeof input.reason === 'string',
    'input_invalid', 'Request requires subject and reason');
  const rows = read(file(root, 'host/requests/requests.json')),
    duplicate = rows.find(r => r.subject_id === input.subject_id && r.kind === input.kind && ['proposed',
      'accepted'
    ].includes(r.status));
  if (duplicate) return {
    duplicate: true,
    request: duplicate
  };
  assert(rows.filter(r => r.subject_id === input.subject_id && r.status === 'proposed').length < cfg.requests
    .max_open_proposed_per_subject, 'request_limit', 'Too many proposed requests');
  const at = now(),
    request = {
      id: randomBytes(16).toString('hex'),
      kind: input.kind,
      subject_id: input.subject_id,
      reason: input.reason.slice(0, cfg.requests.reason_max_chars),
      status: 'proposed',
      created_at: at,
      created_by: actor(),
      updated_at: at,
      note: ''
    };
  rows.push(request);
  write(file(root, 'host/requests/requests.json'), rows);
  return {
    duplicate: false,
    request
  };
}
export function setRequest(root, input) {
  assert(/^[0-9a-f]{32}$/.test(input.id), 'invalid_id', 'Expected request ID');
  const rows = read(file(root, 'host/requests/requests.json')),
    row = rows.find(r => r.id === input.id);
  assert(row, 'request_unknown', 'Request does not exist');
  assert(({
      proposed: ['accepted', 'rejected', 'cancelled'],
      accepted: ['fulfilled', 'cancelled']
    })[row.status]?.includes(input.status), 'request_transition_invalid',
    'Request transition is not allowed');
  row.status = input.status;
  row.note = String(input.note ?? '');
  row.updated_at = now();
  write(file(root, 'host/requests/requests.json'), rows);
  return {
    request: row
  };
}
