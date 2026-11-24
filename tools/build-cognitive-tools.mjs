// Keep dependency-free stdio JSON tool schemas equal to the remote Zod contracts.
import fs from 'node:fs';
import {z} from 'zod';
import {remoteToolSchemas,descriptions} from '../lib/remote-tools.mjs';
import {cognitiveCommands} from '../lib/cognitive.mjs';
const tools=Object.entries(cognitiveCommands).map(([op,remote])=>({name:'chelm_cognitive_'+op,description:descriptions[remote]+' Cognitive-task binding v1.',inputSchema:z.toJSONSchema(remoteToolSchemas[remote],{target:'draft-7'})}));
fs.writeFileSync(new URL('../schemas/cognitive-worker-tools.json',import.meta.url),JSON.stringify(tools,null,2)+'\n');
