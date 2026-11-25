"""Generate Podmuch's original, weighted glTF athlete and fitted equipment."""
import json
import struct
from pathlib import Path

import numpy as np

root = Path(__file__).parent
materials = []
primitives = []
rig = {
    "torso": ([0, .91, 0], [.026, 1.475, 0]),
    "head": ([.026, 1.475, 0], [.031, 1.679, 0]),
    "neck": ([.026, 1.475, 0], [.029, 1.605, 0]),
}
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    upper = [.026, 1.433, side*.208]
    elbow = [.002, 1.164, side*.345]
    wrist = [.016, .915, side*.432]
    hand = [.036, .835, side*.455]
    hip = [0, .91, side*.125]
    knee = [.021, .528, side*.154]
    ankle = [-.016, .143, side*.175]
    rig.update({
        "arm"+tag: (upper, elbow), "forearm"+tag: (elbow, wrist),
        "hand"+tag: (wrist, hand), "thigh"+tag: (hip, knee),
        "shin"+tag: (knee, ankle), "boot"+tag: (ankle, [.224, .143, side*.175]),
    })

names = list(rig)
color = lambda r,g,b: np.array([r,g,b])/255


def material(name, metallic=0, roughness=.7, coat=0):
    m = {"name":name, "pbrMetallicRoughness":{
        "baseColorFactor":[1,1,1,1],"metallicFactor":metallic,"roughnessFactor":roughness}}
    if coat:
        m["extensions"]={"KHR_materials_clearcoat":{"clearcoatFactor":coat,"clearcoatRoughnessFactor":.23}}
    materials.append(m)
    return len(materials)-1


def ellipsoid(p, center, axes):
    q=p-np.asarray(center)
    r=np.asarray(axes)
    k0=np.linalg.norm(q/r,axis=-1)
    k1=np.linalg.norm(q/(r*r),axis=-1)
    return np.divide(k0*(k0-1),k1,out=np.full(k0.shape,-r.min()),where=k1>1e-10)


def bone_dist(p,a,b):
    a,b=np.asarray(a),np.asarray(b)
    axis=b-a
    t=np.clip(np.sum((p-a)*axis,axis=-1)/np.dot(axis,axis),0,1)
    return p-a-t[...,None]*axis,t


def tapered(p,a,b,r0,r1,squash=1):
    delta,t=bone_dist(p,a,b)
    delta[...,0]/=squash
    return np.linalg.norm(delta,axis=-1)-(r0+(r1-r0)*t)


def union(a,b,soft):
    k=np.maximum(soft-np.abs(a-b),0)/soft
    return np.minimum(a,b)-k*k*soft*.25


def box(p,c,r,rounding):
    q=np.abs(p-np.asarray(c))-r+rounding
    return np.linalg.norm(np.maximum(q,0),axis=-1)+np.minimum(np.max(q,axis=-1),0)-rounding


def suit(p):
    d=ellipsoid(p,[-.021,.952,0],[.142,.172,.198])
    for center,axes in [
        ([.012,1.115,0],[.116,.196,.153]),
        ([.017,1.304,0],[.132,.221,.210]),
        ([.004,1.401,0],[.110,.116,.211]),
        ([.029,1.463,0],[.065,.049,.080]),
    ]:
        d=union(d,ellipsoid(p,center,axes),.040)
    for tag in "LR":
        for limb,r0,r1,squash in [
            ("arm",.077,.049,.89),("forearm",.054,.032,.89),
            ("thigh",.105,.062,1.07),("shin",.060,.038,1.05),
        ]:
            a,b=rig[limb+tag]
            d=union(d,tapered(p,a,b,r0,r1,squash),.038 if limb in ("arm","thigh") else .027)
        for joint,center,axes in [
            ("arm",[-.004,-.049,.015],[.091,.104,.084]),
            ("thigh",[-.017,-.144,.006],[.106,.168,.094]),
            ("shin",[-.013,-.102,.002],[.067,.134,.054]),
        ]:
            origin=rig[joint+tag][0]
            offset=[center[0],center[1],center[2]*(1 if tag=="R" else -1)]
            d=union(d,ellipsoid(p,np.add(origin,offset),axes),.023)
    return d


