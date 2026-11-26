import fs from 'node:fs';
import {file,git} from './util.mjs';

// Harness >=0.13.1 keeps this empty inode for OS locking; never unlink or archive it.
export const indexerLock='.golem-indexer.lock';
export function emptyIndexerLock(instance) {
  const p=file(instance,indexerLock);
  if(!fs.existsSync(p))return false;
  const s=fs.lstatSync(p);
  return s.isFile()&&s.nlink===1&&s.size===0;
}
export function instanceDrafts(instance) {
  return git(instance,['status','--porcelain=v1','-z','--untracked-files=all']).split('\0')
    .filter(row=>row&&!(row==='?? '+indexerLock&&emptyIndexerLock(instance)));
}
