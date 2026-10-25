import {rollReply} from '../src/roll-ui.js';
import {diceRequest,saizeRequest} from '../src/chat-dice.js';
const cases=[['3D10+2',[6,8,10]],['1D100,1D4+2',[42,3]],['サイゼロール',[3,4,10]],['!サイゼロール',[2,4,7]]];
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const markdown=value=>escape(value).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replaceAll('\n','<br>');
const cards=cases.map(([content,values])=>{
  let n=0;const d=rollReply(saizeRequest(content)??diceRequest(content),()=>values[n++]).embeds[0].toJSON(),color=`#${d.color.toString(16).padStart(6,'0')}`;
  return `<section><p class="source">投稿：${escape(content)}</p><article style="border-left-color:${color}"><h2>${d.url?`<a href="${escape(d.url)}">${escape(d.title)}</a>`:escape(d.title)}</h2><div class="body">${markdown(d.description)}</div><footer>${escape(d.footer.text)}</footer></article></section>`;
}).join('\n');
process.stdout.write(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ロール返信の見本</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f3f5;color:#24282e;font-family:system-ui,-apple-system,"Noto Sans CJK JP",sans-serif}main{max-width:1020px;margin:auto;padding:24px}h1{font-size:22px;margin:0 0 8px}.note{font-size:13px;line-height:1.7;color:#606870;margin:0 0 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.source{font-size:13px;color:#59626b;margin:0 0 8px}article{background:white;border-left:4px solid;border-radius:5px;padding:16px;overflow-wrap:anywhere}h2{font-size:17px;line-height:1.5;margin:0 0 12px}a{color:#0065cc;text-decoration:none}.body{font-size:14px;line-height:1.65}code{font-size:14px;background:#f0f1f3;border-radius:3px;padding:2px 4px;font-family:ui-monospace,monospace}footer{margin-top:16px;font-size:11px;line-height:1.6;color:#626a72}@media(max-width:650px){main{padding:16px}.grid{grid-template-columns:1fr;gap:20px}.note{margin-bottom:20px}article{padding:14px}}
</style><main><h1>ロール返信 · 表示見本</h1><p class="note">実際の送信データを使った架空のHTML見本です。<br>Discord実機のスクリーンショットではありません。</p><div class="grid">${cards}</div></main></html>\n`);
