import {readFileSync} from 'node:fs';
const english=JSON.parse(readFileSync(new URL('../dictionaries/english.json',import.meta.url),'utf8'));
const common={astral:'アストラル',discord:'ディスコード',voicevox:'ボイスボックス',trpg:'ティーアールピージー',vc:'ブイシー'};
export function readingFor(name,words=[]) {
  const exact=words.find(w=>w.surface.toLocaleLowerCase()===name.toLocaleLowerCase());
  if(exact)return exact.reading;
  return name.replace(/[A-Za-z]+/g,word=>{
    const lookup=part=>{
      const key=part.toLowerCase();
      return words.find(w=>w.surface.toLowerCase()===key)?.reading ??
        (Object.hasOwn(common,key)?common[key]:undefined) ??
        (Object.hasOwn(english,key)?english[key]:undefined);
    };
    const direct=lookup(word);if(direct)return direct;
    // Split CamelCase only when the complete name has no dictionary entry.
    return word.replace(/([a-z])([A-Z])/g,'$1 $2').split(' ').map(part=>lookup(part)??part).join(' ');
  }).slice(0,60);
}
