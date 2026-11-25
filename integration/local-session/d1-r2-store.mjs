// Optional Cloudflare/Sites binding. The coordinator itself has no product dependency.
import {digest,SessionError} from '../../lib/durable-session.mjs';
export class D1R2SessionStore{
  constructor(db,bucket){this.db=db;this.bucket=bucket;}
  async readState(id){const r=await this.db.withSession('first-primary').prepare('SELECT value FROM chelm_sessions WHERE runtime_id = ?').bind(id).first();return r?JSON.parse(r.value):null;}
  async compareAndSwap(id,expected,next){
    const db=this.db.withSession('first-primary');
    const r=expected===null
      ?await db.prepare('INSERT INTO chelm_sessions (runtime_id, version, value) VALUES (?, ?, ?) ON CONFLICT(runtime_id) DO NOTHING').bind(id,next.version,JSON.stringify(next)).run()
      :await db.prepare('UPDATE chelm_sessions SET version = ?, value = ? WHERE runtime_id = ? AND version = ?').bind(next.version,JSON.stringify(next),id,expected).run();
    return r.meta.changes===1;
  }
  async putImmutable(key,bytes){
    const r=await this.bucket.put('checkpoints/'+key,bytes,{onlyIf:{etagDoesNotMatch:'*'}});
    if(!r){const old=await this.getObject(key);if(!old||await digest(old)!==await digest(bytes))throw new SessionError('object_conflict','Immutable checkpoint differs');}
  }
  async getObject(key){const v=await this.bucket.get('checkpoints/'+key);return v?new Uint8Array(await v.arrayBuffer()):null;}
  async deleteObject(key){await this.bucket.delete('checkpoints/'+key);}
}