def rgb_suit(p):
    x,y,z=p.T
    lateral=np.abs(z)
    lower=np.clip((y-.92)*17,0,1)
    red=color(172,32,39)
    blue=color(21,38,58)
    result=lower[:,None]*red+(1-lower[:,None])*blue
    # The sleeves and hips have darker side panels and thin piping.
    panels=np.clip((lateral-.164)*19,0,1)*np.clip((y-.96)*13,0,1)
    result=(1-panels[:,None]*.49)*result+panels[:,None]*.49*color(103,18,32)
    seams=np.exp(-((lateral-.161)/.010)**2)*np.clip((y-.91)*9,0,1)
    result+=seams[:,None]*color(27,14,18)
    grain=np.sin(518*x+89*z)*np.sin(340*y-157*z)
    return np.clip(result+grain[:,None]*.014,0,1)


def weights(p):
    eligible=[n for n in names if not n.startswith(("head","neck","hand","boot"))]
    distances=np.stack([np.linalg.norm(bone_dist(p,*rig[n])[0],axis=-1) for n in eligible],axis=1)
    for i,n in enumerate(eligible):
        if n=="torso":
            distances[:,i]-=.065
        if n.startswith("thigh"):
            distances[:,i]-=.013
        if n!="torso":
            side=-1 if n.endswith("L") else 1
            distances[:,i]+=np.maximum(-side*p[:,2],0)*1.8
    order=np.argsort(distances,axis=1)[:,:4]
    nearest=np.take_along_axis(distances,order,axis=1)
    knee=np.exp(-((p[:,1]-.53)/.10)**2)
    elbow=np.exp(-((p[:,1]-1.16)/.08)**2)*np.clip((np.abs(p[:,2])-.23)*14,0,1)
    spread=.030+.010*np.maximum(knee,elbow)
    influence=np.exp(-(nearest-nearest[:,0,None])/spread[:,None])
    influence/=influence.sum(axis=1)[:,None]
    return np.array([names.index(n) for n in eligible],dtype="u1")[order],influence


def rgba_to_linear(rgb):
    rgb=np.asarray(rgb)
    return np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)


def surface(sdf, ranges, step, mat, shade, joint=None):
    axes=[np.linspace(low,high,round((high-low)/step)+1) for low,high in ranges]
    grid=np.stack(np.meshgrid(*axes,indexing="ij"),axis=-1)
    values=sdf(grid)
    steps=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]])
    shape=values.shape
    corners=np.stack([values[a:shape[0]-1+a,b:shape[1]-1+b,c:shape[2]-1+c] for a,b,c in steps],axis=-1)
    boundary=np.argwhere((corners.min(axis=-1)<0)&(corners.max(axis=-1)>=0))
    tetrahedra=[(0,5,1,6),(0,1,2,6),(0,2,3,6),(0,3,7,6),(0,7,4,6),(0,4,5,6)]
    edge_idx={}
    vertices=[]
    tris=[]
    for start in boundary:
        ids=start[None,:]+steps
        v=values[tuple(ids.T)]
        code=(ids[:,0]*shape[1]+ids[:,1])*shape[2]+ids[:,2]
        def edge(a,b):
            key=tuple(sorted((int(code[a]),int(code[b]))))
            i=edge_idx.get(key)
            if i is None:
                t=v[a]/(v[a]-v[b])
                p=grid[tuple(ids[a])]
                q=grid[tuple(ids[b])]
                i=len(vertices)
                edge_idx[key]=i
                vertices.append(p+(q-p)*t)
            return i
        for tet in tetrahedra:
            inside=[i for i in tet if v[i]<0]
            outside=[i for i in tet if v[i]>=0]
            if len(inside)==2:
                a,b=inside
                c,d=outside
                e,f,g,h=edge(a,c),edge(a,d),edge(b,d),edge(b,c)
                tris.extend([(e,f,g),(e,g,h)])
            elif len(inside)==1 or len(outside)==1:
                point,others=(inside[0],outside) if len(inside)==1 else (outside[0],inside)
                tris.append(tuple(edge(point,i) for i in others))
    if not tris:
        raise ValueError("An empty surface was generated")
    p=np.asarray(vertices)
    normals=np.stack([(sdf(p+axis*.001)-sdf(p-axis*.001)) for axis in np.eye(3)],axis=-1)
    normals/=np.maximum(1e-10,np.linalg.norm(normals,axis=-1)[:,None])
    indices=np.asarray(tris)
    paths=p[indices]
    inv=np.sum(np.cross(paths[:,1]-paths[:,0],paths[:,2]-paths[:,0])*normals[indices[:,0]],axis=1)<0
    indices[inv]=indices[inv][:,[0,2,1]]
    if joint is None:
        joints,w=weights(p)
    elif callable(joint):
        joints,w=joint(p)
    else:
        joints=np.zeros((len(p),4),dtype="u1")
        w=np.zeros((len(p),4))
        joints[:,0]=names.index(joint)
        w[:,0]=1
    colors=rgba_to_linear(shade(p) if callable(shade) else np.broadcast_to(shade,(len(p),3)))
    primitives.append((p,normals,colors,joints,w,indices,mat))


