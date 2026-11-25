import {
  ACESFilmicToneMapping, BackSide, BufferAttribute, BufferGeometry, Color, DataTexture,
  DirectionalLight, DoubleSide, DynamicDrawUsage, HemisphereLight, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh,
  MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PMREMGenerator, RepeatWrapping,
  RGBAFormat, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3, Vector4, WebGLRenderer
} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {unzlibSync} from 'three/addons/libs/fflate.module.js';
import {makeBroadcastEffects} from './broadcast3d.mjs';
import {makeConditions,makeParticles} from './conditions3d.mjs';

const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const lightDirection=new Vector3(-.48,.82,-.33).normalize();

function boneBasis(start,end,right,axis,across,out,turn=0) {
  axis.subVectors(end,start).normalize();
  across.set(-Math.sin(turn),0,Math.cos(turn));
  across.addScaledVector(axis,-across.dot(axis)).normalize();
  right.crossVectors(axis,across).normalize();
  return out.makeBasis(right,axis,across);
}

const restCoordinates=`varying vec3 podmuchRest;
  uniform vec3 podmuchSuit,podmuchLegs,podmuchHelmet,podmuchFlex;
  uniform vec2 podmuchBib;
  float inkBox(vec2 p,vec2 center,vec2 extent,float roundness) {
    vec2 q=abs(p-center)-extent+roundness;
    float sd=length(max(q,0.0))+min(max(q.x,q.y),0.0)-roundness;
    return 1.0-smoothstep(-max(fwidth(sd)*.70,.00045),max(fwidth(sd)*.70,.00045),sd);
  }
  float bibDigit(vec2 p,float digit) {
    float mask=digit<.5?63.0:digit<1.5?6.0:digit<2.5?91.0:digit<3.5?79.0:digit<4.5?102.0:
      digit<5.5?109.0:digit<6.5?125.0:digit<7.5?7.0:digit<8.5?127.0:111.0;
    float n=0.0;
    for(int i=0;i<7;i++) {
      float bit=mod(floor(mask/exp2(float(i))),2.0);
      bool horizontal=i==0||i==3||i==6;
      vec2 center=i==0?vec2(0,.048):i==3?vec2(0,-.048):i==6?vec2(0):
        vec2(i==1||i==2?.023:-.023,i==1||i==5?.024:-.024);
      vec2 extent=horizontal?vec2(.023,.008):vec2(.008,.023);
      n=max(n,bit*inkBox(p,center,extent,.003));
    }
    return n;
  }`;
