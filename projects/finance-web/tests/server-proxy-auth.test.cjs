const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const mod={exports:{}};
new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/server-proxy-auth.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText)(mod,mod.exports,require);
const {loginProxyHeaders,refreshProxyHeaders}=mod.exports;
test('production proxy identity requires a configured trusted header and signs client-specific hashes',()=>{
 const saved={...process.env};
 try {
  process.env.NODE_ENV='production';delete process.env.FINANCE_PROXY_AUTH_SECRET;process.env.VERCEL='0';delete process.env.FINANCE_TRUSTED_CLIENT_IP_HEADER;
  const request=new Request('https://example.test',{headers:{'x-forwarded-for':'192.0.2.10'}});
  assert.throws(()=>loginProxyHeaders(request),/not configured/);
  process.env.FINANCE_PROXY_AUTH_SECRET='synthetic-proxy-key-with-32-characters';
  assert.throws(()=>loginProxyHeaders(request),/not configured/);
  process.env.FINANCE_TRUSTED_CLIENT_IP_HEADER='x-forwarded-for';
  const first=loginProxyHeaders(request),second=loginProxyHeaders(new Request('https://example.test',{headers:{'x-forwarded-for':'192.0.2.11'}}));
  assert.notEqual(first['X-Finance-Client'],second['X-Finance-Client']);
  assert.equal(Object.values(first).includes('192.0.2.10'),false);
  assert.notEqual(refreshProxyHeaders('synthetic-first')['X-Finance-Refresh-Signature'],refreshProxyHeaders('synthetic-second')['X-Finance-Refresh-Signature']);
 } finally { for(const key of Object.keys(process.env)) if(!(key in saved))delete process.env[key]; Object.assign(process.env,saved); }
});
