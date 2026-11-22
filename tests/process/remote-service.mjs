import fs from 'node:fs';
import { startServer } from '../../lib/remote-server.mjs';
const server = await startServer(JSON.parse(fs.readFileSync(process.argv[2])));
process.send({ port: server.address().port });