const finishCode={
  cloth:`
    vec3 p=podmuchRest;
    float width=abs(p.z);
    float upper=smoothstep(.92,.98,p.y);
    vec3 base=mix(vec3(.008,.019,.040),vec3(.413,.017,.020),upper);
    vec3 tint=mix(podmuchLegs,podmuchSuit,upper);
    float pattern=.23+.77*clamp(dot(diffuseColor.rgb,vec3(.26,.56,.18))/max(.004,dot(base,vec3(.26,.56,.18))),0.0,1.47);
    diffuseColor.rgb=tint*pattern;
    vec2 panel=vec2(p.x>0.0?-p.z:p.z,p.y);
    float bib=inkBox(panel,vec2(0,1.286),vec2(.136,.117),.026);
    float torsoSide=smoothstep(.055,.091,abs(p.x));
    float bibCoverage=bib*torsoSide;
    float seam=bib-inkBox(panel,vec2(0,1.286),vec2(.130,.111),.022);
    float bar=inkBox(panel,vec2(0.0,1.366),vec2(.075,.009),.004);
    float badge=inkBox(panel,vec2(.085,1.365),vec2(.016,.011),.004);
    float number=0.0;
    if(bibCoverage>0.0) {
      vec2 center=panel-vec2(0,1.284);
      float value=podmuchBib.x;
      number=value<10.0?bibDigit(center,value):max(
        bibDigit(center+vec2(.036,0),floor(value/10.0)),
        bibDigit(center-vec2(.036,0),mod(value,10.0)));
    }
    vec3 bibColor=mix(vec3(.78,.83,.86),vec3(.94,.65,.027),podmuchBib.y);
    vec3 canvasColor=mix(bibColor,vec3(.06,.12,.19),max(bar*.68,number));
    canvasColor=mix(canvasColor,vec3(.55,.038,.052),badge);
    canvasColor*=1.0-seam*.24;
    diffuseColor.rgb=mix(diffuseColor.rgb,canvasColor,bibCoverage);
    float legJoin=width-.189-abs(p.x)*.29;
    float leg=smoothstep(.23,.32,p.y)*(1.0-smoothstep(.90,1.04,p.y));
    float legEdge=(1.0-smoothstep(.001,.004,abs(legJoin)))*leg;
    float legStitch=(1.0-smoothstep(.001,.0035,abs(legJoin-.008)))*leg;
    float shoulder=smoothstep(.98,1.16,p.y)*smoothstep(.167,.245,width);
    float armJoin=p.x+.037+.23*(p.y-1.26);
    float armEdge=(1.0-smoothstep(.001,.006,abs(armJoin)))*shoulder;
    float armStitch=(1.0-smoothstep(.001,.004,abs(armJoin-.009)))*shoulder;
    float stitchPhase=p.y*1060.0;
    float stitches=smoothstep(-.18,.33,sin(stitchPhase));
    float stitch=mix(.83,mix(.65,1.0,stitches),1.0-smoothstep(.65,2.4,fwidth(stitchPhase)));
    diffuseColor.rgb*=1.0-.34*max(legEdge,armEdge);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.32,.39),max(legStitch,armStitch)*stitch*.49);
    float weaveA=dot(p,vec3(532.0,109.0,-235.0));
    float weaveB=dot(p,vec3(-248.0,466.0,153.0));
    float threadFade=1.0-smoothstep(.58,2.4,max(fwidth(weaveA),fwidth(weaveB)));
    float thread=sin(weaveA)*sin(weaveB)*threadFade;
    diffuseColor.rgb*=1.0+thread*.13;
    float knee=(1.0-smoothstep(.016,.085,abs(p.y-.535)))*
      (1.0-smoothstep(-.041,.032,p.x))*mix(podmuchFlex.x,podmuchFlex.y,step(0.0,p.z));
    float hip=(1.0-smoothstep(.014,.104,abs(p.y-.96-.18*width)))*
      smoothstep(.01,.105,p.x)*podmuchFlex.z;
    float kneeFold=cos(p.y*147.0+p.x*36.0+p.z*14.0);
    float hipFold=cos(p.y*111.0-p.x*46.0-width*28.0);
    diffuseColor.rgb*=1.0+(kneeFold*knee*.105+hipFold*hip*.086)*(1.0-bibCoverage);
    float collar=smoothstep(1.456,1.477,p.y)*(1.0-smoothstep(.069,.087,width));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.028,.035,.039),collar*.86);`,
  shell:`
    vec3 p=podmuchRest;
    diffuseColor.rgb=podmuchHelmet;
    float canopy=abs(p.z);
    float stripe=1.0-smoothstep(.019,.022,canopy);
    float piping=1.0-smoothstep(.0015,.0045,abs(canopy-.0265));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.020,.044,.09),stripe);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.53,.022,.044),piping);
    float notch=inkBox(vec2(p.x,canopy),vec2(-.017,.060),vec2(.029,.009),.006);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.042,.06,.085),notch*smoothstep(1.769,1.797,p.y));
    float lowerEdge=p.y-(1.587+.42*abs(p.x));
    float rim=1.0-smoothstep(.002,.009,abs(lowerEdge));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.04,.055,.062),rim*.79);
    diffuseColor.rgb*=1.0+.14*(1.0-smoothstep(.002,.004,abs(lowerEdge-.010)));`,
  rubber:`
    vec3 p=podmuchRest;
    float boot=1.0-smoothstep(.22,.29,p.y);
    float seam=1.0-smoothstep(.001,.004,abs(p.y-.066-abs(p.x)*.038));
    float sidewall=smoothstep(.036,.044,p.y)*(1.0-smoothstep(.054,.062,p.y));
    float tread=smoothstep(.42,.70,sin(p.x*225.0+p.y*47.0));
    diffuseColor.rgb*=1.0+(seam*.66+mix(.34,-.25,tread)*sidewall)*boot;
    float stronger=inkBox(vec2(p.x,p.y),vec2(.041,.161),vec2(.030,.012),.003);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.45,.53,.57),stronger*boot*.83);`
};
function finishMaterial(material,outfit) {
  const name=material.name;
  const kind=name.startsWith('Kombinezon')?'cloth':name.startsWith('Kask')?'shell':name.startsWith('Buty')?'rubber':null;
  if(name.startsWith('Gogle')) {
    material.envMapIntensity=1.02;
    material.roughness=.18;
    material.metalness=.28;
    material.clearcoatRoughness=.13;
    material.iridescence=.31;
    material.iridescenceIOR=1.38;
    material.iridescenceThicknessMinimum=175;
    material.iridescenceThicknessMaximum=340;
  }
  if(!kind) return;
  if(kind==='shell') {
    material.envMapIntensity=.92;
    material.clearcoatRoughness=.23;
  }
  material.customProgramCacheKey=()=>`podmuch-finish-${kind}`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.podmuchSuit={value:outfit.suit};
    shader.uniforms.podmuchLegs={value:outfit.legs};
    shader.uniforms.podmuchHelmet={value:outfit.helmet};
    shader.uniforms.podmuchFlex={value:outfit.flex};
    shader.uniforms.podmuchBib={value:outfit.bib};
    shader.vertexShader='varying vec3 podmuchRest;\n'+shader.vertexShader.replace(
      '#include <begin_vertex>','#include <begin_vertex>\npodmuchRest=position;'
    );
    shader.fragmentShader=restCoordinates+'\n'+shader.fragmentShader.replace(
      '#include <color_fragment>',`#include <color_fragment>\n{${finishCode[kind]}}`
    );
  };
}

