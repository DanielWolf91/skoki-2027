const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('work/podmuch/dist/index.html','utf8');
const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
assert.match(html,/#hud\[data-phase="flight"\] \.track\{width:50%/);
const elements = new Map();
const gradient = {addColorStop(){}};
const snowLines=[];
const draw = new Proxy({}, {get:(_, key)=>key.startsWith('create')?()=>gradient:()=>{}});
const document = {activeElement:null,querySelector:()=>document.getElementById('stage'),createElement:()=>({setAttribute(){},getContext:()=>null}),getElementById(id){
  if(!elements.has(id)) elements.set(id,{clientWidth:1280,clientHeight:800,getContext:()=>id==='snow-screen'?{
    clearRect(){snowLines.length=0;},beginPath(){},moveTo(x,y){snowLines.push([x,y]);},lineTo(){},stroke(){},setTransform(){}
  }:draw,style:{},dataset:{},events:{},classList:{toggle(){}},addEventListener(event,listener){this.events[event]=listener;},showModal(){this.open=true;},close(){this.open=false;this.events.close?.();},append(){},focus(){},setPointerCapture(id){this.captured=id;}});
  return elements.get(id);
}};
const storage=new Map();
const events={};
const context = vm.createContext({document,window:{addEventListener:(name,callback)=>events[name]=callback,
  removeEventListener:name=>delete events[name]},localStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val)},
  requestAnimationFrame(){},HTMLButtonElement:class {},devicePixelRatio:1,performance,setTimeout,clearTimeout,console});
