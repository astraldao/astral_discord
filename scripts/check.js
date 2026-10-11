import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {unsafeCode} from './security.js';
for(const file of ['index.js',...['src','scripts'].flatMap(dir=>readdirSync(dir).filter(f=>f.endsWith('.js')).map(f=>`${dir}/${f}`))]) {
  const problems=unsafeCode(readFileSync(file,'utf8'),file);
  if(problems.length){console.error(problems.join('\n'));process.exit(1);}
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status || 1);
}
console.log('All JavaScript syntax and code execution policy checks passed.');