fabric=material("Kombinezon • matowa tkanina",roughness=.93)
helmet=material("Kask • lakier",roughness=.30,coat=.61)
goggles=material("Gogle • powłoka",metallic=.18,roughness=.22,coat=.74)
skin=material("Twarz",roughness=.76)
rubber=material("Buty i rękawice",roughness=.72)
goggle_trim=material("Oprawka i paski",roughness=.79)
surface(suit,[[-.22,.23],[.064,1.57],[-.52,.52]],.0147,fabric,rgb_suit)


def face_shape(p):
    d=ellipsoid(p,[.033,1.682,0],[.105,.120,.084])
    d=union(d,ellipsoid(p,[.073,1.638,0],[.069,.060,.071]),.018)
    d=union(d,ellipsoid(p,[.097,1.586,0],[.048,.039,.050]),.016)
    d=union(d,ellipsoid(p,[.139,1.652,0],[.027,.021,.019]),.011)
    d=union(d,ellipsoid(p,[.122,1.673,0],[.027,.035,.018]),.014)
    d=union(d,ellipsoid(p,[.126,1.613,0],[.022,.013,.031]),.010)
    mouth=ellipsoid(p,[.150,1.608,0],[.014,.0035,.028])
    neck=ellipsoid(p,[.027,1.524,0],[.055,.091,.061])
    nape=ellipsoid(p,[-.002,1.568,0],[.047,.061,.056])
    return np.maximum(union(d,union(neck,nape,.015),.024),-mouth)


def face_weights(p):
    y=p[:,1]
    shoulder=np.clip((1.502-y)/.039,0,1)
    skull=np.clip((y-1.554)/.067,0,1)
    shoulder=shoulder*shoulder*(3-2*shoulder)
    skull=skull*skull*(3-2*skull)
    joints=np.tile(np.array([names.index("torso"),names.index("neck"),names.index("head"),0],dtype="u1"),(len(p),1))
    return joints,np.column_stack((shoulder,1-shoulder-skull,skull,np.zeros(len(p))))


def face_tint(p):
    x,y,z=p.T
    mouth=np.exp(-((y-1.608)/.005)**2)*np.clip((x-.121)*55,0,1)*np.exp(-(z/.029)**4)
    cheek=np.exp(-((y-1.646)/.023)**2)*np.exp(-((np.abs(z)-.059)/.022)**2)
    shade=1-.08*np.clip((1.610-y)*34,0,1)
    return shade[:,None]*color(207,164,137)+cheek[:,None]*color(8,1,2)-mouth[:,None]*color(46,61,55)


def shell(p):
    x,y,z=np.moveaxis(p,-1,0)
    d=ellipsoid(p,[.006,1.706,0],[.139,.138,.107])
    # A cutout across the front leaves the face and a separate lens visible.
    cut=np.minimum(x-.056+(y-1.67)*.28,1.709-y)
    return -union(-d,-cut,.014)


def lens(p):
    d=ellipsoid(p,[.099,1.692,0],[.063,.043,.094])
    return -union(-d,p[...,0]-.081,.009)


def frame_and_straps(p):
    x,y,z=np.moveaxis(p,-1,0)
    frame=np.maximum(ellipsoid(p,[.091,1.691,0],[.065,.047,.098]),.073-x)
    band_outer=ellipsoid(p,[.006,1.706,0],[.144,.145,.113])
    band_inner=ellipsoid(p,[.006,1.706,0],[.137,.137,.104])
    band=np.maximum.reduce([band_outer,-band_inner,np.abs(y-(1.696+.085*x))-.013,x-.084])
    straps=[]
    for side in (-1,1):
        a=[.036,1.631,side*.093]
        b=[.105,1.563,side*.039]
        straps.append(tapered(p,a,b,.009,.006,.78))
    return np.minimum.reduce([frame,band,*straps])


def lens_tint(p):
    t=np.clip((p[:,1]-1.661)/.073,0,1)[:,None]
    return color(21,35,57)*(1-t)+color(89,149,181)*t


