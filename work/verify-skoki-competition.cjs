const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('work/podmuch/dist/index.html', 'utf8');
const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
const elements = new Map();
const createElement = () => ({
  events: {}, style: {}, dataset: {}, clientWidth: 1280, clientHeight: 720,
  addEventListener(name, handler) { this.events[name] = handler; },
  getContext() { return null; }, setAttribute() {}, append(...children) { this.children.push(...children); }, focus() {},
  children: [], _text: '',
  set textContent(value) { this._text = value; this.children.length = 0; },
  get textContent() { return this._text; },
  showModal() { this.open = true; }, close() { this.open = false; }
});
const el = id => {
  if (!elements.has(id)) elements.set(id, createElement());
  return elements.get(id);
};
const storage = new Map();
const document = {getElementById: el, querySelector: () => el('game'), createElement};
// A minimal canvas context is enough because this test exercises controls and scoring.
el('scene').getContext = () => ({setTransform() {}});
const context = vm.createContext({document, window: {addEventListener() {}},
  localStorage: {getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v)},
  requestAnimationFrame() {}, devicePixelRatio: 1, console});
const run = source => vm.runInContext(source, context);
run(script);
run(`
  function complete(distance,fall=false,wind=0) {
    action();
    Object.assign(s,{distance,landing:fall?'Upadek':'Telemark',distancePoints:distancePoints(activeHill,distance),
      flightError:.16,flightLength:3.5,landingImpact:4,flightWind:wind*3.5,timing:1,
      takeoffLead:.015,takeoffTime:4.5,flightStart:4.51,outStart:8});
    finish();
  }
`);
const click = id => el(id).events.click({timeStamp: 20});
const next = () => click(el('panel').open&&el('panel').dataset.kind==='round-results'?'round-continue':
  run('!!cpuShow')?'cpu-skip':'again');
function finishCpu() {
  if(run("competition.next==='round'&&!cpuShow")) next();
  if(run('!!cpuShow&&!cpuShow.summary')) click('cpu-close');
}
const select = (value, trial) => {
  el('game-mode').events.change({target: {value}});
  el('trial-jump').events.change({target: {checked: trial}});
  click('start');
};
assert(html.includes('<title>SKOKI 2027</title>'));
assert.equal(run('metreValue(70)'), 2.2);
assert.equal(run('metreValue(135)'), 1.6);
assert.equal(run('distancePoints(zakopane,131)'), 70.8);
assert.equal(run('distancePoints({k:200},200)'), 120);
assert.equal(run('windCompensation(zakopane,1)'), -10.8);
assert.equal(run('windCompensation(zakopane,-1)'), 16.2);
assert.equal(run("targetDistance({wind:0,windTarget:{leader:117,previous:0}},zakopane)"),125.5);
assert.equal(run("targetDistance({wind:0,windTarget:{leader:240,previous:123}},zakopane)"),125.5);
assert.equal(run("targetDistance({wind:0,windTarget:{record:139}},zakopane)"),139.5);
assert(run("targetDistance({wind:1,windTarget:{leader:117,previous:0}})>targetDistance({wind:-1,windTarget:{leader:117,previous:0}})"));
assert(run(`(() => {
  const faces=[];
  drawLeadLine({wind:0,windTarget:{record:130}},faces);
  if(faces.length) return false;
  drawLeadLine({wind:0,windTarget:{leader:117,previous:0}},faces);
  const next=[];
  drawLeadLine({wind:0,windTarget:{leader:117,previous:0}},next);
  return faces.length>0&&faces[0]===next[0]&&faces.every(face=>face.color==='#1184e9');
})()`));
run('updateWind({wind:-1,windSide:0})');
assert.equal(el('wind-arrow').style.transform,'rotate(-180.0deg)');
run('updateWind({wind:1,windSide:0})');
assert.equal(el('wind-arrow').style.transform,'rotate(0.0deg)');
run('updateWind({wind:0,windSide:1})');
assert.equal(el('wind-arrow').style.transform,'rotate(-90.0deg)');
assert.equal(el('wind-picture').dataset.windFrom,undefined);
assert(run(`
  const koRows=Array.from({length:50},(_,i)=>({bib:i+1,points:i===0||i===49?80:i<25?210+i:100+i,
    distance:125,fall:false,windPoints:0}));
  const koCut=cutForFinal(koRows,{ko:true,entry:koRows,hill:zakopane});
  koCut.length===30&&koCut.some(row=>row.bib===50)&&!koCut.some(row=>row.bib===1)
`));