vm.runInContext(script,context);
const scenarios=vm.runInContext(`
function steerFlight() {
  if(s.state!=='flight') return;
  const error=s.pitch-idealFlightPitch;
  down.delete('up');
  down.delete('down');
  if(error>.4) down.add('down');
  if(error<-.4) down.add('up');
}
function run(wind,timed,land,pitch,delay) {
  init(wind); start();action();
  let pressed=false;
  for(let i=0;i<3500 && s.state!=='result';i++) {
    if(timed && s.state==='inrun' && secondsToLip(s)<=step && s.takeoffX===undefined) action();
    if(s.state==='flight') {
      if(delay!==undefined&&!pressed&&s.tick-s.lipTime>=delay) {
        action();
        pressed=true;
      }
      if(pitch===undefined) steerFlight();
      else if(pitch!==null) s.pitch=pitch;
    }
    if(land && s.state==='flight' && s.landHint && s.landingTime===null) action();
    simulate(step);
    updateHUD();
  }
  if(s.state!=='result') throw new Error('Simulation did not end');
  return {wind,distance:s.distance,landing:s.landing,timing:s.timing,lead:s.takeoffLead,points:s.points,finalSpeed:s.v,finalX:s.x,height:s.maxClearance};
}
const scenarios=[run(0,true,true),run(1.6,true,true),run(-1.6,true,true),run(0,false,false),run(0,true,false,34),run(0,true,true,null)];
init();render(step);
scenarios;
`,context);
console.log(scenarios);
const [neutral, head, tail, missed, unstable, passive]=scenarios;
assert.equal(neutral.landing,'Telemark');
assert(neutral.distance>100 && neutral.distance<145);
assert.equal(neutral.timing,1);
assert(neutral.height>3&&neutral.height<8,'Skoczek powinien lecieć kilka metrów nad terenem');
assert(head.distance>neutral.distance && neutral.distance>tail.distance);
assert(missed.distance<neutral.distance-10);
assert.equal(unstable.landing,'Upadek');
assert(neutral.distance>passive.distance+12,'Ułożenie sylwetki powinno wyraźnie wydłużać lot');
assert(scenarios.every(run=>run.finalSpeed===0&&run.finalX<232));
assert(scenarios.slice(0,4).every(run=>Math.abs(run.finalX-229.75)<.001));
assert(unstable.finalX<150);
assert(storage.size===1);
const lateJumps=vm.runInContext(`[.009,.045,.085,.115,.15].map(delay=>run(0,false,true,undefined,delay))`,context);
assert(lateJumps[0].timing>.83&&lateJumps[0].timing<.92);
assert(lateJumps[0].lead<0&&lateJumps[0].distance>missed.distance+30&&lateJumps[0].distance<neutral.distance);
assert(lateJumps.every((jump,i)=>!i||(jump.distance<=lateJumps[i-1].distance&&jump.timing<lateJumps[i-1].timing)));
assert.equal(lateJumps.at(-1).timing,0);
console.log('Spóźnione wybicia:',lateJumps.map(({lead,timing,distance})=>[lead,Math.round(timing*100),distance]));
assert(vm.runInContext(`
  init(0);start();action();
  while(s.state==='inrun') simulate(step);
  action('telemark',null,'mouse');
  const singlePower=s.timing;
  simulate(step);
  action('both',null,'mouse');
  const appliedBeforeChord=s.appliedTiming;
  simulate(step);
  const smoothResponse=s.appliedTiming>appliedBeforeChord&&s.appliedTiming<s.timing*.5;
  for(let i=0;i<24;i++) simulate(step);
  singlePower>0&&singlePower<=.5&&smoothResponse&&s.appliedTiming>.8&&s.landingTime===null
    &&$('takeoff-result').textContent.includes('spóźnione');
`,context),'Oba przyciski mogą zarejestrować spóźnione wybicie także po zmianie fazy');
assert(vm.runInContext(`
  const grade = lead=>judgeJump({flightError:0,flightLength:4,landingImpact:6,
    landing:'Telemark',landingQuality:landingQuality(lead)}).points;
  glideError(idealFlightPitch)===0&&glideError(idealFlightPitch+4)<.07
    &&glideError(openFlightPitch)>.8&&landingQuality(.36)===1
    &&landingQuality(.03)===0&&landingQuality(.65)===0
    &&grade(.3)>grade(.09)&&grade(.3)>grade(.51);
`,context),'Łagodna korekta w centrum skali i stopniowane noty za telemark');
assert(vm.runInContext(`
init(0);start();action();
while(s.state==='inrun') {
  if(secondsToLip(s)<=step&&s.takeoffX===undefined) action();
  simulate(step);
}
updateHUD();
const openMarker=$('pointer').style.left;
while(s.tick-s.flightStart<.55) simulate(step);
updateHUD();
const waitsForInput=s.pitch===openFlightPitch&&$('pointer').style.left===openMarker
  &&airPose(s).spread===poses.extend.spread;
while(s.pitch>idealFlightPitch) {
  down.add('down');
  simulate(step);
}
down.delete('down');
const chosenPitch=s.pitch;
for(let i=0;i<36;i++) simulate(step);
updateHUD();
waitsForInput&&s.pitch===chosenPitch&&Math.abs(chosenPitch-idealFlightPitch)<.4
  &&airPose(s).spread>.17&&$('phase').textContent==='Pozycja nośna';
`,context),'W ciszy skoczek czeka na sterowanie i utrzymuje wybraną pozycję');
assert(vm.runInContext(`(()=>{
  s.pitch=idealFlightPitch+2.5;
  updateHUD();
  const atEdge=$('pointer').style.left==='55%'&&$('hud').dataset.cue==='glide';
  s.pitch=idealFlightPitch+2.75;
  updateHUD();
  return atEdge&&$('zone').style.left==='45%'&&$('zone').style.width==='10%'&&
    $('hud').dataset.cue===''&&$('phase').textContent==='Złóż sylwetkę ↓';
})()`,context),'Zielona strefa i komunikat używają tej samej granicy ±2,5°');
const gustTests=vm.runInContext(`(()=>{
  function exercise(wind,counter=false) {
    init(wind,0,true);start();action();
    while(s.state==='inrun') {
      if(secondsToLip(s)<=step) action();
      simulate(step);
    }
    s.pitch=idealFlightPitch;
    let peak=0,largestStep=0,adjustments=0,peakTick=s.tick;
    while(s.state==='flight'&&s.tick-s.flightStart<3.6) {
      const before=s.pitch;
      if(counter&&Math.abs(before-idealFlightPitch)>.75) {
        steerWithMouse(Math.sign(before-idealFlightPitch)*8);
        adjustments++;
      }
      simulate(step);
      largestStep=Math.max(largestStep,Math.abs(s.pitch-before));
      const error=Math.abs(s.pitch-idealFlightPitch);
      if(error>peak) {peak=error;peakTick=s.tick;}
    }
    return {peak,largestStep,adjustments,replayError:Math.abs(replayFrame(peakTick).pitch-idealFlightPitch)};
  }
  return [exercise(0),exercise(.42),exercise(2.1),exercise(2.1,true)];
})()`,context);
const [calmFlight,weakGust,strongGust,counteredGust]=gustTests;
console.log('Wychylenie wiatru i kontra myszą:',gustTests);
assert.equal(calmFlight.peak,0);
assert(weakGust.peak>.2&&weakGust.peak<1);
assert(strongGust.peak>2.5&&strongGust.peak<2.9&&strongGust.largestStep<.13);
assert.equal(strongGust.peak,strongGust.replayError);
assert(counteredGust.adjustments>0&&counteredGust.peak<1.2);
const cameras=vm.runInContext(`
function capture(index, stage, w, h) {
  init(0);width=w;height=h;cameraSettings.view=index;
  if(stage==='flight') {
    start();action();
    do {if(s.state==='inrun'&&secondsToLip(s)<=step&&s.takeoffX===undefined) action();simulate(step);} while(s.x<51);
  }
  const {plannedEye,plannedAim,focal}=viewGoal();
  const forward=normalize(subtract(plannedAim,plannedEye)),right=normalize(cross(forward,[0,1,0])),up=cross(right,forward);
  const center=[w*(s.state==='ready'&&w>650&&index!==2?.57:.50),h*(index===0?.43:.46)];
  const visible=(p)=>{
    const d=subtract(p,plannedEye),z=dot(d,forward);
    const x=center[0]+dot(d,right)*focal*h/z,y=center[1]-dot(d,up)*focal*h/z;
    return z>.2&&x>0&&x<w&&y>0&&y<h;
  };
  const model=skier();
  return {eye:plannedEye,forward,right,up,focal:focal*h,center,faces:mesh,model,athleteVisible:visible([s.x,s.y+.85,0]),panoramaVisible:[[-83,ramp(-83),0],[0,0,0],[225,terrain(225),0]].every(visible)};
}
[0,1,2,3,4,5,wideCamera].flatMap(i=>['ready','flight'].flatMap(stage=>[[1280,720],[390,740]].map(([w,h])=>({i,stage,w,h,...((({athleteVisible,panoramaVisible})=>({athleteVisible,panoramaVisible}))(capture(i,stage,w,h)))}))));
`,context);
console.log(cameras);
assert(cameras.every(camera=>camera.athleteVisible),'Skoczek powinien być widoczny w każdej kamerze');
assert(cameras.filter(camera=>camera.i===2).every(camera=>camera.panoramaVisible),'Panorama powinna pokazywać trasę');
const takeoffFrames=vm.runInContext(`(() => {
  const saved={...cameraSettings};
  init(0);start();action();
  while(s.state==='inrun'&&s.x < -4) simulate(step);
  const shots=[];
  for(const [w,h] of [[1280,720],[390,740]]) {
    width=w;height=h;
    for(const view of [0,1,3,wideCamera]) {
      Object.assign(cameraSettings,{view,angle:0,height:0,zoom:100});
      cameraReset=true;render(step);
      const forward=normalize(subtract(aim,eye)),right=normalize(cross(forward,[0,1,0])),up=cross(right,forward);
      const project=p=>{
        const delta=subtract(p,eye),depth=dot(delta,forward);
        return {x:shownCenterX+dot(delta,right)*shownFocal*h/(w*depth),y:shownCenterY-dot(delta,up)*shownFocal/depth,depth};
      };
      const jumper=project([s.x,s.y+.82,s.z]);
      const lip=project([0,ramp(0)+.04,0]);
      shots.push({view,w,jumper,lip,centerX:shownCenterX,focal:shownFocal});
    }
  }
  Object.assign(cameraSettings,saved);
  return shots;
})()`,context);
const inFrame=({x,y,depth})=>depth>.25&&x>.03&&x<.97&&y>.03&&y<.97;
assert(takeoffFrames.every(({jumper,lip,centerX})=>inFrame(jumper)&&inFrame(lip)&&centerX===.5),JSON.stringify(takeoffFrames));
assert([1280,390].every(w=>takeoffFrames.find(f=>f.view===7&&f.w===w).focal<takeoffFrames.find(f=>f.view===0&&f.w===w).focal));
events.keydown({code:'Digit2'});
assert.equal(document.getElementById('menu-camera-name').textContent,'Transmisja');
document.getElementById('camera').events.click();
assert(document.getElementById('panel').open);
document.getElementById('zoom').events.input({target:{value:'122'}});
document.getElementById('quality').events.change({target:{value:'2'}});
assert.deepEqual(JSON.parse(storage.get('podmuch-camera')),{view:1,zoom:122,height:0,angle:0,quality:2});
document.getElementById('camera-defaults').events.click();
assert.deepEqual(JSON.parse(storage.get('podmuch-camera')),{view:0,zoom:100,height:0,angle:0,quality:1});
document.getElementById('panel').open=false;
const transitions=vm.runInContext(`
function continuity(mode) {
  init(0);width=1280;height=720;cameraSettings.view=0;
  const values=actor=>{
    const pose=jumperPose(actor),goal=viewGoal(actor);
    return {pose:[...Object.keys(poses.tuck).map(key=>pose[key]).flat(),pose.angle],camera:[...goal.plannedEye,...goal.plannedAim],phase:actor.state};
  };
  let old=values(s);
  const boundaries=[];
  start();action();
  for(let i=0;i<4000&&s.state!=='result';i++){
    if(s.state==='inrun'&&secondsToLip(s)<=step&&s.takeoffX===undefined) action();
    if(mode==='fall'&&s.state==='flight') s.pitch=34;
    else steerFlight();
    if(mode==='telemark'&&s.state==='flight'&&s.landHint&&s.landingTime===null) action();
    simulate(step);
    const next=values(s);
    if(!next.pose.every(Number.isFinite)) throw new Error('Invalid joint');
    if(old.phase!==next.phase) {
      const delta=(a,b)=>Math.max(...a.map((v,k)=>Math.abs(v-b[k])));
      boundaries.push([old.phase,next.phase,delta(old.pose,next.pose),delta(old.camera,next.camera)]);
    }
    old=next;
  }
  return {result:s.landing,boundaries};
}
['telemark','both','fall'].map(continuity);
`,context);
console.log(JSON.stringify(transitions));
assert.deepEqual(Array.from(transitions,t=>t.result),['Telemark','Lądowanie obunóż','Upadek']);
for(const {boundaries} of transitions) {
  assert.equal(boundaries.length,4);
  assert(boundaries.every(([, ,jointDelta,cameraDelta])=>jointDelta<.044&&cameraDelta<.33),'Skok pozy albo kamery przy zmianie fazy');
}
const orbit=vm.runInContext(`
const testShots=[];
for (const phase of ['ready','flight','result']) {
  init(0);width=1280;height=720;
  if(phase!=='ready') {
    start();action();
    while(phase==='result'?s.state!=='result':s.x<61) {
      if(s.state==='inrun'&&secondsToLip(s)<=step&&s.takeoffX===undefined) action();
      if(s.state==='flight'&&s.landHint&&s.landingTime===null) action();
      simulate(step);
    }
  }
  for(const view of [0,1,2,3,4,5,wideCamera]) for(let yaw=-180;yaw<=180;yaw+=10) {
    cameraSettings.view=view;cameraSettings.angle=yaw;
    const {plannedEye,plannedAim,focal}=viewGoal();
    const d=subtract([s.x,s.y+.77,s.z],plannedEye);
    const f=normalize(subtract(plannedAim,plannedEye)),r=normalize(cross(f,[0,1,0])),u=cross(r,f);
    const z=dot(d,f),cx=.5+.07*gateCameraBlend(s)+dot(d,r)*focal*height/(z*width),cy=(view===0?.43:.46)-dot(d,u)*focal/z;
    testShots.push({phase,view,yaw,z,cx,cy});
  }
}
testShots;
`,context);
const outside=orbit.filter(({view,z,cx,cy})=>view!==2&&(z<=0||cx<0||cx>1||cy<0||cy>1));
assert.deepEqual(Array.from(outside),[],'Kamera śledząca powinna utrzymać skoczka w kadrze niezależnie od obrotu');
events.keydown({code:'KeyD'});
assert.equal(JSON.parse(storage.get('podmuch-camera')).angle,-165);
const stage=document.getElementById('stage'),canvas=document.getElementById('scene');
stage.events.pointerdown({button:0,target:canvas,pointerId:2,clientX:100,clientY:70});
assert.equal(canvas.captured,2);
stage.events.pointermove({pointerId:2,clientX:190,clientY:110});
stage.events.pointerup({pointerId:2});
const dragged=JSON.parse(storage.get('podmuch-camera'));
assert(Math.abs(dragged.angle-151.8)<.0001&&Math.abs(dragged.height-2.2)<.0001);
const angles=vm.runInContext(`
init(0);start();action();
while(s.state==='inrun') {
  if(secondsToLip(s)<=step&&s.takeoffX===undefined) action();
  simulate(step);
}
const samples=[];
while(s.state==='flight'){
  steerFlight();
  simulate(step);
  const age=s.tick-s.flightStart;
  if(age>1.15&&s.landCountdown>.82&&s.state==='flight') {
    const gust=flightGust(age),pose=airPose(s);
    samples.push({angle:(pose.angle-Math.atan2(s.vy,s.vx+s.wind+gust))*180/Math.PI,roll:pose.roll});
  }
}
samples;
`,context);
assert(angles.length>100);
assert(angles.every(sample=>sample.angle>24&&sample.angle<38));
assert(Math.max(...angles.map(s=>s.roll))-Math.min(...angles.map(s=>s.roll))>.020);
const venues=vm.runInContext(`
const generated=[...starterHills.slice(1),{id:'small-test',name:'Min',k:35,hs:45},{id:'large-test',name:'Max',k:223,hs:250}];
const venueResults=generated.map(hill=>{
  if(!validHill(hill)) throw Error('Błędna skocznia');
  prepareHill(hill);
  const simulated=run(0,true,true);
  return {...simulated,id:hill.id,k:hill.k,hs:hill.hs,speed:s.takeoffSpeed*3.6,
    expected:referenceInrunSpeed(hill)*3.6,xStart:initialX,xEnd:runoutEnd,
    kLine:distanceAtX(xAtDistance(hill.k)),hsLine:distanceAtX(xAtDistance(hill.hs))};
});
prepareHill(zakopane);
init(0);start();action();
while(secondsToLip(s)>step) simulate(step);
venueResults;
`,context);
assert(venues.every(x=>x.timing===1&&x.landing==='Telemark'&&x.distance>x.hs*.7&&x.distance<x.hs*1.18
  &&Math.abs(x.finalX-(x.xEnd-2.25))<.001&&Math.abs(x.hsLine-x.hs)<.002&&Math.abs(x.kLine-x.k)<.002),
  JSON.stringify(venues.map(({id,speed,distance,landing})=>({id,speed,distance,landing}))));