export async function loadAthlete(binary) {
  const file=await new GLTFLoader().parseAsync(binary,'');
  return rigAthlete(file.scene);
}
function rigAthlete(model,ownMaterials=false) {
  const bindings=new Map();
  const a=new Vector3(),b=new Vector3(),right=new Vector3(),axis=new Vector3(),across=new Vector3();
  const matrix=new Matrix4(),stretch=new Matrix4();
  const prepared=new Set();
  const outfit={suit:new Color('#ac2027'),legs:new Color('#15263a'),helmet:new Color('#e8ecf4'),flex:new Vector3(),bib:new Vector2(1,0)};
  const worn={};
  model.traverse(object=>{
    if(object.isMesh) {
      if(ownMaterials) object.material=object.material.clone();
      object.castShadow=true;
      object.receiveShadow=true;
      object.frustumCulled=false;
      if(!prepared.has(object.material)) {
        object.material.envMapIntensity=.62;
        finishMaterial(object.material,outfit);
        prepared.add(object.material);
      }
    }
    if(!object.isBone||!object.userData.restEnd) return;
    const end=new Vector3().fromArray(object.userData.restEnd);
    const basis=boneBasis(object.position,end,right,axis,across,new Matrix4()).transpose();
    bindings.set(object.name,{object,basis,length:object.position.distanceTo(end)});
    object.matrixAutoUpdate=false;
  });
  function bend(start,joint,end) {
    a.fromArray(joint).sub(right.fromArray(start)).normalize();
    b.fromArray(end).sub(right.fromArray(joint)).normalize();
    return clamp((1-a.dot(b))*.85,0,1);
  }
  function update(rig,style) {
    const {origin,roll,angle,joints,yaw=0}=rig;
    model.position.fromArray(origin);
    model.rotation.set(roll,-yaw,angle,'YZX');
    if(style) for(const key of ['suit','legs','helmet']) {
      if(style[key]===worn[key]) continue;
      outfit[key].set(style[key]);worn[key]=style[key];
    }
    outfit.bib.set(style?.bibNumber??1,style?.yellowBib?1:0);
    const [hipL,kneeL]=joints.thighL,[hipR,kneeR]=joints.thighR,[,shoulder]=joints.torso;
    outfit.flex.set(bend(hipL,kneeL,joints.shinL[1]),bend(hipR,kneeR,joints.shinR[1]),
      .5*(bend(kneeL,hipL,shoulder)+bend(kneeR,hipR,shoulder)));
    for(const [name,{object,basis,length}] of bindings) {
      const [start,end]=joints[name];
      a.fromArray(start);b.fromArray(end);
      const stretchY=clamp(a.distanceTo(b)/length,.52,1.65);
      const turn=name==='head'?rig.headTurn:name==='torso'?rig.torsoTurn:0;
      boneBasis(a,b,right,axis,across,matrix,turn)
        .multiply(stretch.makeScale(1,stretchY,1))
        .multiply(basis)
        .setPosition(a);
      object.matrix.copy(matrix);
      object.matrixWorldNeedsUpdate=true;
    }
  }
  return {model,bindings,update,copy:()=>rigAthlete(cloneSkeleton(model),true)};
}

