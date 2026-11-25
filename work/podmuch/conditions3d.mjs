import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, ConeGeometry, DataTexture, DoubleSide, DynamicDrawUsage,
  FogExp2, LinearFilter, Mesh, Points, RGBAFormat, ShaderMaterial, SpotLight, Sprite, SpriteMaterial, Vector3, Vector4
} from 'three';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const ease=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

const times={
  dawn:{sun:[.85,.22,-.46],horizon:[.81,.39,.23],zenith:[.045,.15,.34],low:[.19,.24,.38],
    cloud:[.96,.52,.34],glare:[1,.40,.15],fog:0xbcb0b4,ambient:0xb6c7ee,ground:0x75829e,
    direct:0xffbd85,key:2.34,hemi:1.22,fill:.42,exposure:1.08,disc:3.4,night:0},
  day:{sun:[-.48,.82,-.33],horizon:[.36,.58,.83],zenith:[.030,.18,.46],low:[.21,.32,.45],
    cloud:[.96,1.02,1.08],glare:[.64,.43,.25],fog:0xa7c6db,ambient:0xc7e1ff,ground:0x7b8fa4,
    direct:0xffefd9,key:2.96,hemi:1.54,fill:.35,exposure:1.02,disc:5.0,night:0},
  sunset:{sun:[.82,.15,.55],horizon:[.90,.31,.18],zenith:[.060,.105,.30],low:[.22,.20,.30],
    cloud:[1,.48,.33],glare:[1,.31,.13],fog:0xc4a6ae,ambient:0xa6b7e0,ground:0x79758b,
    direct:0xffa76d,key:2.65,hemi:1.12,fill:.44,exposure:1.13,disc:4.1,night:0},
  night:{sun:[.69,.48,.50],horizon:[.023,.051,.105],zenith:[.003,.010,.041],low:[.011,.021,.046],
    cloud:[.026,.047,.090],glare:[.052,.087,.17],fog:0x273a58,ambient:0x9bb4dc,ground:0x405173,
    direct:0xb4cbff,key:.39,hemi:.50,fill:.25,exposure:1.15,disc:1.38,night:1}
};
const weather={
  clear:{cover:.16,fog:.00113,haze:0,key:1,diffuse:0},
  overcast:{cover:.84,fog:.00182,haze:.24,key:.42,diffuse:.30},
  snow:{cover:.92,fog:.0052,haze:.61,key:.32,diffuse:.33},
  fog:{cover:.72,fog:.0145,haze:.81,key:.35,diffuse:.24}
};

function glowTexture() {
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const dist=Math.hypot(x-(size-1)/2,y-(size-1)/2)/(size/2);
    const alpha=(.50*Math.exp(-dist*dist*36)+.32*Math.exp(-dist*dist*9)+.18*Math.exp(-dist*dist*2.6))*(1-ease(.52,1,dist));
    const i=(y*size+x)*4;
    data.set([255,255,255,Math.round(alpha*255)],i);
  }
  const texture=new DataTexture(data,size,size,RGBAFormat);
  texture.minFilter=texture.magFilter=LinearFilter;
  texture.needsUpdate=true;
  return texture;
}

