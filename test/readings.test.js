import test from 'node:test';
import assert from 'node:assert/strict';
import {readingFor} from '../src/readings.js';
import {announcementText} from '../src/speech.js';
import {validateSettings} from '../src/settings.js';
test('English dictionary handles case, mixed names and CamelCase',()=>{
  assert.equal(readingFor('Hello'),'ハロー');
  assert.equal(readingFor('ASTRAL'),'アストラル');
  assert.equal(readingFor('日本Hello'),'日本ハロー');
  assert.equal(readingFor('HelloDiscord'),'ハロー ディスコード');
  assert.equal(readingFor('zzqqxx'),'zzqqxx');
});
test('custom whole-name readings take precedence over automatic dictionaries',()=>{
  assert.equal(announcementText('小鳥遊',[{surface:'小鳥遊',reading:'タカナシ'}]),'タカナシさんが、まもなく参加するのだ。');
  assert.equal(readingFor('ASTRAL',[{surface:'Astral',reading:'アストラ'}]),'アストラ');
});
test('settings migrate without reading loss and reject invalid pronunciation dictionaries',()=>{
  const c={version:1,lobbyId:null,targetIds:[],seconds:5,voice:true,enforce:true};
  assert.deepEqual(validateSettings(c).words,[]);
  c.words=[{surface:'name',reading:'ネーム'}];assert.doesNotThrow(()=>validateSettings(c));
  c.words.push({surface:'NAME',reading:'ネーム'});assert.throws(()=>validateSettings(c));
  c.words=[{surface:'name',reading:'https://invalid'}];assert.throws(()=>validateSettings(c));
});