assert(venues.every(row=>Math.abs(row.speed-row.expected)<.5));
stage.events.mousedown({button:0,buttons:1,target:canvas});
assert.equal(vm.runInContext('s.timing',context),.5);
stage.events.mousedown({button:2,buttons:3,target:canvas});
assert.equal(vm.runInContext('s.timing',context),1);
vm.runInContext("while(s.state==='inrun')simulate(step);",context);
stage.events.pointermove({target:canvas,pointerId:8,pointerType:'mouse',movementY:-21});
assert(vm.runInContext('s.mousePitch>0',context));
for(let i=0;i<6;i++){
  stage.events.pointermove({target:canvas,pointerId:8,pointerType:'mouse',movementY:32});
  vm.runInContext('for(let j=0;j<5;j++) simulate(step)',context);
}
assert(vm.runInContext('Math.abs(s.pitch-idealFlightPitch)<3',context));
vm.runInContext("while(!s.landHint&&s.state==='flight')simulate(step);",context);
stage.events.mousedown({button:0,buttons:1,target:canvas});
assert.equal(vm.runInContext('s.landingStyle',context),'telemark');
stage.events.mousedown({button:2,buttons:3,target:canvas});
assert.equal(vm.runInContext('s.landingStyle',context),'both');
vm.runInContext("while(s.state!=='result')simulate(step);",context);
assert.equal(vm.runInContext('s.landing',context),'Lądowanie obunóż');
console.log('Mysz oraz skocznie HS45–250:',Array.from(venues,x=>[x.hs,x.distance]));
const el=id=>document.getElementById(id);
vm.runInContext('prepareHill(zakopane);run(0,true,true)',context);
const completed=vm.runInContext('s',context);
assert(completed.takeoffSpeed>20);
assert.equal(el('speed').textContent,Math.round(completed.takeoffSpeed*3.6)+' km/h');
assert(vm.runInContext(`
  const a=exitSequence(s,true),b=exitSequence(s,false);
  a.time=a.duration;b.time=b.duration;
  const winner=exitActor(s,a),departed=exitActor(s,b);
  winner.onPodium&&!winner.hidden&&departed.hidden&&!departed.onPodium&&winner.z<departed.z
`,context));
assert.equal(completed.judgeMarks.length,5);
assert.deepEqual(Array.from(completed.judgeMarks,m=>m.code),['AUT','NOR','SLO','GER','SUI']);
assert.equal(completed.judgeMarks.filter(m=>m.excluded).length,2);
assert(completed.judgeMarks.every(m=>m.score>=0&&m.score<=20&&Number.isInteger(m.score*2)));
assert.equal(completed.stylePoints,completed.judgeMarks.filter(m=>!m.excluded).reduce((sum,m)=>sum+m.score,0));
assert.equal(completed.points,Math.round((completed.distancePoints+completed.stylePoints)*10)/10);
for(const code of ['AUT','NOR','SLO','GER','SUI']) assert(el('judges').innerHTML.includes('data-flag="'+code+'"'));
assert.equal((el('judges').innerHTML.match(/tv-judge excluded/g)||[]).length,2);
assert.equal(el('result-flag').dataset.flag,'POL');
assert.equal(el('stage').dataset.broadcast,'result');
assert.equal(el('watch-replay').hidden,false);
assert(vm.runInContext("recordFaces.length>12&&Math.abs(distanceAtX(xAtDistance(best))-best)<.001",context));
const savedResult=el('distance').textContent;
const savedRecord=storage.get('podmuch-record-zakopane');
el('watch-replay').events.click();
assert.equal(el('stage').dataset.broadcast,undefined);
assert.equal(el('result').hidden,true);
assert.equal(el('replay-panel').hidden,false);
assert.equal(vm.runInContext('replay.actor.state',context),'inrun');
el('replay-rate').events.change({target:{value:'.25'}});
vm.runInContext('last=100;frame(150)',context);
assert(Math.abs(vm.runInContext('replay.time',context)-.0125)<1e-9);
el('replay-takeoff').events.click();
assert(el('replay-phase').textContent.includes('Wybicie 100%'));
assert(vm.runInContext('replay.time===s.takeoffTime&&!replay.playing',context));
el('replay-landing').events.click();
assert(vm.runInContext('replay.actor.state==="outrun"&&replay.actor.x===s.touchdownX',context));
assert(el('replay-phase').textContent.includes('Telemark'));
el('replay-seek').events.input({target:{value:'.36'}});
assert.equal(vm.runInContext('replay.actor.tick',context),.36);
el('replay-close').events.click();
assert.equal(el('stage').dataset.broadcast,'result');
assert.equal(el('result').hidden,false);
assert.equal(el('distance').textContent,savedResult);
assert.equal(storage.get('podmuch-record-zakopane'),savedRecord);
vm.runInContext("prepareHill({id:'new-record-test',name:'Nowa skocznia',k:90,hs:105});",context);
assert.equal(vm.runInContext('recordFaces.length',context),0);
vm.runInContext("run(0,false,true); prepareHill(zakopane)",context);
assert.equal(storage.get('podmuch-record-zakopane'),savedRecord);
assert(vm.runInContext('best===JSON.parse(localStorage.getItem("podmuch-record-zakopane"))&&recordFaces.length>12',context));
assert.equal(vm.runInContext('conditionMode.day+" "+conditionMode.weather',context),'mixed mixed');
assert(vm.runInContext('const initialConditions={...conditions}; init(); conditions.day!==initialConditions.day&&conditions.weather!==initialConditions.weather',context));
el('conditions').events.click();
el('condition-day').events.change({target:{value:'night'}});
el('condition-weather').events.change({target:{value:'snow'}});
assert.equal(el('snow-screen').hidden,false);
vm.runInContext('drawSnow(1)',context);
assert(snowLines.length>120);
const firstSnow=JSON.stringify(snowLines);
vm.runInContext('drawSnow(1.04)',context);
assert.notEqual(firstSnow,JSON.stringify(snowLines));
el('condition-weather').events.change({target:{value:'clear'}});
assert.equal(el('snow-screen').hidden,true);
assert.equal(JSON.parse(storage.get('podmuch-conditions')).weather,'clear');
el('panel').close();
assert(vm.runInContext("init();conditions.day==='night'&&conditions.weather==='clear'",context));
vm.runInContext('init(0); frame(1000)',context);
el('start').events.click({timeStamp:1010});
assert.equal(el('start-seconds').textContent,'10 s');
assert.equal(el('start-signal').hidden,false);
assert.equal(el('broadcast-start').hidden,false);
assert.equal(el('stage').dataset.broadcast,'start');
assert.equal(el('start-flag').dataset.flag,'POL');
assert.equal(el('hud').dataset.phase,'waiting');
assert.equal(el('takeoff-result').hidden,true);
assert.equal(el('track').hidden,true);
vm.runInContext('frame(5000)',context);
assert.equal(el('start-seconds').textContent,'7 s');
assert(vm.runInContext("s.state==='waiting'&&s.x===initialX&&s.v===0&&s.wind!==s.baseWind",context));
vm.runInContext('frame(11009)',context);
assert.equal(el('start-seconds').textContent,'1 s');
vm.runInContext('frame(11010)',context);
assert(vm.runInContext("s.state==='inrun'&&s.x===initialX",context));
assert.equal(el('start-signal').hidden,true);
assert.equal(el('broadcast-start').hidden,true);
assert.equal(el('stage').dataset.broadcast,undefined);