export function makeConditions(scene,lamps,renderer,sky,reflectedSky,environment) {
  const sun=new Vector3(),weatherTint=new Color(),fogHue=new Color();
  let selected='',current=times.day,currentWeather=weather.clear;
  const lens=glowTexture();
  const beamGeometry=new ConeGeometry(1,1,24,1,true);
  const up=new Vector3(0,1,0),axis=new Vector3();
  const banks=lamps.map(({source,target},index)=>{
    const lamp=new SpotLight(index%2?0xffe2c1:0xd2e6ff,0,index<4?85:113,index===0?.52:.60,.73,1.44);
    lamp.position.fromArray(source);
    lamp.target.position.fromArray(target);
    lamp.visible=false;
    scene.add(lamp,lamp.target);
    const halo=new Sprite(new SpriteMaterial({
      map:lens,color:lamp.color,transparent:true,depthWrite:false,blending:AdditiveBlending,fog:false
    }));
    halo.position.fromArray(source);
    halo.scale.set(2.3,2.3,1);
    halo.visible=false;
    scene.add(halo);
    const bulb=new Sprite(new SpriteMaterial({map:lens,color:0xfff5e9,transparent:true,depthWrite:false,
      blending:AdditiveBlending,toneMapped:false,fog:false}));
    bulb.position.fromArray(source);
    bulb.scale.set(.88,.52,1);
    bulb.visible=false;
    scene.add(bulb);
    const beam=new Mesh(beamGeometry,new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,forceSinglePass:true,blending:AdditiveBlending,
      uniforms:{strength:{value:0},tint:{value:lamp.color}},
      vertexShader:`
        varying float height,edge;
        void main(){
          vec4 point=modelViewMatrix*vec4(position,1.0);
          edge=abs(dot(normalize(normalMatrix*normal),normalize(point.xyz)));
          height=uv.y;
          gl_Position=projectionMatrix*point;
        }`,
      fragmentShader:`
        varying float height,edge;
        uniform float strength;
        uniform vec3 tint;
        void main(){
          float fade=smoothstep(.0,.46,height)*(1.0-smoothstep(.91,1.0,height));
          gl_FragColor=vec4(tint,fade*smoothstep(.05,.79,edge)*strength);
          #include <colorspace_fragment>
        }`
    }));
    beam.visible=false;
    scene.add(beam);
    const glow={position:new Vector3(),color:lamp.color,radius:.45};
    return {lamp,halo,bulb,beam,glow};
  });
  function aimBeam({lamp,beam,glow}) {
    axis.subVectors(lamp.position,lamp.target.position);
    const length=Math.min(88,axis.length());
    axis.normalize();
    glow.position.copy(lamp.position).addScaledVector(axis,-.30);
    beam.scale.set(length*.32,length,length*.32);
    beam.quaternion.setFromUnitVectors(up,axis);
    beam.position.copy(lamp.position).addScaledVector(axis,-length/2);
  }
  banks.forEach(aimBeam);
  scene.fog=new FogExp2(0xa7c6db,.00113);
  function apply(selection,key,hemi,fill) {
    const id=selection.day+'-'+selection.weather;
    if(id===selected) return;
    selected=id;
    current=times[selection.day]||times.day;
    currentWeather=weather[selection.weather]||weather.clear;
    sun.fromArray(current.sun).normalize();
    const {cover,haze,diffuse}=currentWeather;
    for(const target of [sky,reflectedSky]) {
      const u=target.material.uniforms;
      u.sun.value.copy(sun);
      for(const name of ['horizon','zenith','low','cloud','glare']) u[name].value.fromArray(current[name]);
      u.cover.value=cover;
      u.night.value=current.night;
      u.disc.value=current.disc*(1-cover*.81);
    }
    renderer.toneMappingExposure=current.exposure;
    key.color.set(current.direct);
    key.intensity=current.key*currentWeather.key;
    key.shadow.intensity=mix(.77,.33,cover);
    key.shadow.normalBias=current.night?.062:.040;
    key.shadow.radius=1+cover*4;
    hemi.color.set(current.ambient);
    hemi.groundColor.set(current.ground);
    hemi.intensity=current.hemi+diffuse;
    fill.intensity=current.fill+diffuse*.19;
    fogHue.set(current.fog);
    weatherTint.set(current.night?0x354761:0xc2d0db);
    scene.fog.color.copy(fogHue).lerp(weatherTint,haze);
    scene.fog.density=currentWeather.fog;
    for(let i=0;i<banks.length;i++) {
      const {lamp,halo,bulb,beam}=banks[i];
      lamp.visible=halo.visible=bulb.visible=beam.visible=current.night===1;
      lamp.intensity=i===0?395:i<4?520:i<6?880:1250;
      halo.scale.setScalar(5.2+haze*6.0);
      halo.material.opacity=.51+haze*.29;
      bulb.material.opacity=.98;
      beam.material.uniforms.strength.value=.018+haze*.145;
    }
    environment();
  }
  return {apply,sun,bloomSources:banks.map(bank=>bank.glow),setLamps(positions) {
    for(const [i,{source,target}] of positions.entries()) {
      const {lamp,halo,bulb}=banks[i];
      lamp.position.fromArray(source);lamp.target.position.fromArray(target);
      halo.position.fromArray(source);bulb.position.fromArray(source);
      aimBeam(banks[i]);
    }
  },get darkness(){return current.night;}};
}

