import test from 'node:test';
import assert from 'node:assert/strict';
import {InteractionLimits} from '../src/limits.js';

test('action bursts are limited per user and recover at one token per second',()=>{
  let now=0;const l=new InteractionLimits(()=>now);
  for(let i=0;i<5;i++)assert.equal(l.consume('a'),0);
  assert.equal(l.consume('a'),1);assert.equal(l.consume('b'),0);
  now=1000;assert.equal(l.consume('a'),0);assert.equal(l.consume('a'),1);
});
test('cancel-and-retry cannot reset the admission cooldown',()=>{
  let now=0;const l=new InteractionLimits(()=>now);
  assert.equal(l.consume('a',true),0);
  assert.equal(l.consume('a',true),15);
  // Cancellation never clears this independent reservation budget.
  now=14999;assert.equal(l.consume('a',true),1);
  now=15000;assert.equal(l.consume('a',true),0);
});
test('global action and entry limits contain multiple users',()=>{
  let now=0;const l=new InteractionLimits(()=>now);
  for(let i=0;i<30;i++)assert.equal(l.consume(`user${i}`),0);
  assert.equal(l.consume('other'),1);
  now=200;assert.equal(l.consume('other'),0);
  const entries=new InteractionLimits(()=>now);
  for(let i=0;i<4;i++)assert.equal(entries.consume(`user${i}`,true),0);
  assert.equal(entries.consume('other',true),3);
  now+=3000;assert.equal(entries.consume('other',true),0);
});
test('rejected reservations do not spend the general action budget',()=>{
  const l=new InteractionLimits(()=>0);
  assert.equal(l.consume('a',true),0);
  for(let i=0;i<100;i++)assert.equal(l.consume('a',true),15);
  for(let i=0;i<4;i++)assert.equal(l.consume('a'),0);
  assert.equal(l.consume('a'),1);
});
test('tracking memory is bounded and inactive entries are pruned',()=>{
  let now=0;const l=new InteractionLimits(()=>now);
  for(let i=0;i<1024;i++){now+=200;assert.equal(l.consume(`user${i}`),0);}
  assert.ok(l.users.size<=301);
  now+=60000;assert.equal(l.consume('new'),0);assert.equal(l.users.size,1);
});