vm.runInContext('init(0)',context);
el('start').events.click();
stage.events.mousedown({button:0,buttons:1,target:canvas});
assert.equal(vm.runInContext('s.state',context),'inrun');
assert.equal(el('hud').dataset.phase,'inrun');
assert.equal(el('track').hidden,true);
vm.runInContext("while(secondsToLip(s)>step) simulate(step)",context);
stage.events.mousedown({button:0,buttons:1,target:canvas});
assert.equal(vm.runInContext('s.timing',context),.5);
assert.equal(el('takeoff-result').hidden,true);
vm.runInContext("while(s.state==='inrun') simulate(step)",context);
assert.equal(el('takeoff-result').textContent,'Wybicie · 50%');
assert.equal(el('takeoff-result').hidden,false);
vm.runInContext("while(s.state==='flight')simulate(step)",context);
assert.equal(el('hud').hidden,true);
assert.equal(el('touch').hidden,true);
const approachPerfectWindow="init(0); start(); action(); while(secondsToLip(s)>perfectTakeoffWindow) simulate(step); last=0";
vm.runInContext(approachPerfectWindow,context);
assert(vm.runInContext('secondsToLip(s)>step',context));
events.keydown({code:'Space',repeat:false,target:canvas,preventDefault(){}});
assert.equal(vm.runInContext('s.timing',context),1);
vm.runInContext(approachPerfectWindow,context);
stage.events.mousedown({button:0,buttons:1,target:canvas});
assert.equal(vm.runInContext('s.timing',context),.5);
stage.events.mousedown({button:2,buttons:3,target:canvas});
assert.equal(vm.runInContext('s.timing',context),1);
assert(vm.runInContext(`takeoffScore(.025)===1&&takeoffScore(.026)<1&&takeoffScore(.08)<.8
  &&takeoffScore(-.01)>.88&&takeoffScore(-.01)<.90&&takeoffScore(-.14)===0`,context));

