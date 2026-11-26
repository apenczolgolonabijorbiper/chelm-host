// Read-only checks for the shipped file-worker prompts; never execute sample calls.
import fs from 'node:fs';
import {z} from 'zod';

const id='00000000-0000-4000-8000-000000000001';
const work={work_id:id,attempt:1};
const outputs=[{slot_id:id,revision:1}];
const samples={
  chelm_list_work:{limit:1},
  chelm_request_work:{request_id:'discovery-only',executor:{id:'probe',kind:'agent',model:'unknown',host:'probe'},max:1},
  chelm_work_status:work,
  chelm_list_artifacts:{...work,observation_id:id,offset:0,limit:1},
  chelm_read_artifact:{...work,artifact_id:id,offset:0},
  chelm_context:{...work,filters:{entity:'example'}},
  chelm_renew_work:work,
  chelm_abandon_work:work,
  chelm_stage_output:{...work,slot_id:id,revision:1,offset:0,text:'example',final:true},
  chelm_validate_candidate:{...work,outputs},
  chelm_submit_candidate:{...work,outputs,candidate_digest:'0'.repeat(64),submission_id:'discovery-only'}
};

export async function inspectRemoteDiscovery(client){
  const tools=(await client.listTools()).tools;
  const prompts=(await client.listPrompts()).prompts;
  const incompatible_tools=[];
  for(const [name,args] of Object.entries(samples)){
    const tool=tools.find(t=>t.name===name);
    try{if(!tool||!z.fromJSONSchema(tool.inputSchema).safeParse(args).success)incompatible_tools.push(name);}
    catch{incompatible_tools.push(name);}
  }
  const once=fs.readFileSync(new URL('../prompts/remote-worker-once.sudo.md',import.meta.url),'utf8');
  const incompatible_prompts=[];
  for(const [name,file] of [['chelm_remote_once',null],['chelm_remote_loop','remote-worker-loop.sudo.md'],['chelm_remote_integration','remote-integration.sudo.md']]){
    if(!prompts.some(p=>p.name===name)){incompatible_prompts.push(name);continue;}
    const expected=once+(file?'\n'+fs.readFileSync(new URL('../prompts/'+file,import.meta.url),'utf8'):'');
    try{
      const actual=await client.getPrompt({name,arguments:{}});
      if(actual.messages.length!==1||actual.messages[0].role!=='user'||actual.messages[0].content.type!=='text'||actual.messages[0].content.text!==expected)incompatible_prompts.push(name);
    }catch{incompatible_prompts.push(name);}
  }
  return {pass:incompatible_tools.length===0&&incompatible_prompts.length===0,
    tool_count:tools.length,prompt_count:prompts.length,incompatible_tools,incompatible_prompts};
}
