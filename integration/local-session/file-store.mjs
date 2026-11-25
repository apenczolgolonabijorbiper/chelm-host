// Private standalone reference store. For shared/serverless storage use a real CAS adapter.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeAbs,hash,assert} from '../../lib/util.mjs';
export class FileSessionStore{
  constructor(root){this.root=safeAbs(root);fs.mkdirSync(this.root,{recursive:true,mode:0o700});}
  statePath(id){assert(/^[a-f0-9-]{36}$/.test(id),'unsafe_path','Invalid runtime identity');return path.join(this.root,id+'.json');}
  objectPath(key){assert(/^[a-f0-9-]{36}\/[1-9][0-9]*\/[a-f0-9]{64}$/.test(key),'unsafe_path','Invalid object identity');return safeAbs(path.join(this.root,'objects',...key.split('/')));}
  async readState(id){const p=this.statePath(id);if(!fs.existsSync(p))return null;assert(fs.statSync(p).size<=4*1024*1024,'capacity_exceeded','Coordinator state too large');return JSON.parse(fs.readFileSync(p));}
  async compareAndSwap(id,expected,next){
    const p=this.statePath(id),mutex=p+'.cas';
    try{fs.mkdirSync(mutex);}catch(e){if(e.code==='EEXIST')return false;throw e;}
    const temporary=p+'.tmp-'+randomUUID();
    try{
      for(const name of fs.readdirSync(this.root))if(name.startsWith(path.basename(p)+'.tmp-'))fs.rmSync(path.join(this.root,name),{force:true});
      const old=await this.readState(id);if((old?.version??null)!==expected)return false;
      const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temporary,p);return true;
    }finally{fs.rmSync(temporary,{force:true});fs.rmdirSync(mutex);}
  }
  async putImmutable(key,bytes){
    const p=this.objectPath(key);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});
    const temporary=p+'.tmp-'+randomUUID(),fd=fs.openSync(temporary,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{fs.linkSync(temporary,p);}catch(e){if(e.code!=='EEXIST')throw e;assert(hash(fs.readFileSync(p))===hash(bytes),'object_conflict','Immutable object already has different bytes');}
    finally{fs.rmSync(temporary,{force:true});}
  }
  async getObject(key){const p=this.objectPath(key);return fs.existsSync(p)?fs.readFileSync(p):null;}
  async deleteObject(key){const p=this.objectPath(key);fs.rmSync(p,{force:true});const dir=path.dirname(p);if(fs.existsSync(dir))for(const n of fs.readdirSync(dir))if(n.startsWith(path.basename(p)+'.tmp-'))fs.rmSync(path.join(dir,n),{force:true});}
}
