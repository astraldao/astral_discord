import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';
process.chdir(process.env.ASTRAL_DATA_ROOT || dirname(fileURLToPath(import.meta.url)));
const env=resolve('.env');if(existsSync(env)) loadEnvFile(env);
if(process.argv.includes('--worker'))await import('./src/index.js');
else {const {supervise}=await import('./scripts/supervisor.js');await supervise();}
