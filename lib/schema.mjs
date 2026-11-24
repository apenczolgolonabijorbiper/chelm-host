import {
  assert
} from './util.mjs';
// The published schemas use this deliberately small, dependency-free vocabulary.
export function validateShape(value, schema, at = '$') {
  const errors = [];
  const add = message => errors.push(at + ': ' + message);
  if (schema.const !== undefined && value !== schema.const) add('unexpected constant');
  if (schema.enum && !schema.enum.includes(value)) add('unexpected enum value');
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const match = types.some(t => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t ===
      'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ?
      Number.isInteger(value) : typeof value === t);
    if (!match) {
      add('expected ' + types.join('|'));
      return errors;
    }
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) add(
    'pattern mismatch');
  if (typeof value === 'string') {
    if(schema.minLength!==undefined&&value.length<schema.minLength)add('string too short');
    if(schema.maxLength!==undefined&&value.length>schema.maxLength)add('string too long');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) add('below minimum');
    if (schema.maximum !== undefined && value > schema.maximum) add('above maximum');
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) add(
      'below exclusive minimum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add('too few items');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add('too many items');
    if (schema.items) value.forEach((v, i) => errors.push(...validateShape(v, schema.items, at + '[' + i +
      ']')));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(value, key)) add('missing ' + key);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, k)) errors.push(...validateShape(v, schema
        .properties[k], at + '.' + k));
      else if (schema.additionalProperties === false) add('unknown ' + k);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...
        validateShape(v, schema.additionalProperties, at + '.' + k));
    }
  }
  return errors;
}
