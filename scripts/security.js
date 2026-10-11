import {parse} from 'acorn';

// A source policy check, not a sandbox for dependencies or arbitrary JS.
export function unsafeCode(source,filename='source.js') {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});
  const problems=[];
  const forbidden=new Set(['eval','Function','exec','execSync']);
  function visit(node) {
    if(!node || typeof node!=='object')return;
    if(node.type==='Identifier' && forbidden.has(node.name))problems.push(`${filename}:${node.loc.start.line}: ${node.name} is prohibited`);
    if(node.type==='Literal' && typeof node.value==='string' && /^(node:)?vm$/.test(node.value))problems.push(`${filename}:${node.loc.start.line}: vm is prohibited`);
    if(node.type==='ImportExpression' && node.source.type!=='Literal')problems.push(`${filename}:${node.loc.start.line}: dynamic import paths are prohibited`);
    if(node.type==='MemberExpression' && node.computed && node.property.type==='Literal' && forbidden.has(node.property.value))problems.push(`${filename}:${node.loc.start.line}: computed code execution is prohibited`);
    if(node.type==='Property' && (node.key.name==='shell' || node.key.value==='shell') && !(node.value.type==='Literal' && node.value.value===false))problems.push(`${filename}:${node.loc.start.line}: shell execution is prohibited`);
    for(const [key,value] of Object.entries(node)) {
      if(['loc','start','end'].includes(key))continue;
      if(Array.isArray(value))value.forEach(visit);else if(value && typeof value==='object')visit(value);
    }
  }
  visit(ast);return problems;
}
