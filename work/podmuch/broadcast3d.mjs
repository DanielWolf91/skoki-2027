import {DepthTexture,HalfFloatType,Matrix4,UnsignedIntType,Vector2,Vector3,Vector4,WebGLRenderTarget} from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';

const contactShadows={
  uniforms:{tDiffuse:{value:null},tDepth:{value:null},inverseProjection:{value:new Matrix4()},
    size:{value:new Vector2()},focalPixels:{value:0}},
  vertexShader:`
    varying vec2 coords;
    void main() {
      coords=uv;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    }`,
  fragmentShader:`
    varying vec2 coords;
    uniform sampler2D tDiffuse,tDepth;
    uniform mat4 inverseProjection;
    uniform vec2 size;
    uniform float focalPixels;
    const vec2 spokes[8]=vec2[8](vec2(1,0),vec2(.707,.707),vec2(0,1),vec2(-.707,.707),
      vec2(-1,0),vec2(-.707,-.707),vec2(0,-1),vec2(.707,-.707));

    float rawDepth(vec2 uv) { return texture2D(tDepth,uv).r; }
    vec3 viewPosition(vec2 uv,float depth) {
      vec4 p=inverseProjection*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
      return p.xyz/p.w;
    }
    float ambientContact(vec3 p,vec3 normal) {
      float reach=clamp(focalPixels*.75/max(-p.z,1.0),2.0,18.0);
      float sum=0.0;
      for(int i=0;i<8;i++) {
        float ring=i%2==0?.54:1.0;
        vec2 uv=clamp(coords+spokes[i]*reach*ring/size,vec2(0.0),vec2(1.0));
        vec3 delta=viewPosition(uv,rawDepth(uv))-p;
        float separation=length(delta);
        float facing=max(dot(normal,delta)-.016,0.0)/max(separation,.07);
        sum+=facing*(1.0-smoothstep(.18,1.32,separation));
      }
      return min(.28,sum*.11)*(1.0-smoothstep(38.0,93.0,-p.z));
    }
    void main() {
      float depth=rawDepth(coords);
      vec3 p=viewPosition(coords,depth);
      vec3 area=cross(dFdx(p),dFdy(p));
      vec3 color=texture2D(tDiffuse,coords).rgb;
      if(-p.z<93.0&&dot(area,area)>1e-15) {
        float occlusion=ambientContact(p,normalize(area));
        color*=1.0-.70*occlusion*(1.0-smoothstep(.17,1.3,max(color.r,max(color.g,color.b))));
      }
      gl_FragColor=vec4(color,1.0);
    }`
};

class ContactShadowPass extends ShaderPass {
  constructor() {
    super(contactShadows);
    this.material.depthTest=false;
    this.material.depthWrite=false;
  }
  setSize(width,height) { this.uniforms.size.value.set(width,height); }
  render(renderer,writeBuffer,readBuffer) {
    this.uniforms.tDepth.value=readBuffer.depthTexture;
    super.render(renderer,writeBuffer,readBuffer);
  }
}

