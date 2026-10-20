import test from 'node:test';
import assert from 'node:assert/strict';
import {panelMessageId} from '../src/trpg-repair.js';
const guild='123456789012345670',channel='123456789012345671',message='123456789012345672',link=`https://discord.com/channels/${guild}/${channel}/${message}`;
test('panel recovery accepts a message link in its exact guild and reserved channel or an existing numeric ID',()=>{
  for(const input of [link,link+'/',` ${link} `,message,` ${message} `])assert.equal(panelMessageId(input,guild,channel),message);
  assert.equal(panelMessageId('12345678901234567',guild,channel),'12345678901234567');assert.equal(panelMessageId('12345678901234567890',guild,channel),'12345678901234567890');
});
test('panel recovery refuses foreign contexts and malformed or credential-bearing links without reflecting input',()=>{
  const invalid=['','123',message+'000',link.replace(guild,'123456789012345673'),link.replace(channel,'123456789012345674'),link.replace('https:','http:'),link.replace('discord.com','discord.com.evil.example'),link.replace('discord.com','discord.com:444'),link.replace('discord.com','private:credential@discord.com'),link+'?secret=PRIVATE',link+'#PRIVATE',link+'/extra',link.replace('/channels/','/other/'),link.replace(guild,'@me'),link.replace('/'+message,''),link.replace('/'+message,'/%31'+message.slice(1)),link+'a'.repeat(201)];
  for(const input of invalid)assert.throws(()=>panelMessageId(input,guild,channel),error=>!error.message.includes('PRIVATE')&&!error.message.includes('credential'));
});
