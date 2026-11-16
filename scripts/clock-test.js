import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
// Month end, new year, a leap day and a far year in Japan time. Pass other ISO timestamps as arguments.
const clocks=process.argv.length>2?process.argv.slice(2):['2026-12-31T23:30:00+09:00','2027-01-01T00:10:00+09:00','2028-02-29T12:00:00+09:00','2030-06-01T00:00:00+09:00'];
const files=readdirSync('test').filter(f=>f.endsWith('.test.js')).map(f=>`test/${f}`);
for(const clock of clocks){
  if(!Number.isFinite(Date.parse(clock)))throw new Error(`Invalid clock: ${clock}`);
  console.log(`# clock ${clock}`);
  const result=spawnSync(process.execPath,['--import','./test/helpers/shift-clock.js','--test','--test-reporter=dot',...files],{stdio:'inherit',shell:false,env:{...process.env,ASTRAL_TEST_CLOCK:clock}});
  if(result.status!==0)process.exit(result.status||1);
}
console.log(`All tests passed at ${clocks.length} shifted clocks.`);