const fullscreenVertex=`
  varying vec2 coords;
  void main() {coords=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;

class SelectiveBloom extends ShaderPass {
  constructor(camera,sources) {
    super({uniforms:{tDiffuse:{value:null},tGlow:{value:null}},vertexShader:fullscreenVertex,fragmentShader:`
      varying vec2 coords;
      uniform sampler2D tDiffuse,tGlow;
      void main() {gl_FragColor=vec4(texture2D(tDiffuse,coords).rgb+.46*texture2D(tGlow,coords).rgb,1.0);}
    `});
    this.material.depthTest=false;
    this.material.depthWrite=false;
    this.camera=camera;
    this.sources=sources;
    this.point=new Vector3();
    this.projected=Array.from({length:sources.length+1},()=>new Vector4());
    this.mask=new WebGLRenderTarget(32,32,{type:HalfFloatType,depthBuffer:false});
    this.glow=new UnrealBloomPass(new Vector2(32,32),.58,.35,.33);
    this.emission=new ShaderPass({uniforms:{tDepth:{value:null},tScene:{value:null},
      size:{value:new Vector2()},clipPlanes:{value:new Vector2(camera.near,camera.far)},
      points:{value:this.projected},tints:{value:sources.map(source=>source.color)}},vertexShader:fullscreenVertex,fragmentShader:`
      varying vec2 coords;
      uniform sampler2D tDepth,tScene;
      uniform vec2 size,clipPlanes;
      uniform vec4 points[${sources.length+1}];
      uniform vec3 tints[${sources.length}];
      float depthAt(vec2 uv) {
        float n=clipPlanes.x,f=clipPlanes.y;
        return n*f/(f+(n-f)*texture2D(tDepth,uv).r);
      }
      float core(vec4 source) {
        vec2 d=(coords-source.xy)*size/max(.1,source.w);
        return 1.0-smoothstep(.06,1.0,dot(d,d));
      }
      void main() {
        vec3 light=vec3(0.0);
        float surface=depthAt(coords);
        for(int i=0;i<${sources.length};i++) {
          vec4 source=points[i];
          if(source.w>0.0&&source.z<=surface+.46) light+=tints[i]*3.5*core(source);
        }
        vec4 lens=points[${sources.length}];
        float glint=lens.w>0.0&&lens.z<=surface+.12?core(lens):0.0;
        if(glint>0.0) {
          vec3 reflection=texture2D(tScene,coords).rgb;
          float luminance=dot(reflection,vec3(.2126,.7152,.0722));
          light+=reflection*glint*smoothstep(.51,1.4,luminance)*.75;
        }
        gl_FragColor=vec4(light,1.0);
      }
    `});
    this.emission.material.depthTest=false;
    this.emission.material.depthWrite=false;
    this.emission.uniforms.points.value=this.projected;
  }
  setSize(width,height) {
    const scale=this.resolutionScale??.52;
    const w=Math.max(32,Math.round(width*scale)),h=Math.max(32,Math.round(height*scale));
    this.mask.setSize(w,h);
    this.glow.setSize(w,h);
    this.emission.uniforms.size.value.set(w,h);
  }
  project(position,radius,output) {
    const {camera,point,mask}=this;
    const depth=-point.copy(position).applyMatrix4(camera.matrixWorldInverse).z;
    if(depth<=camera.near) {output.set(0,0,0,0);return;}
    point.applyMatrix4(camera.projectionMatrix);
    const focal=mask.height*.5*camera.projectionMatrix.elements[5];
    output.set(point.x*.5+.5,point.y*.5+.5,depth,Math.max(.85,focal*radius/depth));
  }
  render(renderer,writeBuffer,readBuffer) {
    const {emission,glow,mask,projected,sources}=this;
    sources.forEach(({position,radius},i)=>this.project(position,radius,projected[i]));
    const lens=projected.at(-1);
    if(this.visor) this.project(this.visor,.095,lens);
    else lens.set(0,0,0,0);
    emission.uniforms.tDepth.value=this.sceneTarget.depthTexture;
    emission.uniforms.tScene.value=this.sceneTarget.texture;
    emission.render(renderer,mask,null);
    glow.render(renderer,null,mask,0,false);
    this.uniforms.tGlow.value=mask.texture;
    super.render(renderer,writeBuffer,readBuffer);
  }
  dispose() {
    this.mask.dispose();
    this.glow.dispose();
    this.emission.dispose();
    super.dispose();
  }
}

export function makeBroadcastEffects(renderer,scene,camera,sources) {
  const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,depthTexture:new DepthTexture(1,1,UnsignedIntType)});
  const composer=new EffectComposer(renderer,target);
  const contact=new ContactShadowPass();
  const bloom=new SelectiveBloom(camera,sources);
  const antialias=new SMAAPass();
  const output=new OutputPass();
  const scenePass=new RenderPass(scene,camera);
  const passes=[scenePass,contact,bloom,antialias,output];
  // Keep the bloom pyramid valid before the first resize, including on 1×1 canvases.
  composer.setPixelRatio(1);
  composer.setSize(32,32);
  for(const pass of passes) composer.addPass(pass);
  let scaledWidth=0,scaledHeight=0;
  return {render(view,height,quality,night,visor){
    const w=Math.max(32,renderer.domElement.width);
    const h=Math.max(32,renderer.domElement.height);
    const bloomScale=quality===2?.52:.37;
    if(w!==scaledWidth||h!==scaledHeight) {
      bloom.resolutionScale=bloomScale;
      scaledWidth=w;scaledHeight=h;
      composer.setSize(w,h);
    } else if(bloom.resolutionScale!==bloomScale) {
      bloom.resolutionScale=bloomScale;
      bloom.setSize(w,h);
    }
    contact.enabled=quality===2;
    if(contact.enabled) {
      contact.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      contact.uniforms.focalPixels.value=view.focal*h/height;
    }
    bloom.enabled=!!night;
    bloom.sceneTarget=composer.readBuffer;
    bloom.visor=visor;
    bloom.glow.strength=quality===2?.58:.44;
    composer.render();
  },dispose(){
    for(const pass of passes) pass.dispose();
    composer.dispose();
  }};
}
