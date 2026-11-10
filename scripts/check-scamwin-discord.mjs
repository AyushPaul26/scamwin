import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const command=JSON.parse(await readFile(new URL('../docs/scamwin-discord-command.example.json',import.meta.url),'utf8'));
assert.deepEqual(command,{name:'Check with Scamwin',type:3,integration_types:[1],contexts:[0,1,2]});
if(process.argv.includes('--print-command'))console.log(JSON.stringify(command,null,2));
else console.log('Discord offline template valid: user-installed message command; Manual only. No provider account, OAuth, command registration, endpoint delivery or live pilot has been tested.');
