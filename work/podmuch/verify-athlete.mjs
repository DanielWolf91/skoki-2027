import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {loadAthlete} from './render3d.mjs';
import {inflateSync} from 'node:zlib';

const built=fs.readFileSync(new URL('./Podmuch-built.html',import.meta.url),'utf8');
const embedded=Buffer.from(built.match(/window\.PodmuchAthlete="([a-zA-Z0-9+/=]+)";/)[1],'base64');
const bytes=inflateSync(embedded);
const file=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const {model,bindings,update}=await loadAthlete(file);
assert.equal(bindings.size,15);
assert(bindings.has('neck'));
const parts=[];
model.traverse(o=>{if(o.isSkinnedMesh) parts.push(o);});
assert.equal(parts.length,9);
assert(parts.some(part=>part.material.name==='Oprawka i paski'));
const skin=parts.find(part=>part.material.name==='Twarz');
const neckIndex=skin.skeleton.bones.indexOf(bindings.get('neck').object);
assert(neckIndex>=0);
const skinIndices=skin.geometry.getAttribute('skinIndex');
const skinWeights=skin.geometry.getAttribute('skinWeight');
assert(skinIndices.array.some((index,i)=>index===neckIndex&&skinWeights.array[i]>.5));
const elements=new Map();
const document={activeElement:null,querySelector:()=>null,createElement:()=>({setAttribute(){},getContext:()=>null}),getElementById(id){
  if(!elements.has(id)) elements.set(id,{clientWidth:1280,clientHeight:800,getContext:()=>({setTransform(){}}),style:{},dataset:{},classList:{toggle(){}},addEventListener(){}});
  return elements.get(id);
}};
const context=vm.createContext({
  document,window:{addEventListener(){}},requestAnimationFrame(){},devicePixelRatio:1,
  localStorage:{getItem:()=>null,setItem(){}},console
});
const source=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8').match(/<script>([\s\S]+)<\/script>/)[1];
vm.runInContext(source,context);
const shots=vm.runInContext(`
const shots=[];
function capturePose(name) {
  const rig={};
  const skis=skier(s,rig);
  shots.push({name,rig,skis});
}
init(0);capturePose('belka');start();action();
while(s.x< -45) simulate(step);
capturePose('najazd');
while(s.state==='inrun') {
  if(secondsToLip(s)<=step&&s.takeoffX===undefined) action();
  simulate(step);
}
capturePose('wybicie');
const atLip=s.lipTime;
const deflection=(state,offset)=>skiDeflection({...s,state,tick:atLip+offset});
const [frontLoad,tailLoad]=deflection('flight',0);
if(frontLoad<.019||frontLoad>.032||tailLoad>=frontLoad) throw Error('Nieprawidłowe ugięcie na progu');
if(deflection('inrun',-.18)[0]!==0||deflection('inrun',-.08)[0]>=frontLoad) throw Error('Docisk nie narasta do progu');
const [frontRebound,tailRebound]=deflection('flight',.075);
if(frontRebound>=0||tailRebound<=0) throw Error('Narty nie odciążają się kolejno po wybiciu');
if(deflection('flight',.4).some(Boolean)) throw Error('Ugięcie nie wygasa w locie');
function flyStep() {
  const error=s.pitch-idealFlightPitch;
  down.delete('up');down.delete('down');
  if(error>.4) down.add('down');
  if(error<-.4) down.add('up');
  simulate(step);
}
while(s.state==='flight'&&s.x<69) flyStep();
capturePose('lot');
const flightShot=shots.at(-1);
for(const tag of ['L','R']) {
  const [ankle,toe]=flightShot.rig.joints['boot'+tag];
  if(ankle[1]-toe[1]<.020) throw Error('Pięta nie unosi się nad nartą');
}
if(flightShot.skis.filter(face=>face.color==='#27363c').length!==8) throw Error('Brak dwóch linek');
while(s.state==='flight'){
  if(s.landHint&&s.landingTime===null) action();
  flyStep();
}
while(s.tick-s.outStart<.16) simulate(step);
capturePose('telemark');
if(s.landing!=="Telemark") throw Error(s.landing);
s.runout={...s.runout,plow:false,brakeSide:1,brakeRange:30};
while(s.state==='outrun'&&s.brake<.68) simulate(step);
if(s.state!=='outrun'||Math.abs(s.yaw)<.35) throw Error('Hamowanie bokiem');
capturePose('hamowanie bokiem');
shots;
`,context);
const vertex=new Vector3();
for(const {name,rig,skis} of shots) {
  assert.equal(Object.keys(rig.joints).length,bindings.size);
  assert(skis.length>=96&&skis.length<=104,'Przekroje modelu nart i geometria wiązań.');
  update(rig);model.updateMatrixWorld(true);
  const bounds=new Box3();
  for(const part of parts) {
    const pos=part.geometry.attributes.position;
    for(let i=0;i<pos.count;i+=Math.max(1,Math.floor(pos.count/440))) {
      part.getVertexPosition(i,vertex).applyMatrix4(part.matrixWorld);
      assert(vertex.toArray().every(Number.isFinite));
      bounds.expandByPoint(vertex);
    }
  }
  const dims=bounds.getSize(new Vector3()).toArray();
  assert(dims.every(v=>v>.16&&v<2.45),`${name}: ${dims}`);
  console.log(name, dims.map(v=>v.toFixed(2)).join(' × '));
}
console.log('Osadzony GLB, 15 kości, 6 ujęć pozy.');
