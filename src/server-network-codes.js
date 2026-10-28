import {DiscordAPIError} from 'discord.js';
const knownCodes=new Set([10003,10004,10007,10069,50001,50013,50035,10062,40060,40006,20001,40333,50026,50074,50086,60003,350000,350001]);
const httpCodes=new Set([401,403,404,408,429,500,502,503,504]);
const connections=new Set(['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET','ABORT_ERR']);
const apiNumber=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=999999?value:typeof value==='string'&&/^(0|[1-9]\d{0,5})$/.test(value)?Number(value):null;
export function safeNetworkCode(e){const number=apiNumber(e?.code);if(number!==null&&(knownCodes.has(number)||e instanceof DiscordAPIError&&Number.isInteger(e.status)&&e.status>=400&&e.status<600))return `DISCORD_${number}`;if(e instanceof DiscordAPIError&&e.status===403&&e.rawError instanceof ArrayBuffer)return 'HTTP_403_NON_JSON';if(httpCodes.has(e?.status))return `HTTP_${e.status}`;if(connections.has(e?.code))return e.code;if(e?.name==='AbortError'||e?.name==='TimeoutError')return 'TIMEOUT';return 'UNKNOWN';}

const allowed=new Set([...knownCodes].map(v=>`DISCORD_${v}`).concat([...httpCodes].map(v=>`HTTP_${v}`),[...connections],['TIMEOUT','UNKNOWN','HTTP_403_NON_JSON']));
export const isNetworkCode=value=>typeof value==='string'&&(allowed.has(value)||/^DISCORD_(0|[1-9]\d{0,5})$/.test(value));

// Keep the existing journal readable on rollback; the reply and console retain the format detail.
export const storedNetworkCode=code=>code==='HTTP_403_NON_JSON'?'HTTP_403':code;
