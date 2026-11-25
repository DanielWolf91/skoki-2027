import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from './skoki-site/dist/server/index.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync('work/skoki-site/drizzle/0000_settings.sql','utf8'));
const env = {DB:{
  prepare(sql) {
    const statement=db.prepare(sql);
    return {bind(...args) {
      return {all:()=>({results:statement.all(...args)}),run:()=>statement.run(...args)};
    }};
  },
  batch(statements) { return statements.map(statement=>statement.run()); }
}};
const host='https://skoki.example';
const page=await worker.fetch(new Request(host+'/'),env);
const markup=await page.text();
const rendererURL=markup.match(/<script src="(\/assets\/renderer-[a-f0-9]{20}\.js)">/)?.[1];
assert(rendererURL&&markup.includes(`rel="preload" as="script" href="${rendererURL}"`));
const renderer=await worker.fetch(new Request(host+rendererURL),env);
assert.equal(renderer.status,200);
assert.match(renderer.headers.get('cache-control'),/private.*immutable/);
assert((await renderer.text()).includes('window.PodmuchAthlete='));
assert.equal((await worker.fetch(new Request(host+rendererURL,{method:'HEAD'}),env)).body,null);
function put(user,values,origin=host) {
  const headers={'Content-Type':'application/json','Origin':origin};
  if(user) headers['oai-authenticated-user-id']=user;
  return worker.fetch(new Request(host+'/api/settings',{method:'PUT',headers,body:JSON.stringify(values)}),env);
}
async function load(user) {
  const response=await worker.fetch(new Request(host+'/',{headers:{'oai-authenticated-user-id':user}}),env);
  assert.equal(response.status,200);
  const body=await response.text();
  assert(body.includes('SKOKI 2027'));
  const snapshot=body.match(/window\.__SKOKI_SETTINGS__=(.*?);<\/script>/s)[1];
  assert(!snapshot.includes('<'),'Embedded values must not break out of the script');
  return JSON.parse(snapshot);
}
const settings={'podmuch-record-zakopane':131.5,'podmuch-athlete-v1':{name:'</script>'},'podmuch-camera':{quality:0}};
assert.equal((await put('',settings)).status,401);
assert.equal((await put('one',settings,'https://other.example')).status,403);
assert.equal((await put('one',{'unknown':true})).status,400);
assert.equal((await put('one',settings)).status,200);
assert.equal((await put('one',{'podmuch-record-zakopane':111.5})).status,200);
assert.deepEqual(await load('one'),settings);
assert.deepEqual(await load('two'),{});
assert.equal((await put('one',{'podmuch-record-zakopane':140})).status,200);
assert.equal((await load('one'))['podmuch-record-zakopane'],140);
console.log('Zapisy według konta, ponowne wczytanie ustawień, najwyższy rekord i kontrola dostępu.');
