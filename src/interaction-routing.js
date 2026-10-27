import {menuGuideTopics} from './menu-catalog.js';
// A namespace selects a controller, never an authorization level. Each
// controller retains its own fresh permission, owner and session checks.
const definitions=[
  ['menu','mainMenu','handle'],['servers','serverNetwork','handle'],['read','backupReader','handle'],
  ['perf','speedMeasurements','handle'],['restart','restarts','handle'],['runtime','runtimeSettings','handle'],
  ['image','imageWorkshop','handle'],['banner','banner','handle'],['updates','versions','handle'],['admin','admin','handle'],
  ['densuke','densuke','handle'],['trpg','trpg','handle'],['profile','profile','handle'],['forum','forumTags','handle'],
  ['calendars','sharedSchedules','handle'],['schedule','schedule','handle'],
  ['bj','blackjack','handle'],['casino','casino','handle'],['rps','rps','handle'],['four','four','handle'],
  ['wallet','chipAccount','handle'],['chips','chipTools','handle'],['work','chipTools','handle'],['game','blackjack','handle'],
];
const namespaces=new Set(definitions.map(([name])=>name));
export const interactionNamespaces=Object.freeze([...namespaces,'vc']);
const commandTargets=new Map([['menu','menu'],['vc','vc'],['game','game-lobby'],['read','read'],['admin','admin']]);

export function interactionRoute(interaction){
  if(interaction.isChatInputCommand()){
    const target=commandTargets.get(interaction.commandName);return target?{target,namespace:interaction.commandName,kind:'command'}:null;
  }
  if(typeof interaction.customId!=='string')return null;
  const separator=interaction.customId.indexOf(':');if(separator<1)return null;
  const namespace=interaction.customId.slice(0,separator),button=interaction.isButton();
  if(namespace==='vc')return button||interaction.isStringSelectMenu()?{target:'vc',namespace,kind:'component'}:null;
  if(!namespaces.has(namespace))return null;
  if(namespace==='menu'&&!button){const help=interaction.customId.match(/^menu:help-view:([a-z]{1,16})$/);if(!interaction.isStringSelectMenu()||!(['menu:recent','menu:help-topic','menu:find'].includes(interaction.customId)||help&&Object.hasOwn(menuGuideTopics,help[1])))return null;}
  if(!button&&!interaction.isAnySelectMenu()&&!interaction.isModalSubmit())return null;
  return {target:interaction.customId==='wallet:open'?'wallet-self':namespace,namespace,kind:'component'};
}

export function createInteractionHandlers(controllers){
  const entries=[...definitions,['game-lobby','blackjack','lobby'],['wallet-self','chipAccount','openSelf']];
  return new Map(entries.map(([target,name,method])=>{
    const controller=controllers[name];
    if(typeof controller?.[method]!=='function')throw new Error(`操作の呼び出し先が不足しています: ${name}`);
    return [target,interaction=>controller[method](interaction)];
  }));
}
