const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {generateKeyPairSync}=require('node:crypto');
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},end(){return this},redirect(n,url){this.statusCode=n;this.url=url;return this}}}
function handler(file,common){const sandbox={module:{exports:{}},require:()=>common,console,URLSearchParams};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api',file),'utf8'),sandbox);return sandbox.module.exports}
test('POST sin token: 401 sin inicializar dependencias',async()=>{const h=handler('iniciar.js',{APP_URL:'https://app.test',getServices(){throw Error('no debe llamarse')}});const r=response();await h({method:'POST',headers:{}},r);assert.equal(r.statusCode,401)});
test('OPTIONS: CORS antes de inicializar Firebase',async()=>{const h=handler('iniciar.js',{APP_URL:'https://app.test'});const r=response();await h({method:'OPTIONS',headers:{origin:'https://app.test'}},r);assert.equal(r.statusCode,204);assert.equal(r.headers['Access-Control-Allow-Origin'],'https://app.test')});
test('Token vencido: 401',async()=>{const h=handler('iniciar.js',{APP_URL:'https://app.test',getServices:()=>({admin:{auth:()=>({verifyIdToken:async()=>{throw Error('expired')}})}}),logError(){}});const r=response();await h({method:'POST',headers:{authorization:'Bearer invalid'}},r);assert.equal(r.statusCode,401)});
function scenario({amount=45000,commitFails=false}={}){
 let data={uid:'u1',monto:45000,tipo:'gasto',concepto:'Gastos comunes',mes:'Noviembre 2026',estado:'iniciada'};
 const writes=[];let emails=0;let commits=0;let statuses=0;
 const ref={id:'HBORDER'};
 const doc={ref,data:()=>({...data})};
 const db={collection(name){return {where(){return {limit(){return {get:async()=>({empty:false,docs:[doc]})}}}},doc(id){return {id,collection:name}}}},async runTransaction(fn){const pending=[];const result=await fn({get:async()=>({data:()=>({...data})}),set:(r,d)=>pending.push(['set',r,d]),update:(r,d)=>pending.push(['update',r,d])});for(const w of pending){writes.push(w);if(w[1]===ref)Object.assign(data,w[2]);}return result}};
 const confirmation={status:'AUTHORIZED',response_code:0,amount,buy_order:'HBORDER',session_id:'u1',authorization_code:'A1'};
 const common={APP_URL:'https://app.test',getServices:()=>({db,admin:{firestore:{FieldValue:{serverTimestamp:()=>123}}},tx:{commit:async()=>{commits++;if(commitFails)throw Error('timeout');return confirmation},status:async()=>{statuses++;return confirmation}}}),enviarComprobante:async()=>{emails++},logError(){}};
 return {h:handler('retorno.js',common),writes,counts:()=>({emails,commits,statuses}),data};
}
test('Retorno autorizado y repetido: pago único y orden en la misma transacción',async()=>{const s=scenario();for(let i=0;i<2;i++){const r=response();await s.h({method:'POST',body:{token_ws:'token'}},r);assert.match(r.url,/estado=ok/)}assert.equal(s.writes.filter(w=>w[0]==='set').length,1);assert.equal(s.data.estado,'pagada');assert.equal(s.counts().emails,1);assert.equal(s.counts().commits,1)});
test('Monto distinto: no registrar pago',async()=>{const s=scenario({amount:1});const r=response();await s.h({method:'POST',body:{token_ws:'token'}},r);assert.equal(s.writes.length,0);assert.match(r.url,/rechazado/)});
test('Commit ambiguo: recuperar estado del proveedor',async()=>{const s=scenario({commitFails:true});const r=response();await s.h({method:'POST',body:'token_ws=token'},r);assert.match(r.url,/estado=ok/);assert.equal(s.counts().statuses,1)});
test('Cancelación sin token: no marcar pagada ni alterar orden por ID del navegador',async()=>{const s=scenario();const r=response();await s.h({method:'POST',body:{TBK_ORDEN_COMPRA:'HBORDER'}},r);assert.equal(s.writes.length,0);assert.equal(s.counts().commits,0);assert.match(r.url,/cancelado/)});
function health(env){const script=`const r={setHeader(){},status(n){this.n=n;return this},json(v){console.log(JSON.stringify({status:this.n,...v}))}};require('./api/salud')({method:'GET'},r)`;const result=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,FIREBASE_SERVICE_ACCOUNT:env},encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim())}
test('Dependencias reales: falta de credencial devuelve diagnóstico controlado',()=>assert.equal(health('').code,'CONFIG_FIREBASE_MISSING'));
test('Dependencias reales: credencial inválida devuelve diagnóstico controlado',()=>assert.equal(health('invalid').code,'CONFIG_FIREBASE_INVALID'));
test('Dependencias reales: inicialización con clave sintética, sin conexión a proveedores',()=>{const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});const account={project_id:'demo-local',client_email:'demo@demo-local.iam.gserviceaccount.com',private_key:key.privateKey};const r=health(Buffer.from(JSON.stringify(account)).toString('base64'));assert.equal(r.status,200);assert.equal(r.ok,true)});
