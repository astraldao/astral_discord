import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';
process.chdir(dirname(fileURLToPath(import.meta.url)));
const env=resolve('.env');if(existsSync(env)) loadEnvFile(env);
await import('./src/index.js');
