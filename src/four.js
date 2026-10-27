import {GameError} from './game-errors.js';
import {randomInt} from 'node:crypto';
export const FOUR_COLUMNS=7,FOUR_ROWS=6;
const order=[3,2,4,1,5,0,6];
export const fourMoves=board=>order.filter(c=>board[c]===0);
export function fourLine(board){
  for(let row=0;row<6;row++)for(let col=0;col<7;col++)for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){
    const cells=Array.from({length:4},(_,n)=>(row+n*dy)*7+col+n*dx);
    if(row+3*dy>5||col+3*dx<0||col+3*dx>6)continue;
    const player=board[cells[0]];if(player&&cells.every(i=>board[i]===player))return {player,cells};
  }return null;
}
export function dropFour(board,col,player){
  if(!Number.isInteger(col)||col<0||col>=7||board[col]!==0)throw new GameError('空いている列を選んでください。');
  const next=[...board];for(let row=5;row>=0;row--)if(next[row*7+col]===0){next[row*7+col]=player;return next;}
  throw new GameError('この列はいっぱいです。');
}
function estimate(board){
  let score=0;for(let row=0;row<6;row++){const p=board[row*7+3];score+=p===2?4:p===1?-4:0;}
  for(let row=0;row<6;row++)for(let col=0;col<7;col++)for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){
    if(row+3*dy>5||col+3*dx<0||col+3*dx>6)continue;
    let bot=0,user=0;for(let n=0;n<4;n++){const p=board[(row+n*dy)*7+col+n*dx];bot+=p===2?1:0;user+=p===1?1:0;}
    if(!user)score+=[0,1,8,60,10000][bot];if(!bot)score-=[0,1,12,90,10000][user];
  }return score;
}
function search(board,depth,bot,alpha,beta){
  const win=fourLine(board);if(win)return win.player===2?10000+depth:-10000-depth;
  const moves=fourMoves(board);if(!moves.length)return 0;if(!depth)return estimate(board);
  let best=bot?-Infinity:Infinity;
  for(const c of moves){const score=search(dropFour(board,c,bot?2:1),depth-1,!bot,alpha,beta);best=bot?Math.max(best,score):Math.min(best,score);if(bot)alpha=Math.max(alpha,best);else beta=Math.min(beta,best);if(alpha>=beta)break;}
  return best;
}
export function fourBot(board,random=randomInt){
  const moves=fourMoves(board);if(!moves.length||fourLine(board))throw new GameError('この勝負は終了しています。');
  const scores=moves.map(c=>search(dropFour(board,c,2),2,false,-Infinity,Infinity)),best=Math.max(...scores),choices=moves.filter((c,i)=>scores[i]===best);
  const n=random(choices.length);if(!Number.isInteger(n)||n<0||n>=choices.length)throw new GameError('Botの手を決められませんでした。');return choices[n];
}
const finish=board=>{const line=fourLine(board);return line?{phase:'done',result:line.player===1?'win':'lose',winning:line.cells}:!fourMoves(board).length?{phase:'done',result:'draw',winning:[]}:{phase:'playing',winning:[]};};
export function newFour(first='user',random){
  if(!['user','bot'].includes(first))throw new GameError('先攻・後攻を選んでください。');let board=Array(42).fill(0),lastBot;
  if(first==='bot'){lastBot=fourBot(board,random);board=dropFour(board,lastBot,2);}
  return {board,first,...finish(board),...(lastBot!==undefined?{lastBot}:{})};
}
export function playFour(game,col,random){
  if(game.phase!=='playing')throw new GameError('勝負が終わっています。もう一度遊ぶから始めてください。');
  let board=dropFour(game.board,col,1),state=finish(board),lastBot;
  if(state.phase==='playing'){lastBot=fourBot(board,random);board=dropFour(board,lastBot,2);state=finish(board);}
  return {board,first:game.first,...state,lastUser:col,...(lastBot!==undefined?{lastBot}:{})};
}
