import {ActionRowBuilder,StringSelectMenuBuilder} from 'discord.js';

// Values are finite controller actions. A picker never dispatches a custom ID.
export function actionPicker(customId,choices,placeholder='その他の操作を選ぶ'){
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).addOptions(...choices));
}
export function selectedAction(values,choices){
  return values?.length===1&&typeof values[0]==='string'&&choices.some(c=>c.value===values[0])?values[0]:null;
}

export function shortButtonRows(rows){
  return rows.flatMap(row=>{const items=row.components;if(items.length<=3)return [row];return Array.from({length:Math.ceil(items.length/3)},(_,n)=>new ActionRowBuilder().addComponents(...items.slice(n*3,n*3+3)));});
}