select('contest', true);
assert.equal(run('competition.stage'), 'trial');
run('complete(130)');
assert.equal(run('competition.history.length'), 0);
assert.equal(el('again-label').textContent, 'Do kwalifikacji');
click('again');
assert.equal(run('competition.stage'),'qual');
assert.equal(run('cpuShow?cpuActor().windTarget:s.windTarget'),null);
finishCpu();
run('complete(141)');
finishCpu();
assert.equal(run('competition.events[0].qual.length'),51);
assert(run('competition.events[0].entry.length>=50'));
assert.equal(el('panel').open,true);
assert.equal(el('panel-title').textContent,'Kwalifikacje');
assert.equal(el('competition-rows').children.length,51);
assert.equal(el('cpu-panel').hidden,true);
assert(run(`(() => {
  const draw=render,snow=drawSnow,wind=updateWind,time=cpuShow.time;
  let calls=0;
  try {
    render=drawSnow=updateWind=()=>{calls++;};
    frame(1000);
    return calls===0&&cpuShow.time===time;
  } finally {render=draw;drawSnow=snow;updateWind=wind;}
})()`));
next();
assert.equal(run('competition.stage'),'first');
const jumpsBeforePlayer = run('competition.order.findIndex(row=>row.human)');
finishCpu();
assert.equal(run('competition.jumps.size'),jumpsBeforePlayer);
const bibNumber=run('competition.events[0].qual.findIndex(row=>row.human)+1');
assert.equal(run('currentJumper().bibNumber'),bibNumber);
run('complete(141,false,1)');
assert.equal(run('s.windPoints'), -10.8);
assert.equal(run('roundResults(competition.order,competition.stage).length'),jumpsBeforePlayer+1);
const first = run('s.points');
finishCpu();
assert.equal(run('competition.next'), 'final');
assert.equal(el('panel-title').textContent,'1. seria');
next();
assert(run(`cpuShow.row.bib===competition.order[0].bib&&
  competition.order[0].points===Math.min(...competition.events[0].finalists.map(row=>row.points))`));
assert.equal(run('competition.jumps.size'),0);
click('cpu-close');
assert.equal(run('currentJumper().bibNumber'),bibNumber);
assert.equal(run('s.windTarget.previous'),first);
run('complete(143)');
finishCpu();
assert.equal(run('competition.events[0].result.find(row=>row.bib===0).points'), Math.round((first + run('s.points')) * 10) / 10);
assert.equal(el('panel-title').textContent,'Wyniki konkursu');
assert.equal(run('ceremony'),null);
click('round-podium');
assert.equal(el('panel').open,false);
click('podium-close');
assert.equal(el('panel').open,true);
assert.equal(el('panel-title').textContent,'Wyniki konkursu');
next();
assert.equal(run('competition'), null);