function seeded(n) {
  const v=Math.sin((n+71.2)*78.233)*43758.5453;
  return v-Math.floor(v);
}

const snowFragment=`
  varying float visibleAmount;
  uniform vec3 tint;
  void main() {
    vec2 p=(gl_PointCoord-.5)*2.0;
    float rad=dot(p,p);
    float a=(1.0-smoothstep(.03,1.0,rad))*visibleAmount;
    if(a<.018) discard;
    gl_FragColor=vec4(tint,a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function flurries(lamps) {
  const count=1280,values=new Float32Array(count*3);
  for(let i=0;i<values.length;i++) values[i]=seeded(i);
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(values,3));
  const lights=lamps.map(()=>new Vector3()),directions=lamps.map(()=>new Vector3());
  const uniforms={clock:{value:new Vector4()},origin:{value:new Vector3()},tint:{value:new Color(0xeaf6ff)},
    lights:{value:lights},directions:{value:directions},dark:{value:0}};
  function setLamps(positions) {
    positions.forEach(({source,target},i)=>{
      lights[i].fromArray(source);
      directions[i].fromArray(target).sub(lights[i]).normalize();
    });
  }
  setLamps(lamps);
  const material=new ShaderMaterial({uniforms,transparent:true,depthWrite:false,
    vertexShader:`
      uniform vec4 clock;
      uniform vec3 origin;
      uniform vec3 lights[${lamps.length}],directions[${lamps.length}];
      uniform float dark;
      varying float visibleAmount,illuminated;
      void main() {
        vec3 volume=vec3(56.0,27.0,46.0);
        float s=.44+position.z*.94;
        vec3 stepWind=clock.x*vec3(-clock.y*(.48+s*.40),-s,clock.w*(.55+s*.40)+position.x*.43);
        vec3 p=mod(position*volume+stepWind-origin+volume*.5,volume)-volume*.5;
        p.x+=sin(clock.x*1.82+position.y*105.0)*.52;
        p.z+=cos(clock.x+position.z*94.0)*.59;
        vec4 mv=viewMatrix*vec4(origin+p,1.0);
        float depth=-mv.z;
        float edge=max(max(abs(p.x)/28.0,abs(p.y)/13.5),abs(p.z)/23.0);
        visibleAmount=(1.0-smoothstep(.76,1.0,edge))*smoothstep(.65,2.2,depth)
          *(1.0-smoothstep(14.0,28.0,depth))*(.35+position.y*.56);
        illuminated=0.0;
        if(dark>.5) {
          for(int i=0;i<${lamps.length};i++){
            vec3 fromLight=origin+p-lights[i];
            float len=max(length(fromLight),.1);
            float cone=smoothstep(.82,.96,dot(fromLight/len,directions[i]));
            illuminated=max(illuminated,cone*(1.0-smoothstep(24.0,86.0,len)));
          }
          visibleAmount*=.33+illuminated*1.94;
        }
        gl_PointSize=clamp((.024+position.z*.047)*clock.z/max(depth,.5),1.4,14.0);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader:'varying float illuminated;\n'+snowFragment.replace(
      'vec4(tint,a)','vec4(mix(tint,vec3(1.30,1.27,1.23),illuminated*.86),a)'
    )
  });
  const object=new Points(geometry,material);
  object.frustumCulled=false;
  object.visible=false;
  return {object,setLamps,update(view,actor,settings,time,ratio,darkness) {
    object.visible=settings.weather==='snow';
    if(!object.visible) return;
    geometry.setDrawRange(0,settings.quality===2?count:settings.quality===1?870:485);
    uniforms.origin.value.fromArray(view.eye);
    uniforms.clock.value.set(time,actor.wind,view.focal*ratio,actor.windSide);
    uniforms.tint.value.set(darkness?0xc6dff7:0xf2f7ff);
    uniforms.dark.value=darkness;
  }};
}