const skyGeometry=new SphereGeometry(1600,40,22);
function makeSky(reflections=false) {
  const material=new ShaderMaterial({
    side:BackSide,depthWrite:false,fog:false,
    uniforms:{
      sun:{value:new Vector3()},horizon:{value:new Vector3()},zenith:{value:new Vector3()},
      low:{value:new Vector3()},cloud:{value:new Vector3()},glare:{value:new Vector3()},
      cover:{value:0},night:{value:0},disc:{value:0},stadium:{value:reflections?1:0}
    },
    vertexShader:`
      varying vec3 ray;
      void main() { ray=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      varying vec3 ray;
      uniform vec3 sun,horizon,zenith,low,cloud,glare;
      uniform float cover,night,disc,stadium;
      float hash(vec2 p) { vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
      }
      void main() {
        vec3 d=normalize(ray);
        float mid=pow(max(d.y,0.0),.52);
        vec3 sky=mix(horizon,zenith,min(1.0,mid*1.24));
        sky=mix(sky,low,smoothstep(0.0,.57,-d.y));
        vec2 p=d.xz/max(.11,d.y+.27)*3.2;
        float coverNoise=noise(p)*.56+noise(p*2.08)*.26+noise(p*4.29)*.14+noise(p*8.52)*.04;
        float coverage=smoothstep(.54-cover*.23,.78-cover*.15,coverNoise)*smoothstep(.01,.24,d.y);
        vec3 muted=mix(vec3(.58,.67,.75),vec3(.038,.057,.084),night);
        sky=mix(sky,muted,cover*cover*.63);
        sky=mix(sky,mix(cloud,muted,cover*.47),coverage*.93);
        float light=max(dot(d,sun),0.0);
        sky+=glare*pow(light,mix(20.0,46.0,night))*(1.0-cover*.73);
        vec3 discTint=mix(vec3(1.0,.70,.47),vec3(.67,.79,1.0),night);
        sky+=discTint*disc*smoothstep(.9986+night*.0007,.99966+night*.00020,light);
        vec2 stars=vec2(atan(d.z,d.x)*95.0,d.y*181.0);
        float q=hash(floor(stars));
        vec2 delta=fract(stars)-vec2(.24+q*.45,.39+q*.28);
        float spark=(1.0-smoothstep(.055,.16,length(delta)))*smoothstep(.977,.998,q);
        sky+=vec3(.52,.67,.98)*spark*night*smoothstep(.11,.55,d.y)*(1.0-cover)*(1.0-coverage);
        if(stadium*night>.5) {
          float bearing=atan(d.z,d.x);
          float mainRow=exp(-pow((d.y-.28)*18.0,2.0));
          float upperRow=.65*exp(-pow((d.y-.47)*23.0,2.0));
          float cool=pow(.5+.5*cos(bearing*4.0+.8),21.0);
          float warm=pow(.5+.5*cos(bearing*4.0-1.42),24.0);
          float lenses=.46+.54*pow(.5+.5*cos(bearing*47.0),2.0);
          sky+=(vec3(.46,.70,1.0)*cool+vec3(1.0,.62,.35)*warm)*(mainRow+upperRow)*lenses*5.1;
        }
        gl_FragColor=vec4(sky,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const sky=new Mesh(skyGeometry,material);
  sky.renderOrder=-10;
  sky.frustumCulled=false;
  return sky;
}

const snowStyles=['powder','groomed','packed'];

function snowTexture(style,bump) {
  const size=256,data=new Uint8Array(size*size*4);
  const groomed=style==='groomed',packed=style==='packed';
  let random=21441;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    const u=x/size*Math.PI*2,v=y/size*Math.PI*2;
    const grit=(random/4294967296-.5)*(packed?5:bump?17:12);
    const drifts=Math.sin(3*u+2*v)*Math.cos(2*u-3*v);
    const grains=Math.sin(17*u-13*v)*Math.cos(11*u+21*v);
    const groove=(.5+.5*Math.cos(42*u+.12*Math.sin(2*v)))**3;
    const packedLines=(.5+.5*Math.cos(56*u+.7*Math.cos(v)))**5;
    const relief=groomed?groove*25+grains*2:packed?packedLines*9:drifts*26+grains*10;
    const tint=groomed?244-groove*11+drifts*2:packed?242-packedLines*5:235+drifts*7+grains*4;
    const luminance=bump?126+grit+relief:tint+grit;
    const i=(y*size+x)*4;
    data.set([luminance-(bump?0:packed?3:2),luminance,Math.min(255,luminance+(bump?0:3)),255],i);
  }
  const map=new DataTexture(data,size,size,RGBAFormat);
  map.wrapS=map.wrapT=RepeatWrapping;
  map.generateMipmaps=true;
  map.magFilter=LinearFilter;
  map.minFilter=LinearMipmapLinearFilter;
  map.colorSpace=bump?'':SRGBColorSpace;
  map.needsUpdate=true;
  return map;
}

function materialSet() {
  const shared={vertexColors:true,side:DoubleSide,roughness:.78};
  const snowMaterials=snowStyles.map((style,i)=>new MeshStandardMaterial({
    ...shared,map:snowTexture(style,false),bumpMap:snowTexture(style,true),
    roughness:[.94,.87,.58][i],bumpScale:[.125,.10,.042][i],envMapIntensity:i===2?.39:.21
  }));
  return [
    new MeshStandardMaterial({...shared,envMapIntensity:.43}),
    snowMaterials[0],snowMaterials[1],
    new MeshStandardMaterial({...shared,roughness:1,envMapIntensity:.15}),
    new MeshStandardMaterial({...shared,emissive:0xffb362,emissiveIntensity:.04,roughness:.54}),
    snowMaterials[2]
  ];
}

function addSkiContact(material,contact,normal,landingShadow) {
  material.customProgramCacheKey=()=>'podmuch-ski-contact';
  material.onBeforeCompile=shader=>{
    shader.uniforms.podmuchContact={value:contact};
    shader.uniforms.podmuchSurface={value:normal};
    shader.uniforms.podmuchLandingShadow={value:landingShadow};
    shader.vertexShader='varying vec3 podmuchGround;\n'+shader.vertexShader.replace(
      '#include <begin_vertex>','#include <begin_vertex>\npodmuchGround=position;'
    );
    shader.fragmentShader=`
      varying vec3 podmuchGround;
      uniform vec4 podmuchContact;
      uniform vec4 podmuchSurface;
      uniform vec4 podmuchLandingShadow;
    `+shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec2 g=podmuchGround.xz;
      float powderPatch=sin(dot(g,vec2(.21,.34)))*cos(dot(g,vec2(.34,-.19)));
      float drift=sin(dot(g,vec2(.081,-.39))+.6*sin(g.x*.12));
      diffuseColor.rgb*=1.0+.022*powderPatch+.013*drift;
    `).replace('#include <aomap_fragment>',`#include <aomap_fragment>
      vec3 gap=podmuchGround-podmuchContact.xyz;
      float surfaceWeight=1.0-smoothstep(.038,.24,abs(gap.y-gap.x*podmuchSurface.x));
      float stride=podmuchSurface.y;
      vec2 left=vec2((gap.x+stride)/1.05,(gap.z+.27)/.143);
      vec2 right=vec2((gap.x-stride)/1.05,(gap.z-.27)/.143);
      float underSkis=max(exp(-dot(left,left)*1.55),exp(-dot(right,right)*1.55));
      float underJumper=exp(-dot(gap.xz,gap.xz)*1.35)*.29;
      float contactShade=1.0-(underSkis*.31+underJumper*.21)*podmuchContact.w*surfaceWeight;
      if(podmuchLandingShadow.w>0.0) {
        vec2 footprint=(podmuchGround.xz-podmuchLandingShadow.xz)/vec2(1.48,.78);
        float shadow=exp(-2.0*dot(footprint,footprint))*podmuchLandingShadow.w;
        contactShade*=1.0-shadow;
      }
      reflectedLight.indirectDiffuse*=contactShade;
      reflectedLight.directDiffuse*=mix(1.0,contactShade,.58);
    `);
  };
}

