import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const file of ['index.js',...readdirSync('src').filter(f=>f.endsWith('.js')).map(f=>`src/${f}`)]) {
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status || 1);
}
console.log('All JavaScript syntax checks passed.');