events.keydown({code:'Digit6'});
assert.equal(el('menu-camera-name').textContent,'Z góry');
events.keydown({code:'KeyC'});
assert.equal(el('menu-camera-name').textContent,'Strefa wyników');
events.keydown({code:'KeyC'});
assert.equal(el('menu-camera-name').textContent,'Szerokie ujęcie');
events.keydown({code:'Digit1'});
events.keydown({code:'Digit8'});
assert.equal(el('menu-camera-name').textContent,'Szerokie ujęcie');
events.keydown({code:'KeyC'});
assert.equal(el('menu-camera-name').textContent,'Za skoczkiem');
let wheels=0;
const wheel=deltaY=>stage.events.wheel({target:canvas,deltaY,preventDefault(){wheels++;}});
const getZoom=()=>JSON.parse(storage.get('podmuch-camera')).zoom;
wheel(120);
assert(getZoom()<100);
for(let i=0;i<12;i++) wheel(120);
assert.equal(getZoom(),28);
wheel(-120);
assert(getZoom()>28);
assert.equal(wheels,14);
vm.runInContext('init(0);cameraSettings.zoom=100;cameraSettings.angle=178;cameraReset=true;render(step)',context);
wheel(120);
const cameraMotion=vm.runInContext(`
  const before=shownFocal;
  render(step);
  const first=shownFocal,firstZoom=framing.zoom;
  const zoomTarget=cameraSettings.zoom;
  rotateCamera(5);
  render(step);
  const firstTurn=framing.angle;
  for(let i=0;i<115;i++) render(step);
  ({before,first,firstZoom,zoomTarget,firstTurn,after:shownFocal,settledZoom:framing.zoom,settledAngle:framing.angle})
`,context);
assert(cameraMotion.before>cameraMotion.first&&cameraMotion.first>cameraMotion.after);
assert(cameraMotion.firstZoom<100&&cameraMotion.firstZoom>cameraMotion.zoomTarget);
assert(Math.abs(cameraMotion.settledZoom-cameraMotion.zoomTarget)<.001);
assert(cameraMotion.firstTurn>178&&Math.abs(cameraMotion.settledAngle-(-177))<.001);
const windTest=vm.runInContext(`
  const readings=[
    windReading({wind:1,windSide:0}),
    windReading({wind:1,windSide:0,yaw:Math.PI}),
    windReading({wind:0,windSide:1}),
    windReading({wind:0,windSide:-1})
  ];
  init(0,1.55);start();action();
  while(s.state==='inrun') {if(secondsToLip(s)<=step) action();simulate(step);}
  for(let i=0;i<160;i++) simulate(step);
  ({readings,z:s.z,rank:s.vz})
`,context);
assert.deepEqual(Array.from(windTest.readings,r=>r.direction),['Pod narty','W plecy','Z lewej','Z prawej']);
assert.equal(Math.abs(windTest.readings[0].skierAngle),0);
assert.equal(Math.abs(windTest.readings[1].skierAngle),180);
assert.equal(windTest.readings[2].skierAngle,-90);
assert.equal(windTest.readings[3].skierAngle,90);
assert(windTest.z>.35&&windTest.rank>.55);
const variants=vm.runInContext(`
  function brakeVariant(plow,sign) {
    init(0);start();action();
    while(s.state==='inrun') {if(secondsToLip(s)<=step) action();simulate(step);}
    while(s.state==='flight') simulate(step);
    Object.assign(s.runout,{turn:sign,sweep:2.25,destination:sign*2.6,brakeSide:sign,brakeRange:29,plow});
    let spread=0,yaw=0,previousZ=s.z,maxStep=0;
    while(s.state==='outrun') {
      simulate(step); const pose=jumperPose(s);
      spread=Math.min(pose.spread,spread);yaw=Math.max(yaw,Math.abs(s.yaw));
      maxStep=Math.max(maxStep,Math.abs(s.z-previousZ));previousZ=s.z;
    }
    return {spread,yaw,z:s.z,x:s.x,maxStep};
  }
  [brakeVariant(true,-1),brakeVariant(false,1)]
`,context);
assert(variants[0].spread<-.10&&variants[1].yaw>.60);
assert(variants[0].z<-2&&variants[1].z>2);
assert(variants.every(v=>v.maxStep<.05&&v.x===229.75));
const coachFlagCount=vm.runInContext("new Set(mesh.map(f=>f.motion?.flag).filter(f=>f&&f.pole[0]>-16&&f.pole[0]<-5)).size",context);
assert.equal(coachFlagCount,1);
vm.runInContext("run(0,true,true)",context);
el('show-venue').events.click();
assert.equal(el('menu-camera-name').textContent,'Strefa wyników');
assert(vm.runInContext("eventBoards.length===2&&eventScreenFaces.length>160&&Math.abs(viewGoal().plannedAim[0]-resultsVenue().x)<1",context));
assert(vm.runInContext("!mesh.some(f=>f.color==='#afc0cc'&&f.list[0][2]>0&&f.list.some(p=>p[0]>baseExitX-exitHalfGap&&p[0]<baseExitX+exitHalfGap))",context));

