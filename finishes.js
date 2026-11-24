// A repeatable surface sample in linear space. The three bands encode fine
// grain, slower density variation, and straight machine strokes respectively.
import * as THREE from 'three';

const side = 256;
let sequence = 70371;
function randomUnit() {
  sequence = (Math.imul(sequence, 1664525) + 1013904223) >>> 0;
  return sequence / 4294967296;
}
function noiseGrid(n) {
  const field = Float32Array.from({length: n*n}, randomUnit);
  return (x,y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x-ix, fy = y-iy;
    fx *= fx*(3-2*fx); fy *= fy*(3-2*fy);
    const at = (i,j) => field[(j%n)*n + i%n];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix,iy),at(ix+1,iy),fx),
      THREE.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),fx),fy);
  };
}
const cloud = noiseGrid(16), medium = noiseGrid(64);
const strokes = Float32Array.from({length: side}, randomUnit);
const pixels = new Uint8Array(side*side*4);
for (let y=0; y<side; y++) {
  for (let x=0; x<side; x++) {
    const i=4*(x+y*side), mid=medium(x/4,y/4), low=cloud(x/16,y/16);
    pixels.set([255*(.65*randomUnit()+.35*mid),255*(.68*low+.32*mid),
      255*(.62*strokes[y]+.24*mid+.14*low),255],i);
  }
}
export const grainMap = new THREE.DataTexture(pixels,side,side);
grainMap.wrapS=grainMap.wrapT=THREE.RepeatWrapping;
grainMap.magFilter=THREE.LinearFilter; grainMap.minFilter=THREE.LinearMipmapLinearFilter;
grainMap.generateMipmaps=true; grainMap.anisotropy=4; grainMap.needsUpdate=true;

export function brush(material, turned=false) {
  material.onBeforeCompile = (s) => {
    s.uniforms.grainMap = {value:grainMap};
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStock; varying vec3 vStockNormal;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvStock=position; vStockNormal=normal;');
    const uv=turned
      ? 'vec2(atan(vStock.z,vStock.x)*.32, mix(vStock.y, length(vStock.xz), smoothstep(.30,.84,abs(normalize(vStockNormal).y)))*.115)'
      : 'vec2((vStock.x+vStock.z)*.12, (vStock.y+.14*vStock.z)*.17)';
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D grainMap; varying vec3 vStock; varying vec3 vStockNormal;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec2 brushUV=${uv}; vec3 sampleStock=texture2D(grainMap,brushUV).rgb-.5;
        diffuseColor.rgb*=1.+.071*sampleStock.b+.035*sampleStock.g;`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+.075*sampleStock.b+.035*sampleStock.g,.18,.95);');
  };
  material.customProgramCacheKey=()=>turned?'turned-stock-1':'brushed-stock-1';
  return material;
}

// Parts can share their original positions and normals. The lighting sample
// belongs to a particular placement in the assembly, including repeated bolts.
export async function applyAssemblyLight(root, intensity) {
  const response=await fetch('data/hardware-contact.bin?v=studio2');
  if(!response.ok) throw new Error('Assembly illumination unavailable');
  const data=await response.arrayBuffer();
  const headerLength=new DataView(data).getUint32(0,true);
  const layout=JSON.parse(new TextDecoder().decode(new Uint8Array(data,4,headerLength)));
  const installed=new Set();
  for(const [path,[offset,count]] of Object.entries(layout)) {
    let obj=root;
    for(const child of path.split('.')) obj=obj?.children[Number(child)];
    if(!obj?.geometry || obj.geometry.attributes.position.count!==count) continue;
    const original=obj.geometry,g=new THREE.BufferGeometry();
    for(const [key,a] of Object.entries(original.attributes)) g.setAttribute(key,a);
    g.setIndex(original.index);g.groups=original.groups;
    const light=new Uint8Array(data,4+headerLength+offset,count);
    g.setAttribute('contactShade',new THREE.Uint8BufferAttribute(light.map(v=>255-v),1,true));
    obj.geometry=g;
    const m=obj.material;
    if(installed.has(m)) continue;
    installed.add(m);
    const compile=m.onBeforeCompile,stage=m.customProgramCacheKey();
    m.onBeforeCompile=(s,renderer)=>{
      compile.call(m,s,renderer);
      s.uniforms.contactStrength=intensity;
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float contactShade; varying float vContact;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvContact=contactShade;');
      s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying float vContact; uniform float contactStrength;')
        .replace('#include <opaque_fragment>','outgoingLight *= 1.-contactStrength*pow(clamp(vContact,0.,1.),.79);\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey=()=>stage+'-contact';m.needsUpdate=true;
  }
}
