// Count Unicode code points so surrogate pairs are never cut in half.
export function backupText(value){
  const chars=Array.from(String(value??'').normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim());
  return chars.slice(0,50).join('')+(chars.length>50?'以下略':'');
}