const powderSamples=Array.from({length:145},(_,i)=>({
  delay:seeded(i*5)*.18,back:2.6+seeded(i*5+1)*5.6,side:(seeded(i*5+2)-.5)*6.5,
  lift:.82+seeded(i*5+3)*3.2,size:.028+seeded(i*5+4)*.103
}));
function spray(terrain) {
  const positions=new Float32Array(powderSamples.length*3),visuals=new Float32Array(powderSamples.length*2);
  const geometry=new BufferGeometry();
  const position=new BufferAttribute(positions,3).setUsage(DynamicDrawUsage);
  const visual=new BufferAttribute(visuals,2).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position',position);
  geometry.setAttribute('flake',visual);
  const uniforms={focal:{value:800},tint:{value:new Color(0xebf3ff)}};
  const material=new ShaderMaterial({uniforms,transparent:true,depthWrite:false,
    vertexShader:`
      attribute vec2 flake;
      uniform float focal;
      varying float visibleAmount;
      void main() {
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=clamp(flake.x*focal/max(.35,-mv.z),1.0,32.0);
        visibleAmount=flake.y;
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader:snowFragment
  });
  const object=new Points(geometry,material);
  object.frustumCulled=false;
  object.visible=false;
  return {object,update(view,actor,settings,ratio,darkness) {
    const down=actor.outStart!==undefined,from=down?actor.outStart:actor.flightStart;
    const age=actor.tick-from;
    const braking=down&&actor.brake>.07&&age>1.1;
    object.visible=braking||(Number.isFinite(age)&&age>=0&&age<(down?.94:.42));
    if(!object.visible) return;
    const max=down?(settings.quality===2?145:settings.quality===1?102:61):29;
    const weight=actor.landing==='Upadek'?1.42:1;
    let count=0;
    for(let i=0;i<max;i++) {
      const sample=powderSamples[i],life=(braking?.23:down?.41:.25)+sample.size*2.8;
      const t=braking?(actor.tick*.63+sample.delay*9.4)%life:age-sample.delay*(down?1:.43);
      if(t<=0||t>=life) continue;
      const decay=ease(0,.035,t)*(1-ease(life*.25,life,t));
      const blade=i%2?1:-1;
      const yaw=actor.yaw||0,tail=-.26-sample.delay*2;
      const edgeX=tail*Math.cos(yaw)-blade*.30*Math.sin(yaw);
      const edgeZ=tail*Math.sin(yaw)+blade*.30*Math.cos(yaw);
      const x=braking?actor.x+edgeX-t*(actor.v*.49+sample.back):down?actor.touchdownX-.38+t*(actor.vx*.49-sample.back):-.45-t*(sample.back+3.7);
      const lift=Math.max(0,t*sample.lift*weight-4.8*t*t)*(braking?.58:down?1:.48);
      const y=(down?terrain(x):.02-x*.183)+.055+lift;
      const fan=braking?(actor.runout?.plow?blade:Math.sign(actor.yaw)||1)*actor.brake*4.8:0;
      const z=(braking?actor.z+edgeZ:(down?actor.touchdownZ:0)+blade*.29)+t*(sample.side*(down?1:.47)+fan);
      positions.set([x,y,z],count*3);
      visuals.set([sample.size*(1+t*1.8),decay*(braking?.56*actor.brake:down?.51:.36)],count*2);
      count++;
    }
    geometry.setDrawRange(0,count);
    position.needsUpdate=visual.needsUpdate=true;
    uniforms.focal.value=view.focal*ratio;
    uniforms.tint.value.set(darkness?0xb9d1f2:0xf3f9ff);
  }};
}

export function makeParticles(scene,terrain,lamps) {
  const snow=flurries(lamps),powder=spray(terrain);
  scene.add(snow.object,powder.object);
  return {setLamps:snow.setLamps,update(view,actor,settings,time,ratio,darkness) {
    snow.update(view,actor,settings,time,ratio,darkness);
    powder.update(view,actor,settings,ratio,darkness);
  }};
}
