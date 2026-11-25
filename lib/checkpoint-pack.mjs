// Bound expanded Git bundle data before Git imports any untrusted compressed objects.
import {inflateSync} from 'node:zlib';
import {assert} from './util.mjs';
export function checkBundle(bytes){
  const boundary=bytes.indexOf('\n\n');
  assert(boundary>0&&boundary<=65536&&bytes.subarray(0,16).toString()==='# v2 git bundle\n','checkpoint_history','Expected a complete SHA-1 bundle v2');
  const lines=bytes.subarray(16,boundary).toString('utf8').split('\n');
  assert(lines.length<=101&&lines.every(s=>/^[a-f0-9]{40} (?:HEAD|refs\/(?:heads|tags)\/[A-Za-z0-9_./-]+)$/.test(s)),'checkpoint_history','Bundle must contain complete allowlisted local refs');
  let offset=boundary+2;
  assert(offset+12<=bytes.length-20,'checkpoint_history','Truncated Git pack header');
  assert(bytes.subarray(offset,offset+4).toString()==='PACK'&&bytes.readUInt32BE(offset+4)===2,'checkpoint_history','Unsupported/truncated Git pack');
  const count=bytes.readUInt32BE(offset+8);offset+=12;
  assert(count>0&&count<=100000,'capacity_exceeded','Git object count exceeds checkpoint budget');
  let total=0;
  for(let i=0;i<count;i++){
    assert(offset<bytes.length-20,'checkpoint_history','Truncated Git object');
    let b=bytes[offset++],size=b&15,shift=4;const type=(b>>4)&7;
    assert([1,2,3,4,6,7].includes(type),'checkpoint_history','Invalid Git object type');
    while(b&128){assert(offset<bytes.length-20&&shift<=32,'checkpoint_history','Invalid Git object size');b=bytes[offset++];size+=(b&127)*2**shift;shift+=7;}
    assert(size<=64*1024*1024,'capacity_exceeded','Expanded Git object exceeds 64 MiB');
    if(type===6){let n=0;do{assert(offset<bytes.length-20&&n++<10,'checkpoint_history','Invalid delta offset');b=bytes[offset++];}while(b&128);}
    if(type===7)offset+=20;
    assert(offset<bytes.length-20,'checkpoint_history','Truncated Git delta');
    let inflated;try{inflated=inflateSync(bytes.subarray(offset),{maxOutputLength:Math.max(size,1),info:true});}catch{assert(false,'checkpoint_history','Corrupt or oversized compressed Git object');}
    const body=inflated.buffer;assert(body.length===size&&inflated.engine.bytesWritten>0,'checkpoint_history','Invalid Git object expansion');offset+=inflated.engine.bytesWritten;
    let expanded=size;
    if([6,7].includes(type)){
      let at=0;
      const integer=()=>{let value=0,shift=0,b;do{assert(at<body.length&&shift<=32,'checkpoint_history','Invalid delta size');b=body[at++];value+=(b&127)*2**shift;shift+=7;}while(b&128);return value;};
      const base=integer();expanded=integer();assert(base<=64*1024*1024&&expanded<=64*1024*1024,'capacity_exceeded','Expanded delta exceeds budget');
    }
    total+=expanded;assert(total<=512*1024*1024,'capacity_exceeded','Expanded bundle exceeds 512 MiB');
  }
  assert(offset===bytes.length-20,'checkpoint_history','Pack inventory/trailer differs');
  return {objects:count,expanded_bytes:total};
}
