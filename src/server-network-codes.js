const knownCodes=new Set([10003,10004,10007,10069,50001,50013,50035,10062,40060,40006,20001,40333,50026,50074,50086,60003,350000,350001]);
const httpCodes=new Set([401,403,404,408,429,500,502,503,504]);
const connections=new Set(['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET','ABORT_ERR']);
export function safeNetworkCode(e){if(knownCodes.has(e?.code))return `DISCORD_${e.code}`;if(httpCodes.has(e?.status))return `HTTP_${e.status}`;if(connections.has(e?.code))return e.code;if(e?.name==='AbortError'||e?.name==='TimeoutError')return 'TIMEOUT';return 'UNKNOWN';}

const allowed=new Set([...knownCodes].map(v=>`DISCORD_${v}`).concat([...httpCodes].map(v=>`HTTP_${v}`),[...connections],['TIMEOUT','UNKNOWN']));
export const isNetworkCode=value=>typeof value==='string'&&allowed.has(value);
