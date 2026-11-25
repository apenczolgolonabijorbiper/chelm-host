import nodeTest from 'node:test';

// Node's CLI timeout also caps the whole test file. Keep the individual case
// budget here so a file containing many healthy cases can exceed three minutes.
export default function test(name, options, fn) {
  if(typeof options==='function')return nodeTest(name,{timeout:180000},options);
  return nodeTest(name,{timeout:180000,...options},fn);
}