assert.equal(run('cupCalendar.length'),27);
assert.equal(run('podiumPrize([{place:1}],1)'),15000);
assert.equal(run('podiumPrize([{place:1},{place:1}],1)'),13250);
assert.equal(run('new Set(cupCalendar.map(row=>row.hill.id)).size'),17);
assert.equal(run("cupCalendar.find(row=>row.hill.id==='lahti').hill.hs"),100);
assert.equal(run("starterHills.find(row=>row.id==='lahti-duza').hs"),130);
for (const [mode, count] of [['cup', 27], ['tour', 4]]) {
  select(mode, true);
  for (let index = 0; index < count; index++) {
    assert.equal(run('competition.stage'), 'trial');
    assert.equal(run('currentJumper().yellowBib'),mode==='cup'&&index>0);
    run('complete(activeHill.hs-3)');
    assert.equal(run('competition.history.length'), index);
    click('again');
    const special = run('competition.events[competition.index].previousResults||competition.events[competition.index].seasonFinal');
    if(special) {
      assert.equal(run('competition.stage'),'first');
      if(run('competition.events[competition.index].previousResults')) {
        assert(run('competition.order.at(-1).bib===competition.history.at(-1).result[0].bib'));
      } else {
        assert(run('competition.order.length>=30&&competition.order.length<=34'));
      }
    } else {
      assert.equal(run('competition.stage'), 'qual');
      if(mode==='cup') {
        assert.equal(run('competition.order.length'),51);
        if(index===0) assert(run(`competition.order.every((row,i,order)=>i===0||
          competitionRandom(order[i-1].bib,'start-order')()<=competitionRandom(row.bib,'start-order')())`));
        else assert.equal(run('competition.order.at(-1).bib'),
          run(`(() => {
            const past=competition.history.filter(event=>isFlyingHill(event.hill));
            return competitionStandings(isFlyingHill(activeHill)&&past.length?past:competition.history)[0].bib;
          })()`));
        if(index===1) {
          assert.equal(run('competition.order.at(-1).bib'),0);
          assert.equal(el('cpu-panel').hidden,false);
          assert(run('Math.abs(cpuShow.takeoffSpeed-referenceInrunSpeed(activeHill))<.19'));
          const before=run('competition.jumps.size');
          run(`(() => {
            const draw=render;
            render=()=>{};
            try {
              cpuShow.time=cpuShow.approach+cpuShow.flight-.005;
              last=1000;frame(1020);
            } finally {render=draw;}
          })()`);
          assert.equal(run('competition.jumps.size'),before+1);
          click('cpu-skip');
          assert.equal(run('competition.jumps.size'),before+1);
        }
        finishCpu();
      }
      run('complete(activeHill.hs+20)');
      if(mode==='cup') finishCpu();
      assert(run('competition.events[competition.index].entry.length>=(isFlyingHill(activeHill)?40:50)'));
      if(mode==='cup'&&index===1) {
        assert.equal(el('panel-title').textContent,'Kwalifikacje');
        click('round-details');
        assert.equal(el('panel').open,false);
        assert.equal(el('result').hidden,false);
        click('competition-table');
        assert.equal(el('panel').open,true);
      }
      next();
    }
    assert.equal(run('competition.stage'), 'first');
    if(mode==='cup') {
      if(run('competition.events[competition.index].ko')) {
        assert(run(`(() => {
          const {entry}=competition.events[competition.index];
          return competition.order.every((row,i)=>row.bib===entry[i%2?24-Math.floor(i/2):25+Math.floor(i/2)].bib);
        })()`));
      }
      finishCpu();
    }
    if (index === 0) {
      assert.equal(run('competition.events[0].ko'),mode==='tour');
      assert(el('start-hill').textContent.includes('1. seria'));
    }
    run('complete(activeHill.hs+20)');
    if(mode==='cup') finishCpu();
    assert.equal(run('competition.next'), 'final');
    assert.equal(el('panel-title').textContent,'1. seria');
    assert(el('competition-rows').children.some(tr=>tr.className==='player'&&tr.children[1].textContent.includes('Awans')));
    next();
    if(mode==='cup') finishCpu();
    run('complete(activeHill.hs+20)');
    if(mode==='cup') finishCpu();
    assert.equal(run('competition.history.length'), index + 1);
    assert.equal(el('panel').open,true);
    click('round-podium');
    if(mode==='cup') assert(run('podiumActor(ceremony.medallists[0],0).appearance.yellowBib'));
    assert.equal(run('ceremony.medallists.length'),3);
    assert(run(`ceremony.medallists.every((row,i)=>{
      const rig={};const faces=skier(podiumActor(row,i),rig);
      const [hip,knee]=rig.joints.thighL,[,boot]=rig.joints.shinL;
      return Math.abs(hip[2]-knee[2])<.01&&Math.abs(hip[2]-boot[2])<.01&&faces.length>100&&row.prize>0;
    })`));
    assert(run("competition.events[competition.index].result[0].jumps.length===2"));
    click('podium-close');
    if (index + 1 < count) next();
  }
  const score = run('competitionStandings().find(row=>row.bib===0).points');
  const expected = run(`tenth(competition.history.reduce((sum,event)=>{
    const row=event.result.find(row=>row.bib===0);
    return sum+(competition.mode==='cup'?cupPoints[row.place-1]:row.points);
  },0))`);
  assert.equal(score, expected);
  assert(el('panel-body').innerHTML.includes('id="round-continue">Menu główne'));
  next();
  assert.equal(run('activeHill.id'), 'zakopane');
}

