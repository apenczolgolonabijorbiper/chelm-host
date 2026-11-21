// Vocabulary validation from golem14-harness 0.10.0 (Apache-2.0).
// Declarative policies only: no evaluated source content, hooks or normalizers.
const slug = /^[a-z][a-z0-9_-]{1,40}$/,
  predicate = /^[a-z][a-z0-9_]{1,80}$/;
function object(value, allowed, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw Error('Invalid ' + label);
}
export function validateVocabulary(v) {
  object(
    v,
    ['schema_version', 'kinds', 'predicates', 'single_valued', 'external_id_schemes'],
    'profile vocabulary'
  );
  if (v.schema_version !== 2) throw Error('Invalid vocabulary version: expected 2');
  for (const key of ['kinds', 'predicates', 'single_valued'])
    if (v[key] !== undefined) {
      const xs = v[key],
        pattern = key === 'kinds' ? slug : predicate;
      if (
        !Array.isArray(xs) ||
        xs.length > 500 ||
        xs.some((x) => typeof x !== 'string' || !pattern.test(x)) ||
        new Set(xs).size !== xs.length
      )
        throw Error('Invalid vocabulary ' + key);
    }
  if (v.single_valued?.some((x) => v.predicates && !v.predicates.includes(x)))
    throw Error('Single-valued predicate outside vocabulary');
  if (v.external_id_schemes !== undefined) {
    if (!Array.isArray(v.external_id_schemes) || v.external_id_schemes.length > 100)
      throw Error('Invalid external identifier schemes');
    const seen = new Set();
    for (const s of v.external_id_schemes) {
      object(s, ['scheme', 'prefixes'], 'external identifier scheme');
      if (typeof s.scheme !== 'string' || !slug.test(s.scheme) || seen.has(s.scheme))
        throw Error('Invalid/duplicate external identifier scheme');
      seen.add(s.scheme);
      if (
        s.prefixes !== undefined &&
        (!Array.isArray(s.prefixes) ||
          s.prefixes.length > 20 ||
          new Set(s.prefixes).size !== s.prefixes.length ||
          s.prefixes.some((p) => typeof p !== 'string' || !p || p.length > 100 || /\s/.test(p)))
      )
        throw Error('Invalid identifier prefixes');
    }
  }
}