const palette=new Map();
function colorOf(value) {
  if(!palette.has(value)) palette.set(value,new Color(value));
  return palette.get(value);
}
function triangleNormal(a,b,c) {
  const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],u=c[0]-a[0],v=c[1]-a[1],w=c[2]-a[2];
  const nx=y*w-z*v,ny=z*u-x*w,nz=x*v-y*u,n=Math.hypot(nx,ny,nz)||1;
  return [nx/n,ny/n,nz/n];
}

function worldGroups(faces) {
  const groups=new Map();
  for(const face of faces) {
    if(face.motion) continue;
    const type=clamp(face.material,0,5),x=face.list[0][0],z=face.list[0][2];
    const nearby=x>-265&&x<566&&Math.abs(z)<200&&type!==3;
    const detail=face.detail||0;
    const key=nearby?`${type}:${Math.floor(x/52)}:${Math.floor(z/62)}:${detail}`:`${type}:distance`;
    if(!groups.has(key)) groups.set(key,{type,nearby,detail,list:[],count:0});
    const group=groups.get(key);
    group.list.push(face);
    group.count+=3*(face.list.length-2);
  }
  return groups.values();
}

function writer(count,dynamic=false) {
  const geometry=new BufferGeometry();
  const position=new Float32Array(count*3),normal=new Float32Array(count*3),color=new Float32Array(count*3);
  const uv=new Float32Array(count*2);
  const skiTop=dynamic?new Float32Array(count):null;
  const descriptors=[
    ['position',position,3],['normal',normal,3],['color',color,3],['uv',uv,2]
  ];
  if(skiTop) descriptors.push(['skiTop',skiTop,1]);
  const buffers=descriptors.map(([name,data,size])=>{
    const buffer=new BufferAttribute(data,size);
    if(dynamic) buffer.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name,buffer);
    return buffer;
  });
  function write(faces) {
    let n=0;
    for(const face of faces) {
      const {list,normals}=face,c=colorOf(face.color);
      for(let i=1;i<list.length-1;i++) {
        const unit=triangleNormal(list[0],list[i],list[i+1]);
        for(const j of [0,i,i+1]) {
          if(n>=count) throw new Error('Przekroczono bufor geometrii sprzętu.');
          position.set(list[j],n*3);normal.set(normals?.[j]||unit,n*3);
          color[n*3]=c.r;color[n*3+1]=c.g;color[n*3+2]=c.b;
          uv[n*2]=list[j][2]*.27;uv[n*2+1]=list[j][0]*.35;
          if(skiTop) skiTop[n]=face.material===7?1:0;
          n++;
        }
      }
    }
    geometry.setDrawRange(0,n);
    if(dynamic&&n>0) {
      for(const buffer of buffers) {
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0,n*buffer.itemSize);
        buffer.needsUpdate=true;
      }
    }
  }
  return {geometry,write};
}