select('tour', false);
run('complete(30,true)');
assert.equal(run('competition.next'), 'event');
assert.equal(run('competition.history[0].result.some(row=>row.bib===0)'), false);
assert(el('competition-note').textContent.includes('Brak awansu'));
assert.equal(el('panel').open,true);
next();
assert.equal(run('activeHill.id'), 'garmisch');
click('return-menu');
assert.equal(run('activeHill.id'), 'zakopane');
run(`athleteRoster=[normalizeAthlete({name:'Gracz drugi',country:'AUT',suit:'#123456'})];cupGuestSlots.add(0);`);
el('cup-difficulty').events.change({target:{value:'hard'}});
assert.equal(JSON.parse(storage.get('podmuch-cup-difficulty')),'hard');
select('cup',true);
assert.equal(run('competition.roster.filter(row=>!row.human).length'),50);
assert.equal(run('new Set(competition.roster.filter(row=>!row.human).map(row=>row.name)).size'),50);
assert(run("competition.roster.some(row=>row.name==='Kacper Tomasiak'&&row.country==='POL')"));
assert.equal(run('competition.difficulty'),'hard');
const strength=run(`['easy','medium','hard'].map(level=>{
  competition.difficulty=level;
  return competition.roster.filter(row=>!row.human).reduce((sum,row)=>sum+simulatedJump(row,'qual',activeHill).points,0);
})`);
assert(strength[0]<strength[1]&&strength[1]<strength[2]);
run('complete(activeHill.hs)');
assert.equal(run('competition.next'),'player');
click('again');
assert.equal(el('start-athlete').textContent,'Gracz drugi');
run('complete(activeHill.hs)');
assert.equal(run('recording.athlete.suit'),'#123456');
click('again');
assert.equal(run('competition.stage'),'qual');
for(let i=0;i<2;i++) {
  finishCpu();
  run('complete(competition.active.bib===0?activeHill.hs+20:20,competition.active.bib===-1)');
}
finishCpu();
assert.equal(run('competition.events[0].qual.length'),52);
assert.equal(run('competition.next'),'first');
next();
finishCpu();
assert.equal(run('competition.active.bib'),0);
run('complete(activeHill.hs+20)');
finishCpu();
next();
finishCpu();
assert.equal(run('competition.stage'),'final');
run('complete(activeHill.hs+20)');
finishCpu();
assert.equal(run('competitionStandings().filter(row=>row.human).length'),2);
assert.equal(run("competitionStandings().find(row=>row.bib===-1).points"),0);
click('round-menu');
el('cup-difficulty').events.change({target:{value:'easy'}});
select('cup',false);
for(const stage of ['qual','first','final']) {
  assert.equal(run('competition.stage'),stage);
  for(let i=0;i<2;i++) {
    finishCpu();
    run('complete(activeHill.hs+(competition.active.bib===0?25:24))');
  }
  finishCpu();
  if(stage!=='final') next();
}
assert.equal(run('competition.history[0].result.filter(row=>row.human).length'),2);
assert(run('competitionStandings().filter(row=>row.human).every(row=>row.points>0)'));
click('round-menu');
const gateClearance = run(`
  [45,82,140,250].map(hs=>{
    prepareHill({id:'gate-test',name:'Test bramki',k:Math.round(hs*.89),hs});
    const venue=resultsVenue(),gateZ=venue.z+.26;
    const underside=venue.y+2.60*Math.max(.91,venue.prop)-.36*venue.prop;
    const openHalf=venue.gap-Math.min(.20*venue.prop,venue.gap*.24);
    let maxHeight=-Infinity,maxWidth=0,overlap=0;
    for(const side of [-1,1]) {
      const jumper={state:'result',x:runoutEnd-2.25,y:terrain(runoutEnd),z:side*2.6,yaw:side*.83,tick:15};
      const walk=exitSequence(jumper,true);
      updateFootprints(exitActor(jumper,walk),walk);
      if(walk.footprints.length) throw Error('Ślady przed rozpoczęciem chodu');
      for(let t=2.5;t<walk.duration;t+=.032) {
        walk.time=t;
        const actor=exitActor(jumper,walk);
        updateFootprints(actor,walk);
        if(Math.abs(actor.z-gateZ)>2.25) continue;
        for(const face of skier(actor,{})) for(const [x,y,z] of face.list) {
          if(z<gateZ-.065||z>gateZ+.41*venue.prop) continue;
          overlap++;
          maxHeight=Math.max(maxHeight,y-underside);
          maxWidth=Math.max(maxWidth,Math.abs(x-venue.x));
        }
      }
      const count=walk.footprints.length;
      updateFootprints(exitActor(jumper,walk),walk);
      if(count<2||walk.footprints.length!==count||walk.footprints.some(mark=>mark.list.flat().some(v=>!Number.isFinite(v)))) {
        throw Error('Nieprawidłowe ślady butów');
      }
    }
    return {hs,overlap,maxHeight,maxWidth,openHalf};
  })
`);
console.log('Prześwit nart pod bramkami:', gateClearance);
assert(gateClearance.every(gate=>gate.overlap>0&&gate.maxHeight<-.1&&gate.maxWidth<gate.openHalf+.015));
console.log('Puchar Świata o 27 etapach, przeglądanie skoków CPU, podium i pozostałe tryby.');