surface(face_shape,[[-.079,.18],[1.429,1.81],[-.102,.102]],.008,skin,face_tint,face_weights)
surface(shell,[[-.144,.155],[1.558,1.85],[-.114,.114]],.0115,helmet,color(232,236,244),"head")
surface(frame_and_straps,[[-.143,.163],[1.551,1.752],[-.119,.119]],.0075,goggle_trim,color(25,30,37),"head")
surface(lens,[[.078,.165],[1.644,1.74],[-.100,.10]],.0095,goggles,lens_tint,"head")
for tag in "LR":
    a,b=rig["hand"+tag]
    z=a[2]
    def glove(p):
        return tapered(p,a,b,.046,.030,.89)
    surface(glove,[[-.06,.093],[.79,.97],[z-.086,z+.092]],.013,rubber,color(24,31,42),"hand"+tag)
    a,b=rig["boot"+tag]
    z=a[2]
    def boot(p):
        sole=box(p,[.045,.045,z],[.160,.015,.054],.014)
        foot=ellipsoid(p,[.070,.092,z],[.143,.049,.054])
        cuff=ellipsoid(p,[-.026,.146,z],[.075,.066,.051])
        return union(sole,union(foot,cuff,.036),.020)
    def boot_tint(p):
        dark=np.broadcast_to(color(26,36,49),(len(p),3)).copy()
        dark[p[:,1]<.059]=color(11,18,30)
        trim=(np.abs(p[:,0]-.044)<.016)&(p[:,1]>.117)
        dark[trim]=color(185,194,197)
        return dark
    surface(boot,[[-.13,.23],[.024,.222],[z-.062,z+.062]],.010,rubber,boot_tint,"boot"+tag)

buffer=bytearray()
views=[]
accessors=[]


def accessor(array, dtype, typ, component, bounds=False, normalized=False):
    array=np.asarray(array,dtype=dtype)
    while len(buffer)%4:
        buffer.append(0)
    raw=array.tobytes()
    views.append({"buffer":0,"byteOffset":len(buffer),"byteLength":len(raw)})
    buffer.extend(raw)
    out={"bufferView":len(views)-1,"componentType":component,"count":len(array),"type":typ}
    if bounds:
        out.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    if normalized:
        out["normalized"]=True
    accessors.append(out)
    return len(accessors)-1


meshes=[]
for p,n,c,j,w,i,m in primitives:
    nw=np.round(w*65535).astype("<u2")
    delta=65535-nw.astype(np.int64).sum(axis=1)
    nw[:,0]=(nw[:,0]+delta).astype("<u2")
    meshes.append({
        "attributes":{
            "POSITION":accessor(p,"<f4","VEC3",5126,True),
            "NORMAL":accessor(n,"<f4","VEC3",5126),
            "COLOR_0":accessor(np.rint(c*65535),"<u2","VEC3",5123,normalized=True),
            "JOINTS_0":accessor(j,"u1","VEC4",5121),
            "WEIGHTS_0":accessor(nw,"<u2","VEC4",5123,normalized=True)
        },
        "indices":accessor(i.reshape(-1),"<u2" if len(p)<65536 else "<u4","SCALAR",5123 if len(p)<65536 else 5125),"material":m
    })
joint_nodes=[]
inverse=[]
for name,(start,end) in rig.items():
    joint_nodes.append({"name":name,"translation":start,"extras":{"restEnd":end}})
    bind=np.eye(4)
    bind[:3,3]=-np.asarray(start)
    inverse.append(bind.T.reshape(-1))
joints=list(range(1,len(names)+1))
gltf={
    "asset":{"version":"2.0","generator":"Podmuch • original athlete"},
    "extensionsUsed":["KHR_materials_clearcoat"],
    "scene":0,"scenes":[{"nodes":[0]}],
    "nodes":[{"name":"Podmuch athlete","children":[*joints,len(names)+1]},*joint_nodes,{"name":"Skoczek","mesh":0,"skin":0}],
    "meshes":[{"primitives":meshes}],"materials":materials,
    "skins":[{"joints":joints,"inverseBindMatrices":accessor(inverse,"<f4","MAT4",5126)}],
    "buffers":[{"byteLength":len(buffer)}],"bufferViews":views,"accessors":accessors
}
description=json.dumps(gltf,ensure_ascii=False,separators=(",",":")).encode()
description+=b" "*(-len(description)%4)
buffer.extend(b"\0"*(-len(buffer)%4))
output=root/"athlete.glb"
output.write_bytes(struct.pack("<4sII",b"glTF",2,28+len(description)+len(buffer))+
                   struct.pack("<I4s",len(description),b"JSON")+description+
                   struct.pack("<I4s",len(buffer),b"BIN\0")+buffer)
print(output.name, output.stat().st_size, "bytes,", sum(len(m[0]) for m in primitives), "vertices,", len(rig), "joints")