function equipmentMaterial() {
  const material=new MeshStandardMaterial({
    vertexColors:true,side:DoubleSide,roughness:.56,metalness:.09,envMapIntensity:.63
  });
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float skiTop;\nvarying float lacquer;\n'+shader.vertexShader.replace(
      '#include <begin_vertex>','#include <begin_vertex>\nlacquer=skiTop;'
    );
    shader.fragmentShader='varying float lacquer;\n'+shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.20,lacquer);'
    ).replace(
      '#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,.19,lacquer);'
    );
  };
  return material;
}

function fromBase64(value) {
  const data=atob(value),bytes=new Uint8Array(data.length);
  for(let i=0;i<data.length;i++) bytes[i]=data.charCodeAt(i);
  return unzlibSync(bytes).buffer;
}

function makeCrowd(faces,scene) {
  const moving=faces.filter(face=>face.motion);
  const count=moving.reduce((n,face)=>n+3*(face.list.length-2),0);
  const draw=writer(count);
  draw.write(moving);
  const data=new Float32Array(count*4),directions=new Float32Array(count*2);
  let n=0;
  for(const {list,motion} of moving) {
    const {phase,direction,fan,flag}=motion;
    for(let i=1;i<list.length-1;i++) for(const j of [0,i,i+1]) {
      const [x,y,z]=list[j];
      const distance=flag?clamp(((x-flag.pole[0])*flag.span[0]+(z-flag.pole[2])*flag.span[1])/flag.width,0,1):0;
      const lift=fan?clamp((y-fan.y)*1.61,0,1)*fan.strength:0;
      data.set([phase,lift,distance,flag?1:0],n*4);
      directions.set(direction,n*2);
      n++;
    }
  }
  draw.geometry.setAttribute('motionData',new BufferAttribute(data,4));
  draw.geometry.setAttribute('motionDirection',new BufferAttribute(directions,2));
  const clock=new Vector4();
  const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.83,envMapIntensity:.34});
  material.customProgramCacheKey=()=>'podmuch-flag-and-fans';
  material.onBeforeCompile=shader=>{
    shader.uniforms.crowdClock={value:clock};
    shader.vertexShader=`
      attribute vec4 motionData;
      attribute vec2 motionDirection;
      uniform vec4 crowdClock;
    `+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float period=crowdClock.x;
      float cheer=crowdClock.y;
      float phase=motionData.x;
      float sway=sin(period*3.7+phase)*(.039+cheer*.11);
      float bounce=(.5+.5*sin(period*5.4+phase*.53))*(.033+cheer*.17);
      vec2 side=vec2(motionDirection.y,-motionDirection.x);
      transformed.y+=motionData.y*bounce;
      transformed.xz+=side*sway*motionData.y;
      float u=motionData.z;
      float gust=abs(crowdClock.z);
      float flag=pow(u,1.28)*motionData.w;
      float wave=sin(u*7.7-period*(4.6+gust*.88)+phase)+.34*sin(u*13.0-period*7.3+phase*.9);
      transformed.xz+=motionDirection*wave*flag*(.095+gust*.028);
      transformed.y+=cos(u*5.4-period*5.1+phase)*flag*.042;
    `);
  };
  const mesh=new Mesh(draw.geometry,material);
  mesh.receiveShadow=true;
  scene.add(mesh);
  let seenLanding=null;
  return {update(actor,time) {
    let reaction=0;
    if(actor.outStart===undefined) seenLanding=null;
    else {
      if(seenLanding===null) seenLanding=time;
      const age=time-seenLanding;
      const strength=actor.landing==='Telemark'?1:actor.landing==='Upadek'?.24:.73;
      reaction=strength*clamp(age*5,0,1)*(1-clamp((age-2.8)/3.4,0,1));
    }
    clock.set(time,reaction,actor.wind,0);
  },dispose(){scene.remove(mesh);mesh.geometry.dispose();material.dispose();}};
}

export async function create({faces,asset,reference,lamps,terrain}) {
  const renderer=new WebGLRenderer({alpha:false,antialias:true,powerPreference:'high-performance'});
  const layer=renderer.domElement;
  layer.setAttribute('aria-hidden','true');
  renderer.outputColorSpace=SRGBColorSpace;
  renderer.toneMapping=ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.02;
  renderer.shadowMap.type=PCFShadowMap;
  const scene=new Scene();
  const sky=makeSky();
  scene.add(sky);
  const camera=new PerspectiveCamera(55,1,.22,2300);
  let postEffects,canUsePost=typeof Image!=='undefined'&&renderer.extensions.has('EXT_color_buffer_float');
  const hemisphere=new HemisphereLight(0xc7e1ff,0x7b8fa4,1.54);
  scene.add(hemisphere);
  const key=new DirectionalLight(0xffefd9,2.96);
  key.position.copy(lightDirection).multiplyScalar(124);
  key.castShadow=true;
  key.shadow.normalBias=.048;
  key.shadow.bias=-.00014;
  key.shadow.radius=2;
  key.shadow.intensity=.72;
  scene.add(key,key.target);
  const fill=new DirectionalLight(0x9ebde5,.35);
  fill.position.set(3,3,5);
  scene.add(fill);
  const athlete=await loadAthlete(fromBase64(asset));
  scene.add(athlete.model);
  const podiumAthletes=[];
  const environmentScene=new Scene();
  const reflectedSky=makeSky(true);
  environmentScene.add(reflectedSky);
  const prefilter=new PMREMGenerator(renderer);
  let environment;
  const skyConditions=makeConditions(scene,lamps,renderer,sky,reflectedSky,()=>{
    const next=prefilter.fromScene(environmentScene,.045,.1,1900,{size:96});
    scene.environment=next.texture;
    environment?.dispose();
    environment=next;
  });
  const particles=makeParticles(scene,terrain,lamps);
  let crowd,world=[];
  const shadowRight=new Vector3(),shadowUp=new Vector3(),worldUp=new Vector3(0,1,0);
  const materials=materialSet();
  const snowMaterials=[materials[1],materials[2],materials[5]];
  const maxAnisotropy=Math.max(1,renderer.capabilities.getMaxAnisotropy());
  const contact=new Vector4(),surface=new Vector4(),landingShadow=new Vector4();
  const visor=new Vector3(),visorOffset=new Vector3(.128,-.007,0);
  for(const snow of snowMaterials) addSkiContact(snow,contact,surface,landingShadow);
  function setWorld(nextFaces,nextLamps) {
    renderer.shadowMap.needsUpdate=true;
    for(const {chunk} of world) {scene.remove(chunk);chunk.geometry.dispose();}
    world=[];
    crowd?.dispose();
    for(const {type,nearby,detail,list,count} of worldGroups(nextFaces)) {
      const draw=writer(count);
      draw.write(list);
      const chunk=new Mesh(draw.geometry,materials[type]);
      chunk.castShadow=nearby&&type===0&&!detail;
      chunk.receiveShadow=nearby;
      chunk.geometry.computeBoundingSphere();
      scene.add(chunk);
      world.push({chunk,detail});
    }
    crowd=makeCrowd(nextFaces,scene);
    skyConditions.setLamps(nextLamps);
    particles.setLamps(nextLamps);
  }
  setWorld(faces,lamps);
  const dynamic=writer(16384,true);
  const kit=new Mesh(dynamic.geometry,equipmentMaterial());
  kit.castShadow=true;kit.receiveShadow=true;kit.frustumCulled=false;
  scene.add(kit);
  const overlayBuffer=writer(16384,true);
  const overlay=new Mesh(overlayBuffer.geometry,kit.material);
  overlay.castShadow=true;overlay.receiveShadow=true;overlay.frustumCulled=false;
  scene.add(overlay);
  let previousOverlays=[],lastShadow=-Infinity,shadowDay;
  let renderWidth=0,renderHeight=0,renderRatio=1,currentQuality=-1;
  function resize(width,height,ratio) {
    renderWidth=width;renderHeight=height;renderRatio=ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width,height,false);
  }
  function frame(view,kitFaces,actor,rig,settings,selection,time,hill) {
    if(!renderWidth||!renderHeight) return;
    skyConditions.apply(selection,key,hemisphere,fill);
    materials[4].emissiveIntensity=skyConditions.darkness?.78:.025;
    const {eye,aim,up,focal,centerX,centerY}=view;
    camera.position.fromArray(eye);camera.up.fromArray(up);
    for(const {chunk,detail} of world) {
      if(!detail) continue;
      const bound=chunk.geometry.boundingSphere;
      const reach=detail*(settings.quality===2?1:settings.quality===1?.74:.46)+bound.radius;
      chunk.visible=camera.position.distanceToSquared(bound.center)<reach*reach;
    }
    camera.lookAt(aim[0],aim[1],aim[2]);
    camera.fov=2*Math.atan(renderHeight/(2*focal))*180/Math.PI;
    camera.aspect=renderWidth/renderHeight;
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8]=1-2*centerX/renderWidth;
    camera.projectionMatrix.elements[9]=2*centerY/renderHeight-1;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    sky.position.copy(camera.position);
    if(settings.quality!==currentQuality) {
      currentQuality=settings.quality;
      renderer.shadowMap.enabled=currentQuality>0;
      renderer.shadowMap.autoUpdate=currentQuality===2;
      renderer.shadowMap.needsUpdate=true;
      const size=currentQuality===2?2048:1024;
      key.shadow.map?.dispose();
      key.shadow.map=null;
      key.shadow.mapSize.set(size,size);
      const anisotropy=Math.min(maxAnisotropy,[1,4,8][currentQuality]??1);
      for(const snow of snowMaterials) for(const map of [snow.map,snow.bumpMap]) {
        if(map.anisotropy!==anisotropy) {map.anisotropy=anisotropy;map.needsUpdate=true;}
      }
      for(const material of materials) material.needsUpdate=true;
    }
    const panorama=settings.view===2,extent=panorama?164*hill.scale:65;
    if(settings.view===6) key.target.position.fromArray(aim);
    else key.target.position.set(panorama?36*hill.scale:actor.x+10,panorama?-29*hill.height:actor.y-5,panorama?0:actor.z);
    if(renderer.shadowMap.enabled) {
      const now=performance.now();
      if(currentQuality===1&&(now-lastShadow>=32||shadowDay!==selection.day)) renderer.shadowMap.needsUpdate=true;
      if(renderer.shadowMap.needsUpdate) {
        lastShadow=now;
        shadowDay=selection.day;
      }
      shadowRight.crossVectors(worldUp,skyConditions.sun).normalize();
      shadowUp.crossVectors(skyConditions.sun,shadowRight);
      const texel=2*extent/key.shadow.mapSize.x;
      for(const axis of [shadowRight,shadowUp]) {
        const position=key.target.position.dot(axis);
        key.target.position.addScaledVector(axis,Math.round(position/texel)*texel-position);
      }
      Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.5,far:330});
      key.shadow.camera.updateProjectionMatrix();
    }
    key.position.copy(key.target.position).addScaledVector(skyConditions.sun,124);
    athlete.model.visible=!actor.hidden;
    if(rig?.joints) athlete.update(rig,hill.athlete);
    const podium=hill.podium||[];
    for(let i=0;i<podium.length;i++) {
      if(!podiumAthletes[i]) {
        podiumAthletes[i]=athlete.copy();
        scene.add(podiumAthletes[i].model);
      }
      const other=podiumAthletes[i];
      other.model.visible=true;
      other.update(podium[i].rig,podium[i].appearance);
    }
    for(let i=podium.length;i<podiumAthletes.length;i++) podiumAthletes[i].model.visible=false;
    const groundAmount=actor.hidden?0:actor.state==='flight'?clamp(1-(actor.tick-actor.flightStart)*8,0,1):1;
    contact.set(actor.x,actor.y,actor.z,groundAmount);
    const finalApproach=actor.state==='flight'?clamp(1-(actor.landCountdown??Infinity)/.95,0,1):0;
    const touchdown=actor.state==='outrun'?clamp(1-(actor.tick-actor.outStart)/.20,0,1):0;
    landingShadow.set(actor.x,0,actor.z,Math.max(finalApproach,touchdown)*.41);
    if(rig?.joints) surface.set(Math.tan(rig.angle),(rig.joints.bootR[0][0]-rig.joints.bootL[0][0])*.5,0,0);
    dynamic.write(kitFaces);
    if(hill.overlays.some((faces,i)=>faces[0]!==previousOverlays[i]?.first||faces.length!==previousOverlays[i]?.length)) {
      overlayBuffer.write(hill.overlays.flat());
      previousOverlays=hill.overlays.map(faces=>({first:faces[0],length:faces.length}));
      overlay.visible=overlayBuffer.geometry.drawRange.count>0;
    }
    particles.update(view,actor,{...settings,weather:selection.weather},time,renderRatio,skyConditions.darkness);
    crowd.update(actor,time);
    const useEffects=canUsePost&&currentQuality>0&&(currentQuality===2||skyConditions.darkness);
    if(useEffects) {
      try {
        postEffects??=makeBroadcastEffects(renderer,scene,camera,skyConditions.bloomSources);
        const goggles=skyConditions.darkness&&!actor.hidden&&rig?.joints?.head?
          athlete.model.localToWorld(visor.fromArray(rig.joints.head[1]).add(visorOffset)):null;
        postEffects.render(view,renderHeight,currentQuality,skyConditions.darkness,goggles);
        return;
      } catch(error) {
        console.warn('Efekty transmisji zostały wyłączone:',error);
        canUsePost=false;
        postEffects?.dispose();
        postEffects=null;
        renderer.setRenderTarget(null);
        renderer.autoClear=true;
      }
    }
    renderer.render(scene,camera);
  }
  reference.after(layer);
  return {layer,resize,frame,setWorld,usesRig:true,dispose(){
    postEffects?.dispose();
    scene.traverse(o=>{if(o.isMesh&&o.geometry!==skyGeometry) o.geometry.dispose();});
    for(const other of podiumAthletes) other.model.traverse(o=>{if(o.isMesh) o.material.dispose();});
    for(const material of materials) {
      material.map?.dispose();material.bumpMap?.dispose();material.dispose();
    }
    kit.material.dispose();
    environment?.dispose();prefilter.dispose();reflectedSky.material.dispose();renderer.dispose();
  }};
}
