import test from 'node:test';
import assert from 'node:assert/strict';
import {unsafeCode} from '../scripts/security.js';

test('source policy rejects direct, aliased and computed string-code execution',()=>{
  for(const code of ['eval(input)','const run=eval;run(input)','new Function(input)','globalThis["eval"](input)','globalThis.Function(input)','import vm from "node:vm"','import(input)'])assert.ok(unsafeCode(code).length,code);
});
test('source policy rejects shell execution but allows fixed argument subprocesses',()=>{
  for(const code of ['import {exec} from "node:child_process"','spawn(file,args,{shell:true})','spawn(file,args,{shell:enabled})'])assert.ok(unsafeCode(code).length,code);
  assert.deepEqual(unsafeCode('spawn(python,[script],{shell:false});'),[]);
});
test('code-like user data and comments are not treated as executable code',()=>{
  assert.deepEqual(unsafeCode('// eval(input)\nconst name="new Function(input)";JSON.parse(name);'),[]);
});