el('menu-hill').events.click();
el('new-hill-name').value='Dolina próbna';
el('new-k').value='105';el('new-hs').value='100';
el('new-hill').events.submit({preventDefault(){}});
assert(el('hill-error').textContent.includes('większe'));
el('new-k').value='85';el('new-hs').value='101';
el('new-inrun').value='tower';
el('new-hill').events.submit({preventDefault(){}});
const saved=JSON.parse(storage.get('podmuch-hills-v1'))[0];
assert.equal(saved.inrun,'tower');
assert(vm.runInContext('snowfield(-88*hillScale,0)<(baseSnowfield(-88,0)-25)*hillHeight',context));
assert.equal(JSON.parse(storage.get('podmuch-active-hill')),saved.id);
assert.equal(el('hill-details').textContent,'K85 / HS101');
vm.runInContext('run(0,true,true)',context);
const customBest=Number(storage.get('podmuch-record-'+saved.id));
el('menu-athlete').events.click();
el('athlete-name').value='Ada Nowak';
el('athlete-country').value='SLO';
el('color-helmet').events.input({target:{value:'#daf035'}});
el('athlete-form').events.submit({preventDefault(){}});
assert.equal(JSON.parse(storage.get('podmuch-athlete-v1')).helmet,'#daf035');
assert.equal(el('menu-athlete-name').textContent,'Ada Nowak');
el('menu-athlete').events.click();
el('athlete-roster').value='falcon';
el('athlete-roster').events.change();
assert.equal(el('athlete-name').value,'Sokół');
el('athlete-form').events.submit({preventDefault(){}});
assert.equal(el('menu-athlete-name').textContent,'Sokół');
assert.deepEqual(JSON.parse(storage.get('podmuch-athlete-v1')).roster.map(item=>item.name),['Ada Nowak','Sokół']);
el('menu-athlete').events.click();
el('athlete-roster').value='0';
el('athlete-roster').events.change();
el('athlete-form').events.submit({preventDefault(){}});
assert.equal(el('menu-athlete-name').textContent,'Ada Nowak');
assert.doesNotMatch(html,/id="(?:menu-wind|binding-style)"|data-wind-style=/);
const jointProgress=vm.runInContext(`(()=>{
  const measure=(press,power)=>{
    const base=poses.release;
    const pose=takeoffPose({tick:.090,extensionTime:press,takeoffTime:press,
      firstExtensionPower:power,timing:power},poses.tuck,.090);
    return ['knee','hip','shoulder','hand'].map(key=>
      Math.hypot(...pose[key].map((v,i)=>v-base[key][i]))/
      Math.hypot(...poses.extend[key].map((v,i)=>v-base[key][i])));
  };
  return [measure(0,1),measure(.075,.4)];
})()`,context);
const [onTime,late]=jointProgress;
assert(onTime.every((value,i)=>i===0||value<onTime[i-1]),'Legs should extend before the shoulder and hands');
assert(late.every((value,i)=>value<onTime[i]),'Late extension should remain visibly shorter');
const kneeAngles=vm.runInContext(`(()=>{
  init(0);start();action();
  const angles=actor=>{
    const rig={};skier(actor,rig);
    return ['L','R'].map(tag=>{
      const [hip,knee]=rig.joints['thigh'+tag];
      const ankle=rig.joints['shin'+tag][1];
      const cosine=dot(normalize(subtract(hip,knee)),normalize(subtract(ankle,knee)));
      return Math.acos(clamp(cosine,-1,1))*180/Math.PI;
    });
  };
  while(secondsToLip(s)>.037) simulate(step);
  action();
  const pressed=s.takeoffTime,live=angles(s);
  while(s.state==='inrun'||s.tick-s.lipTime<.12) {steerFlight();simulate(step);}
  return {live,atPress:angles(replayFrame(pressed)),atLip:angles(replayFrame(s.lipTime)),
    followThrough:angles(replayFrame(s.lipTime+.07))};
})()`,context);
console.log('Knee angles at takeoff',kneeAngles);
for(const pair of Object.values(kneeAngles)) assert(pair.every(angle=>angle>=170),'Straight knees at takeoff');
const liftOff=vm.runInContext(`[0,.045,.15].map(delay=>{
  init(0);start();action();
  while(s.state==='inrun') {
    if(delay===0&&secondsToLip(s)<=step&&s.takeoffTime===undefined) action();
    simulate(step);
  }
  while(s.tick<s.lipTime+.13) {
    if(delay>0&&s.tick>=s.lipTime+delay&&s.takeoffTime===undefined) action();
    simulate(step);
  }
  const lip=replayFrame(s.lipTime),air=replayFrame(s.lipTime+.12);
  const hop=(air.y-lip.y)*Math.cos(s.takeoffAngle)-(air.x-lip.x)*Math.sin(s.takeoffAngle);
  const exactLip=recording.frames.some(frame=>frame.tick===s.lipTime);
  const frames=recording.frames.length;
  const ticks=Math.round(s.tick/step);
  while(s.state==='flight') {steerFlight();simulate(step);}
  const landing=replayFrame(s.outStart);
  return {lipX:lip.x,hop,timing:s.timing,exactLip,frames,ticks,
    exactLanding:landing.state==='outrun'&&landing.x===s.touchdownX&&landing.tick===s.outStart};
})`,context);
console.log('Rise above the extended takeoff table',liftOff);
assert(liftOff.every(jump=>Math.abs(jump.lipX)<1e-9),'Replay should contain the actual lip crossing');
assert(liftOff.every(jump=>jump.exactLip&&jump.exactLanding&&jump.frames<.65*jump.ticks));
assert(liftOff[0].hop>.32&&liftOff[0].hop<.65);
assert(liftOff[0].hop>liftOff[1].hop&&liftOff[1].hop>liftOff[2].hop);
const touches=vm.runInContext(`['telemark','both'].map(style=>{
  const tap=id=>{
    const button=$(id);
    button.events.pointerdown({button:0,timeStamp:0,preventDefault(){}});
    button.events.click({detail:1,timeStamp:0});
  };
  document.getElementById('panel').open=false;
  init(0);start();tap('action');
  while(s.state==='inrun'&&secondsToLip(s)>step) simulate(step);
  tap('action');
  while(s.state==='inrun') simulate(step);
  const pitch=s.pitch;
  const press={button:0,pointerId:3,preventDefault(){}};
  $('lower').events.pointerdown(press);
  simulate(step);
  const lowered=s.pitch<pitch;
  $('lower').events.pointercancel(press);
  const released=s.pitch;
  simulate(step);
  const sensitiveRelease=s.pitch===released;
  while(s.state==='flight'&&!s.landHint) {steerFlight();simulate(step);}
  updateHUD();
  tap(style==='both'?'land-both':'action');
  return {style,lowered,sensitiveRelease,timing:s.timing,landingTime:s.landingTime,landingStyle:s.landingStyle,state:s.state};
})`,context);
assert(touches.every(t=>t.lowered&&t.sensitiveRelease&&t.timing===1&&t.landingTime!==null&&t.landingStyle===t.style),
  JSON.stringify(touches));

