import {TrpgStore} from '../src/trpg-store.js';
import {newFour} from '../src/four.js';
// Fictional data for reproducible previews and view-boundary tests. No disk or external requests.
export function memberFixtures(){
  const owner='owner',channel='111111111111111111',panel='panel1',scenario='scenario1';
  const trpg=new TrpgStore();trpg.data={version:1,scenarios:[{id:scenario,name:'星を探す夜',url:'https://ccfolia.com/rooms/fictional'}],panels:[{id:panel,channelId:channel,messageId:'222222222222222222',mode:'secret'}],characters:Array.from({length:12},(_,n)=>({id:`pc${n}`,panelId:panel,ownerId:n===0?owner:`member${n}`,name:`架空の探索者${n+1}`,url:`https://iachara.com/view/${1000+n}`,txt:`架空の控え${n}`,updatedAt:1793000000000})),tables:[{id:'table1',name:'週末のセッション',scenarioId:scenario,answerUrl:'https://densuke.biz/list?cd=example',characterIds:['pc0','pc1','pc2','pc3','pc4'],pinned:true,completed:false}]};
  const calendar={id:'calendar1',title:'みんなの予定',events:[{id:'event1',title:'週末のセッション',date:'2026-10-31',start:1200,end:1500,place:'いつものVC',description:'キャラクターシートを用意してください。\n開始10分前から集まれます。',color:'blue',revision:1}],publications:[]};
  const schedule={id:'preview',turn:0,scope:'admin',view:'event',calendarId:calendar.id,eventId:'event1',month:'2026-10',page:0,today:'2026-10-26'},densuke={id:'preview',controlToken:'fixed',reviewToken:'fixed',phase:'review',event:{name:'週末のセッション',schedule:'10/31 20:00〜\n11/1 20:00〜\n11/3 20:00〜',description:'参加できる候補に回答してください。',password:'Hidden12',choice:'3'},channelId:channel};
  const workshop={id:'preview',turn:0,preset:'emoji',crop:'contain',input:{width:512,height:512,buffer:Buffer.alloc(8192)},output:{width:128,height:128,buffer:Buffer.alloc(2048),extension:'png'}};
  return {owner,channel,panel,trpg,calendar,schedule,densuke,workshop,four:{id:'preview',turn:0,game:newFour('user',()=>0)}};
}
