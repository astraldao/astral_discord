import {randomUUID} from 'node:crypto';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,UserSelectMenuBuilder,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {GameSessions} from './game-sessions.js';
import {payload,text,adminHomeButton,menuHomeButton} from './ui.js';
import {MAX_CHIPS} from './game-wallets.js';
import {casinoNames} from './casino.js';
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const button=(s,a,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`wallet:${s.id}:${s.turn}:${a}`).setLabel(label).setStyle(style);
const names={blackjack:'ブラックジャック',...casinoNames};
const number=n=>n.toLocaleString('ja-JP'),signed=n=>`${n>=0?'+':''}${number(n)}`;
const labels={initial:'初期チップ',carry:'履歴導入前の残高',casino:'ゲーム', 'blackjack-bet':'ブラックジャック開始','blackjack-result':'ブラックジャック精算','blackjack-double':'ブラックジャック · ダブル','blackjack-interrupted':'ブラックジャック中断',work:'お手伝いのお礼','gift-in':'チップ受取','gift-out':'チップ譲渡',adjust:'管理者の調整',other:'その他の増減'};
const filters={all:'すべて',games:'ゲーム',gifts:'受取・譲渡',adjust:'管理者調整',work:'お手伝い'};
const matches=(e,filter)=>filter==='all'||filter==='games'&&!!e.game||filter==='gifts'&&['gift-in','gift-out'].includes(e.type)||e.type===filter;
const modes={add:'追加する',remove:'減らす',set:'残高を指定する'};
const home=(admin=false)=>admin?adminHomeButton():new ButtonBuilder().setCustomId('game:open').setLabel('ゲーム選択へ').setStyle(ButtonStyle.Secondary);
const checked=at=>Number.isFinite(at)?`\n履歴の取得 <t:${Math.floor(at/1000)}:R>`:'';
const when=at=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
const eventBody=e=>[`残高 **${number(e.balance)}**`,e.game?`${names[e.game]}${e.wager!==undefined?` · 掛け ${number(e.stake??e.wager)}`:''}${e.payout!==undefined?` · 払い戻し ${number(e.payout)}`:''}`:'',e.peer?`相手 <@${e.peer}>`:'',e.actor?`実行者 <@${e.actor}>`:'',e.reason?`理由 ${text(e.reason)}`:''].filter(Boolean).join('\n');
function pages(s,items,size=5){const count=Math.max(1,Math.ceil(items.length/size));s.page=Math.max(0,Math.min(count-1,s.page??0));return {count,items:items.slice(s.page*size,(s.page+1)*size)};}
function navigation(s,count,back){return row(...(count>1?[button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page===count-1)]:[]),button(s,'refresh',s.view==='history'?'残高・履歴を更新':'履歴を更新'),button(s,back,s.scope==='admin'?(back==='summary'?'この人のチップへ':'チップ管理へ'):'自分のチップへ'));}
export function chipAccountScreen(s,wallet,note=''){
  const admin=s.scope==='admin',target=admin?s.target:s.userId;let m;
  const intro=note?`${note}\n\n`:'';
  if(admin&&s.view==='list'){
    const all=wallet.list();if(s.sort==='profit')all.sort((a,b)=>b.net-a.net||b.balance-a.balance);const p=pages(s,all,10),total=all.reduce((n,a)=>n+a.balance,0);
    m=payload('✦  チップ管理',`${intro}**記録のある人 ${all.length}人 · 合計 ${number(total)}枚**\n\n${p.items.length?p.items.map(a=>`<@${a.user}>　**${number(a.balance)}枚** · ゲーム収支 ${signed(a.net)}`).join('\n'):'まだ利用記録はありません。'}\n\n${s.page+1}/${p.count}ページ`,{components:[row(new StringSelectMenuBuilder().setCustomId(`wallet:${s.id}:${s.turn}:sort`).setPlaceholder('並び順を選ぶ').addOptions({label:'残高の多い順',value:'balance',default:s.sort!=='profit'},{label:'ゲーム収支の多い順',value:'profit',default:s.sort==='profit'})),row(new UserSelectMenuBuilder().setCustomId(`wallet:${s.id}:${s.turn}:target`).setPlaceholder('確認・調整する人を選ぶ').setMinValues(1).setMaxValues(1)),row(...(p.count>1?[button(s,'prev','前へ').setDisabled(s.page===0),button(s,'next','次へ').setDisabled(s.page===p.count-1)]:[]),button(s,'refresh','最新の残高に更新'),button(s,'audit','調整履歴')),row(home(admin))]});
  }else if(admin&&s.view==='audit'){
    const p=pages(s,s.auditSnapshot??[]);m=payload('✦  管理者の調整履歴',`${intro}直近${s.auditSnapshot?.length??0}件 · ${s.page+1}/${p.count}ページ${checked(s.auditCheckedAt)}`, {components:[navigation(s,p.count,'list')]});
    if(!p.items.length)m.embeds[0].setDescription(`調整履歴はありません。${checked(s.auditCheckedAt)}`);for(const e of p.items)m.embeds[0].addFields({name:`${when(e.at)} · ${signed(e.delta)}枚`,value:`対象 <@${e.user}>\n${eventBody(e)}`});
  }else{
    const a=wallet.account(target),l=a.ledger,t=l.totals,back=admin?'list':'summary';
    if(s.view==='confirm'){
      const d=s.adjustment;m=payload('✦  チップ調整の確認',`${intro}対象 <@${target}>\n\n**${number(d.expectedBalance)} → ${number(d.balance)}枚**\n変更 **${signed(d.balance-d.expectedBalance)}枚**\n\n理由 ${text(d.reason)}`,{components:[row(button(s,'save','この内容で保存',ButtonStyle.Primary),button(s,'summary','変更せず戻る'))]});
    }else if(s.view==='history'){
      const filtered=(s.historySnapshot??[]).filter(e=>matches(e,s.historyFilter??'all')),p=pages(s,filtered);m=payload('✦  チップの内訳',`${intro}${admin?`<@${target}>\n`:''}**残高 ${number(a.balance)}枚**\n直近${s.historySnapshot?.length??0}件のうち ${filtered.length}件 · ${s.page+1}/${p.count}ページ${checked(s.historyCheckedAt)}\n残高は画面表示時、履歴は取得時点の内容です。${!filtered.length?'\n\nこの種類の履歴はありません。種類を「すべて」に戻すか、「残高・履歴を更新」を使ってください。':''}`, {components:[row(new StringSelectMenuBuilder().setCustomId(`wallet:${s.id}:${s.turn}:filter`).setPlaceholder('履歴の種類を選ぶ').addOptions(...Object.entries(filters).map(([value,label])=>({label,value,default:value===(s.historyFilter??'all')})))),navigation(s,p.count,'summary')]});for(const e of p.items)m.embeds[0].addFields({name:`${when(e.at)} · ${labels[e.type]} · ${signed(e.delta)}枚`,value:eventBody(e)});
    }else if(s.view==='stats'){
      m=payload('✦  チップゲームの記録',`${intro}${admin?`<@${target}>\n`:''}**ゲーム収支 ${signed(t.paid-t.wagered)}枚**\n掛け ${number(t.wagered)} · 払い戻し ${number(t.paid)}\n勝敗は精算済みの勝負のみ（中断を除く）。`,{components:[row(button(s,'summary',admin?'この人のチップへ':'自分のチップへ'),button(s,'refresh','最新の残高に更新'),home(admin))]});
      const games=Object.entries(l.games);if(!games.length)m.embeds[0].addFields({name:'これからの記録',value:'ゲームを遊ぶと記録されます。'});for(const [kind,g] of games)m.embeds[0].addFields({name:names[kind],value:`${g.rounds}回 · ${g.wins}勝 ${g.losses}敗 ${g.draws}分\n収支 **${signed(g.paid-g.wagered)}枚** · 掛け ${number(g.wagered)} · 払い戻し ${number(g.paid)}`});
    }else{
      m=payload(admin?'✦  メンバーのチップ':'✦  自分のチップ',`${intro}${admin?`<@${target}>\n\n`:''}**残高 ${number(a.balance)} チップ**${a.pending&&a.pending.expires>wallet.now()?`\nブラックジャックに ${number(a.pending.bet)}枚を使用中`:''}\n\n**増減の内訳**\nゲーム収支 ${signed(t.paid-t.wagered)}\nお手伝い +${number(t.work)}\n受取 +${number(t.received)} · 譲渡 −${number(t.sent)}\n管理者追加 +${number(t.added)} · 減額 −${number(t.removed)}${t.other?`\nその他 ${signed(t.other)}`:''}\n\n開始時点 ${number(l.opening)}枚 · ${when(l.started)}以降の記録`,{components:[row(button(s,'history','チップの履歴',ButtonStyle.Primary),button(s,'stats','ゲームの記録'),button(s,'refresh','最新の残高に更新')),...(admin?[row(new StringSelectMenuBuilder().setCustomId(`wallet:${s.id}:${s.turn}:mode`).setPlaceholder('残高を調整する').addOptions(...Object.entries(modes).map(([value,label])=>({label,value}))).setDisabled(!!a.pending&&a.pending.expires>wallet.now())),row(button(s,'list','チップ管理へ'))]:[row(new ButtonBuilder().setCustomId('chips:open').setLabel('チップを渡す').setStyle(ButtonStyle.Secondary),home(admin))])]});
    }
  }
  if(!admin)m.components.at(-1).addComponents(menuHomeButton());
  return {...m,attachments:[]};
}
export function createChipAccountController({guild,wallet,now=()=>Date.now(),member=async user=>{const m=await guild.members.fetch({user,force:true});if(m.user.bot)throw new Error('Botのチップは調整できません。');return m;},access=async(i,admin)=>{const m=await guild.members.fetch({user:i.user.id,force:true}),c=await guild.channels.fetch(i.channelId,{force:true});if(!c?.permissionsFor(m)?.has(P.ViewChannel)||admin&&!m.permissions.has(P.Administrator))throw new Error(admin?'管理者権限がありません。':'このチャンネルでは操作できません。');}}){
  const sessions=new GameSessions(now);
  const get=(id,i)=>{const s=sessions.get(id,i.user.id);if(s.channelId!==i.channelId)throw new Error('元のチャンネルから操作してください。');return s;};
  async function ack(i){if(i.deferred||i.replied)return;if(i.message?.flags?.has(MessageFlags.Ephemeral))await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});}
  async function error(i,e){const m={...payload('✦  チップ',text(e.message),{state:'error',components:[row(home())]}),attachments:[]};if(i.deferred||i.replied)await i.editReply(m);else await i.reply({...m,flags:MessageFlags.Ephemeral});}
  async function open(i,admin=false){try{await ack(i);await access(i,admin);if([...sessions.sessions.values()].some(s=>s.userId===i.user.id&&s.busy))throw new Error('前の操作を処理中です。');const s=sessions.create(i.user.id);Object.assign(s,{scope:admin?'admin':'self',channelId:i.channelId,target:admin?undefined:i.user.id,view:admin?'list':'summary',turn:0});await i.editReply(chipAccountScreen(s,wallet));}catch(e){await error(i,e);}}
  async function handle(i){let s,locked=false;try{
    const [,id,turn,action,token]=i.customId.split(':');s=get(id,i);if(s.busy)throw new Error('前の操作を処理中です。');s.busy=true;locked=true;
    if(action!=='mode')await ack(i);await access(i,s.scope==='admin');get(id,i);
    if(String(s.turn)!==turn)throw new Error('古い画面です。元のメニューから開き直してください。');
    const admin=s.scope==='admin';let note='';
    if(['target','mode','form','save','list','audit','sort'].includes(action)&&!admin)throw new Error('管理者専用の操作です。');
    if(action==='mode'){
      if(s.view!=='summary'||!s.target||i.values?.length!==1||!Object.hasOwn(modes,i.values[0]))throw new Error('調整方法を選び直してください。');await member(s.target);await access(i,true);get(id,i);
      const a=wallet.account(s.target);if(a.pending&&a.pending.expires>now())throw new Error('ブラックジャックの終了後に調整してください。');
      s.form={token:randomUUID().slice(0,12),mode:i.values[0],target:s.target,expectedBalance:a.balance,expectedRevision:a.ledger.seq};
      const input=(id,label,length)=>row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(length));
      await i.showModal(new ModalBuilder().setCustomId(`wallet:${s.id}:${s.turn}:form:${s.form.token}`).setTitle(modes[s.form.mode]).addComponents(input('amount',s.form.mode==='set'?'変更後の残高（0以上）':'変更する枚数（1以上）',9),input('reason','調整理由',100)));return;
    }else if(action==='form'){
      const f=s.form;if(!f||f.token!==token||s.target!==f.target||s.view!=='summary')throw new Error('最新の調整フォームから操作してください。');
      const raw=i.fields.getTextInputValue('amount').trim(),reason=i.fields.getTextInputValue('reason').normalize('NFKC').trim();if(!/^(0|[1-9]\d{0,8})$/.test(raw)||Number(raw)>MAX_CHIPS||(f.mode!=='set'&&Number(raw)===0)||!reason||reason.length>100||/[\u0000-\u001f\u007f]/u.test(reason))throw new Error('枚数と調整理由を確認してください。');
      const value=Number(raw),balance=f.mode==='set'?value:f.mode==='add'?f.expectedBalance+value:f.expectedBalance-value;if(balance<0||balance>MAX_CHIPS||balance===f.expectedBalance)throw new Error('変更後の残高は0〜100,000,000枚で、現在と異なる値にしてください。');
      s.adjustment={...f,value,reason,balance,id:randomUUID(),actor:s.userId};delete s.form;s.view='confirm';
    }else if(action==='save'){
      if(s.view!=='confirm'||!s.adjustment)throw new Error('確認画面から保存してください。');
      await wallet.adjust(s.target,s.adjustment,async()=>{await member(s.target);await access(i,true);get(id,i);});delete s.adjustment;s.view='summary';note='✓ チップを調整しました。';
    }else if(action==='sort'){if(s.view!=='list'||i.values?.length!==1||!['balance','profit'].includes(i.values[0]))throw new Error('並び順を選び直してください。');s.sort=i.values[0];s.page=0;
    }else if(action==='filter'){if(s.view!=='history'||i.values?.length!==1||!Object.hasOwn(filters,i.values[0]))throw new Error('履歴の種類を選び直してください。');s.historyFilter=i.values[0];s.page=0;
    }else if(action==='target'){
      if(s.view!=='list'||i.values?.length!==1)throw new Error('チップ管理から人を選んでください。');await member(i.values[0]);await access(i,true);get(id,i);s.target=i.values[0];s.view='summary';s.page=0;delete s.form;delete s.adjustment;
    }else if(action==='list'){s.view='list';s.page=0;delete s.target;delete s.form;delete s.adjustment;}
    else if(action==='audit'){s.auditSnapshot=wallet.adjustmentAudit();s.auditCheckedAt=now();s.view='audit';s.page=0;}
    else if(action==='history'){s.historySnapshot=wallet.account(admin?s.target:s.userId).ledger.history.slice().reverse();s.historyCheckedAt=now();s.view='history';s.page=0;}
    else if(action==='summary'){if(!s.target)throw new Error('人を選んでください。');s.view='summary';delete s.form;delete s.adjustment;s.page=0;}
    else if(action==='stats'){if(!s.target)throw new Error('人を選んでください。');s.view='stats';s.page=0;}
    else if(action==='prev'||action==='next'){if(!['list','history','audit'].includes(s.view))throw new Error('一覧から操作してください。');s.page+=action==='next'?1:-1;}
    else if(action==='refresh'){if(s.view==='confirm')throw new Error('確認画面から戻ってください。');if(s.view==='history'){s.historySnapshot=wallet.account(admin?s.target:s.userId).ledger.history.slice().reverse();s.historyCheckedAt=now();}if(s.view==='audit'){s.auditSnapshot=wallet.adjustmentAudit();s.auditCheckedAt=now();}}
    else throw new Error('操作を確認してください。');
    s.turn++;await access(i,admin);get(id,i);await i.editReply(chipAccountScreen(s,wallet,note));
  }catch(e){await error(i,e);}finally{if(locked)s.busy=false;}}
  return {sessions,openSelf:i=>open(i),openAdmin:i=>open(i,true),handle};
}