(async()=>{
  await vm.runInContext(`window.DeviceOrientationEvent={requestPermission:async()=>'denied'};toggleTilt()`,context);
  assert.equal(vm.runInContext('tilt.status',context),'denied');
  await vm.runInContext(`window.DeviceOrientationEvent.requestPermission=async()=>'granted';toggleTilt()`,context);
  try {
    assert.equal(typeof events.deviceorientation,'function');
    for(const orientation of [
      {angle:0,neutral:{beta:55,gamma:0},fold:{beta:40,gamma:0}},
      {angle:90,neutral:{beta:0,gamma:-55},fold:{beta:0,gamma:-40}},
      {angle:270,neutral:{beta:0,gamma:55},fold:{beta:0,gamma:40}}
    ]) {
      context.window.screen={orientation:{angle:orientation.angle}};
      events.deviceorientation(orientation.neutral);
      assert.equal(vm.runInContext('tiltSteering(.1)',context),0);
      events.deviceorientation(orientation.fold);
      assert(vm.runInContext('tiltSteering(.2)<-10',context));
    }
    assert(vm.runInContext('tilt.stamp-=600;tiltSteering(.01)===0',context),'Stale sensor releases steering');
  } finally {
    await vm.runInContext('toggleTilt()',context);
  }
  assert.equal(events.deviceorientation,undefined);
  console.log('Sterowanie dotykowe i przechył w pionie oraz obu orientacjach poziomych.');
  const oldProfile=JSON.parse(storage.get('podmuch-athlete-v1'));
  storage.set('podmuch-athlete-v1',JSON.stringify({...oldProfile,bindingStyle:'guide',
    roster:oldProfile.roster.map(profile=>({...profile,bindingStyle:'strap'}))}));
  storage.set('podmuch-controls-v1',JSON.stringify({mouse:false,windStyle:'split'}));
  const reload=vm.createContext({document,window:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val)},requestAnimationFrame(){},devicePixelRatio:1,console});
  vm.runInContext(script,reload);
  assert.equal(vm.runInContext('activeHill.hs',reload),101);
  assert.equal(vm.runInContext('activeHill.inrun',reload),'tower');
  assert.equal(vm.runInContext('best',reload),customBest);
  assert(vm.runInContext('recordFaces.length>12',reload));
  assert.equal(vm.runInContext('athlete.name',reload),'Ada Nowak');
  assert.equal(vm.runInContext('athlete.country',reload),'SLO');
  assert.equal(vm.runInContext('athleteRoster[1].name',reload),'Sokół');
  assert(vm.runInContext(`controls.mouse===false&&controls.windStyle===undefined&&
    athlete.bindingStyle===undefined&&athleteRoster.every(profile=>profile.bindingStyle===undefined)`,reload));
})().catch(error=>{console.error(error);process.exitCode=1;});
if (process.argv.includes('--render')) {
  const {render}=require('./podmuch-raster.cjs');
  for(const [i,stage] of [[0,'ready'],[1,'flight'],[2,'ready']]) {
    const shot=vm.runInContext(`capture(${i},'${stage}',1100,630)`,context);
    fs.writeFileSync(`work/podmuch-camera-${i+1}.png`,render(shot,1100,630));
  }
}
