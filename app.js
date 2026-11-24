// app.js — Hold My Jaw: the VERA head speaking from a gestural plan.
// Frame (cm): X = the head's left, Y = up, Z = forward. The anatomy drawing (x forward, y up) maps to (Z, Y) on X = 0.
import * as THREE from 'three';
import { buildHardware } from './hardware.js?v=studio2';
import { grainMap, applyAssemblyLight } from './finishes.js?v=studio2';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Anatomy, LA_CLOSED } from './tract.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FAKE = new URLSearchParams(location.search).has('fakeclock');   // local testing only (headless browsers do not advance audio time)
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); }

// ------------------------------------------------------------------------------------------------ geometry constants (cm)
const TMJ = new THREE.Vector3(0, 1.1, -8.4);           // J5 hinge axis (along X)
const PITCH = new THREE.Vector3(0, 2.6, -10.1);        // J2 axis (along X); also the side cut-outs
const YAW = new THREE.Vector3(0, -10.4, -10.1);        // J1 axis (vertical), top of the base
const EYE = { x: 3.1, y: 4.05, z: -2.0, r: 1.2 };     // each eye turns about its own centre (J3, J4)
const LIP_R = Math.hypot(1.1 - (-1.42), -8.4 - 1.0);  // hinge to the lip line: the aperture map's lever arm
const ORGAN = ['LIPS', 'TT', 'TBODY', 'JAW', 'VEL', 'GLO'];
const ORGAN_NAME = { LIPS: 'Lips', TT: 'Tongue tip', TBODY: 'Tongue body', JAW: 'Jaw', VEL: 'Velum', GLO: 'Glottis' };
const ORGAN_VAR = { LIPS: '--c-lips', TT: '--c-tt', TBODY: '--c-tb', JAW: '--c-jaw', VEL: '--c-vel', GLO: '--c-glo' };

// ------------------------------------------------------------------------------------------------ theme
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let C = {};
function readTheme() {
  const names = ['--ink', '--ink-2', '--ink-3', '--line', '--line-2', '--panel', '--surface', '--accent', '--blue', '--ok', '--warn', '--c-lips', '--c-tt', '--c-tb', '--c-jaw',
    '--c-vel', '--c-glo', '--c-pitch', '--a-skin', '--a-skin-edge', '--a-air', '--a-bone', '--a-bone-edge', '--a-tongue', '--a-tongue-edge', '--a-lip', '--a-soft',
    '--a-soft-edge', '--a-tooth', '--a-tooth-edge', '--rim'];
  C = Object.fromEntries(names.map((n) => [n.slice(2), css(n) || '#888']));
}
readTheme();

// ------------------------------------------------------------------------------------------------ data
const manifest = await getJSON('data/manifest.json');
const anat = await getJSON('data/anatomy.json');
const A = new Anatomy(anat.mean_cm, anat.palate_cm.flat(), anat.LA_CLOSED || LA_CLOSED);
const clipCache = new Map();
function getClip(id) {
  if(!clipCache.has(id)) {
    const clip=getJSON(manifest.clips.find(c=>c.id===id).file);
    clipCache.set(id,clip);clip.catch(()=>clipCache.delete(id));
  }
  return clipCache.get(id);
}

// ------------------------------------------------------------------------------------------------ renderer, scene, camera
const stage = $('#stage'), canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .985;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
// A 256 x 128 RGBE light probe supplies the actual softbox reflections.
async function studioLighting() {
  const response=await fetch('data/studio-rgbe.b64.txt');
  if(!response.ok) throw new Error('Studio light probe missing');
  const bytes=atob((await response.text()).trim());
  const radiance=new Float32Array(bytes.length);
  for(let i=0;i<bytes.length;i+=4) {
    const gain=2**(bytes.charCodeAt(i+3)-136);
    radiance[i]=bytes.charCodeAt(i)*gain;
    radiance[i+1]=bytes.charCodeAt(i+1)*gain;
    radiance[i+2]=bytes.charCodeAt(i+2)*gain;radiance[i+3]=1;
  }
  const image=new THREE.DataTexture(radiance,256,128,THREE.RGBAFormat,THREE.FloatType);
  image.mapping=THREE.EquirectangularReflectionMapping;image.colorSpace=THREE.LinearSRGBColorSpace;
  image.flipY=true;image.needsUpdate=true;
  const environment=pmrem.fromEquirectangular(image);
  image.dispose();pmrem.dispose();return environment.texture;
}
scene.environment=await studioLighting();
const camera = new THREE.PerspectiveCamera(23, 1, 2, 500);
const HOME = { pos: new THREE.Vector3(-44.65, 5.02, 47.25), tgt: new THREE.Vector3(0, 1.45, -7.4) };
const VIEWS = { face: HOME, xray: { pos: new THREE.Vector3(64, 7.5, 16), tgt: new THREE.Vector3(0, 0.4, -5.6) }, mech: { pos: new THREE.Vector3(58, 21, 69), tgt: new THREE.Vector3(0, -2.4, -8.4) } };
const fly = { t: 1, from: null, to: null };
function flyTo(v) { fly.from = { pos: camera.position.clone(), tgt: controls.target.clone() }; fly.to = v; fly.t = reduceMotion ? 1 : 0; if (reduceMotion) { camera.position.copy(v.pos); controls.target.copy(v.tgt); } }
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.tgt); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
controls.minDistance = 28; controls.maxDistance = 120; controls.minPolarAngle = 0.55; controls.maxPolarAngle = 2.05; controls.rotateSpeed = 0.7;
controls.update();

scene.add(new THREE.HemisphereLight('#fcfaf6', '#a89e93', 0.29));
const key = new THREE.DirectionalLight('#fff9f1', 2.00); key.position.set(-17, 31, 24); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 2; key.shadow.normalBias = .07; Object.assign(key.shadow.camera, { left: -16, right: 16, top: 17, bottom: -16, near: 9, far: 90 }); key.shadow.bias = -.00055;
key.target.position.set(0, -2, -8); scene.add(key, key.target);
const rim = new THREE.DirectionalLight('#e1e7ef', .88); rim.position.set(30, 20, -40); scene.add(rim);
const fill = new THREE.DirectionalLight('#e8eaf0', .31); fill.position.set(36, 5, 27); scene.add(fill);
// A broad floor reflection and a contact shadow beneath the base keep the
// studio floor soft. Directional shadows are reserved for the assembly itself.
const floorMap = document.createElement('canvas'); floorMap.width = floorMap.height = 256;
const floorCtx = floorMap.getContext('2d'), floorFalloff = floorCtx.createRadialGradient(128,128,0,128,128,127);
for (const [at, alpha] of [[0,.34],[.49,.29],[.60,.16],[.76,.065],[1,0]]) floorFalloff.addColorStop(at, 'rgba(45,40,32,'+alpha+')');
floorCtx.fillStyle = floorFalloff; floorCtx.fillRect(0,0,256,256);
const floorTexture = new THREE.CanvasTexture(floorMap); floorTexture.colorSpace = THREE.SRGBColorSpace;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(23,21), new THREE.MeshBasicMaterial({map:floorTexture,transparent:true,depthWrite:false,toneMapped:false}));
ground.rotation.x=-Math.PI/2; ground.renderOrder=-3; scene.add(ground);

// ------------------------------------------------------------------------------------------------ materials
const XR = { uXray: { value: 0 }, uRim: { value: new THREE.Color(C.rim) } };
function xrayify(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uXray = XR.uXray; sh.uniforms.uRim = XR.uRim;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uXray;\nuniform vec3 uRim;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uRim, uXray * (0.18 + 0.62 * fr));
        gl_FragColor.a *= mix(1.0, 0.035 + 0.5 * fr, uXray);`);
  };
  mat.customProgramCacheKey = () => 'xray-v1';
  return mat;
}
const M = {
  shell: xrayify(new THREE.MeshPhysicalMaterial({ color: '#f3f4f5', roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.16, side: THREE.DoubleSide })),
  chin: xrayify(new THREE.MeshPhysicalMaterial({ color: '#eff1f2', roughness: 0.32, clearcoat: 0.85, clearcoatRoughness: 0.16, side: THREE.DoubleSide })),
  base: new THREE.MeshPhysicalMaterial({ color: '#eef0f1', roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  print: new THREE.MeshStandardMaterial({ color: '#8c8f89', roughness: 0.6, transparent: true }),
  metal: new THREE.MeshStandardMaterial({ color: '#c3c9cf', metalness: 1, roughness: 0.26, transparent: true }),
  dark: new THREE.MeshStandardMaterial({ color: '#20272d', roughness: 0.45, metalness: 0.25, transparent: true }),
  cable: new THREE.MeshStandardMaterial({ color: '#2f63b5', roughness: 0.55, transparent: true }),
  cable2: new THREE.MeshStandardMaterial({ color: '#b8402f', roughness: 0.55, transparent: true }),
  mouth: new THREE.MeshBasicMaterial({ color: '#0d1114' }),
  sclera: new THREE.MeshPhysicalMaterial({ color: '#e8e0d5', envMapIntensity:.70, roughness: .35, clearcoat: .32, clearcoatRoughness: .22 }),
  tongue: new THREE.MeshStandardMaterial({ color: '#e0837b', roughness: 0.5, emissive: '#5a1612', emissiveIntensity: 0.55 }),
  lip: new THREE.MeshStandardMaterial({ color: '#d76c7a', roughness: 0.5, emissive: '#4e1220', emissiveIntensity: 0.5 }),
  bone: new THREE.MeshStandardMaterial({ color: '#efe6d3', roughness: 0.6, emissive: '#3b3324', emissiveIntensity: 0.45 }),
  tooth: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, emissive: '#3a3a3a', emissiveIntensity: 0.4 }),
  soft: new THREE.MeshStandardMaterial({ color: '#eab5ad', roughness: 0.6, emissive: '#47211c', emissiveIntensity: 0.45 }),
  wall: new THREE.MeshStandardMaterial({ color: '#efc9c0', roughness: 0.7, emissive: '#40201b', emissiveIntensity: 0.35, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
};
const MECH = [M.print, M.metal, M.dark, M.cable, M.cable2];

// Radial fibres run around the physical pupil well and darken at the limbus.
function irisTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  const grd=g.createLinearGradient(0,0,0,128);
  for (const [stop,col] of [[0,'#19272d'],[.15,'#4b5554'],[.35,'#304959'],
    [.63,'#446073'],[.85,'#2e4556'],[.95,'#19272f'],[1,'#0e171d']]) grd.addColorStop(stop,col);
  g.fillStyle=grd;g.fillRect(0,0,512,128);
  for (let i=0;i<360;i++) {
    const a=i*512/360, wave=Math.sin(i*13.71);
    g.strokeStyle=wave>0?'rgba(112,132,139,.31)':'rgba(16,35,42,.50)';g.lineWidth=1;
    g.beginPath();g.moveTo(a,10+9*Math.cos(i*6.13));g.quadraticCurveTo(a+wave*4,57,a+wave*2,114+7*wave);g.stroke();
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
const IRIS=new THREE.MeshStandardMaterial({map:irisTexture(),roughness:.66,envMapIntensity:.56});
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#a77a4a'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${70 + Math.random() * 40},${45 + Math.random() * 25},${20},${0.18 + Math.random() * 0.25})`; g.lineWidth = 1 + Math.random() * 3;
    const y = Math.random() * 256; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// The face, crown and jaw are finished, individually trimmed solids. Decode
// the sculpted surfaces without bringing the production model into the browser.
const header = await getJSON('data/vera_panels.json?v=studio2');
const loadPanels = async () => {
  const r = await fetch('data/vera_panels.bin?v=studio2'); if (!r.ok) throw new Error('Panel bundle missing');
  return r.arrayBuffer();
};
const panelBuffer = await loadPanels();
const LM = header.landmarks;
TMJ.fromArray(LM.tmj); PITCH.fromArray(LM.pitch); YAW.fromArray(LM.yaw);
EYE.x=Math.abs(LM.eyes[0][0]); EYE.y=LM.eyes[0][1]; EYE.z=LM.eyes[0][2]; EYE.r=LM.eye_r;
ground.position.set(0,LM.base_y-.012,YAW.z);
const ceramic = (color, opts={}) => xrayify(new THREE.MeshPhysicalMaterial({color,roughness:.62,
  clearcoat:.105,clearcoatRoughness:.40,envMapIntensity:.82,...opts}));
const finishes = {ivory:ceramic('#e4e0d7'),tinted:ceramic('#ffffff',{vertexColors:true}),
  graphite:xrayify(new THREE.MeshStandardMaterial({color:'#34312d',roughness:.76,side:THREE.DoubleSide})),
  cavity:xrayify(new THREE.MeshStandardMaterial({color:'#211e1c',roughness:.97,envMapIntensity:.14,side:THREE.DoubleSide})),
  lid:ceramic('#d8d2c8'),satin:ceramic('#b4aea3',{metalness:.55,roughness:.43}),
  fitting:ceramic('#79766d',{metalness:.48,roughness:.55})};
for(const finish of [finishes.ivory,finishes.tinted,finishes.lid,finishes.satin,finishes.fitting]) {
  const xray=finish.onBeforeCompile;
  finish.onBeforeCompile=(shader,renderer)=>{
    xray(shader,renderer);shader.uniforms.mouldMap={value:grainMap};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute float ambient; varying float vAmbient; varying vec3 vMould; varying vec3 vPrintN;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvAmbient=ambient; vMould=position; vPrintN=normal;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform sampler2D mouldMap; varying float vAmbient; varying vec3 vMould; varying vec3 vPrintN;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec3 weights=pow(abs(vPrintN),vec3(4.0));weights/=max(dot(weights,vec3(1.0)),.001);
        vec3 coord=vMould*.17;
        vec2 grain=(weights.x*texture2D(mouldMap,coord.yz).rg+weights.y*texture2D(mouldMap,coord.xz).rg+weights.z*texture2D(mouldMap,coord.xy).rg)-.5;
        diffuseColor.rgb*=mix(.43,1.0,vAmbient)*(1.+.13*grain.x+.095*grain.y);`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+.15*grain.x+.09*grain.y,.18,1.0);')
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 dp1=dFdx(-vViewPosition),dp2=dFdy(-vViewPosition);
        vec3 bx=cross(dp2,normal),by=cross(normal,dp1);float det=dot(dp1,bx);
        float h=.0033*grain.y+.0023*grain.x;
        normal=normalize(normal-sign(det)*(dFdx(h)*bx+dFdy(h)*by)/max(abs(det),.000001));`);
  };
  finish.customProgramCacheKey=()=>'vera-print-v2';
}
const shells = {mats:Object.values(finishes)};
const linearRGB=Float32Array.from({length:256},(_,i)=>{const c=i/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
for (const [family, panels] of Object.entries(header.parts)) {
  const assembly = new THREE.Group(); assembly.name=family;
  for (const p of panels) {
    const packed = new Uint16Array(panelBuffer,p.pos[0],3*p.nv), positions=new Float32Array(packed.length);
    for(let i=0;i<packed.length;i++) positions[i]=p.lo[i%3]+packed[i]*p.scale[i%3];
    const geom=new THREE.BufferGeometry(); geom.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geom.setAttribute('normal',new THREE.BufferAttribute(new Int16Array(panelBuffer,p.nrm[0],3*p.nv),3,true));
    const Index=p.index==='uint16'?Uint16Array:Uint32Array;
    geom.setIndex(new THREE.BufferAttribute(new Index(panelBuffer,p.idx[0],3*p.nf),1));
    if(p.ao) geom.setAttribute('ambient',new THREE.BufferAttribute(new Uint8Array(panelBuffer,p.ao[0],p.nv),1,true));
    if(p.col) {
      const rgb=new Uint8Array(panelBuffer,p.col[0],p.nv*3), colors=new Float32Array(rgb.length);
      for(let i=0;i<rgb.length;i++) colors[i]=linearRGB[rgb[i]];
      geom.setAttribute('color',new THREE.BufferAttribute(colors,3));
    }
    const panel=new THREE.Mesh(geom,finishes[p.mat]); panel.name=p.name;
    panel.castShadow=true;panel.receiveShadow=p.mat!=='cavity' && p.mat!=='graphite';assembly.add(panel);
  }
  shells[family]=assembly;
}

// ------------------------------------------------------------------------------------------------ hierarchy: base -> J1 -> yoke -> J2 -> head -> J5
const root = new THREE.Group(); scene.add(root);
const baseG = new THREE.Group(); root.add(baseG);
const yawG = new THREE.Group(); yawG.position.copy(YAW); baseG.add(yawG);
const yokeG = new THREE.Group(); yawG.add(yokeG);
const pitchG = new THREE.Group(); pitchG.position.set(0, PITCH.y - YAW.y, PITCH.z - YAW.z); yawG.add(pitchG);
const headG = new THREE.Group(); headG.position.set(0, -PITCH.y, -PITCH.z); pitchG.add(headG);   // children use the head frame directly
const jawPivot = new THREE.Group(); jawPivot.position.copy(TMJ); headG.add(jawPivot);
const jawG = new THREE.Group(); jawG.position.set(-TMJ.x, -TMJ.y, -TMJ.z); jawPivot.add(jawG);
const mechG = new THREE.Group(); headG.add(mechG);                  // carrier, servos, linkages (move with the head)
const tractG = new THREE.Group(); headG.add(tractG);
const axesG = new THREE.Group(); root.add(axesG);                     // joint arcs (mechanism view)

const mesh = (geo, mat, parent, opts = {}) => {
  const m = new THREE.Mesh(geo, mat); if (opts.pos) m.position.set(...opts.pos); if (opts.rot) m.rotation.set(...opts.rot);
  if (opts.shadow !== false) m.castShadow = true; parent.add(m); return m;
};
const rbox = (w, h, d, r = 0.25) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
function bar(a, b, r, mat, parent) {   // a cylinder between two points
  const A_ = new THREE.Vector3(...a), B_ = new THREE.Vector3(...b), d = B_.clone().sub(A_), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 14), mat); m.position.copy(A_).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; parent.add(m); return m;
}
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14);
function setBar(m, a, b, r) {   // reuse a unit cylinder mesh as a rod from a to b
  const d = new THREE.Vector3().subVectors(b, a), L = d.length() || 1e-6;
  m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(r, L, r); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.multiplyScalar(1 / L));
}

const P7=new THREE.Group();P7.name='P7';baseG.add(P7);
const P6=new THREE.Group();P6.name='P6';yokeG.add(P6);

// carrier P5 (inside the head), pitch shaft and servo
const P5 = new THREE.Group(); mechG.add(P5);
{
  const c = [0, PITCH.y + 2.15, PITCH.z - 0.25], s = [7.2, 6.6, 6.2], t = 0.62;
  for (const y of [-1, 1]) for (const z of [-1, 1]) mesh(rbox(s[0], t, t, 0.12), M.print, P5, { pos: [c[0], c[1] + y * s[1] / 2, c[2] + z * s[2] / 2] });
  for (const x of [-1, 1]) for (const z of [-1, 1]) mesh(rbox(t, s[1], t, 0.12), M.print, P5, { pos: [c[0] + x * s[0] / 2, c[1], c[2] + z * s[2] / 2] });
  for (const x of [-1, 1]) for (const y of [-1, 1]) mesh(rbox(t, t, s[2], 0.12), M.print, P5, { pos: [c[0] + x * s[0] / 2, c[1] + y * s[1] / 2, c[2]] });
  for (const x of [-1, 1]) mesh(rbox(0.4, 3.6, 3.6, 0.3), M.print, P5, { pos: [x * 3.6, PITCH.y + 0.4, PITCH.z] });     // side hubs on the pitch axis
  mesh(new THREE.CylinderGeometry(0.36, 0.36, 13.2, 16), M.metal, P5, { pos: [0, PITCH.y, PITCH.z], rot: [0, 0, Math.PI / 2] });   // pitch shaft
  mesh(rbox(3.4, 4.65, 2.85, 0.3), M.dark, P5, { pos: [4.65, PITCH.y + 0.85, PITCH.z] });                                       // XM430, pitch
  mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 24), M.metal, P5, { pos: [-6.05, PITCH.y, PITCH.z], rot: [0, 0, Math.PI / 2] }); // the other side's hub
  // Electronics housing behind the upper temple; the ear bay opens onto its
  // shaded carrier and the two real printed shrouds.
  mesh(rbox(7.75, 3.30, 6.15, .63), M.dark, P5, {pos:[0,9.27,-10.40]});
  mesh(rbox(2.4, 1.6, 0.5, 0.15), M.dark, P5, { pos: [0, EYE.y + 2.75, EYE.z - 5.15] });                                          // camera board
  mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 20), M.dark, P5, { pos: [0, EYE.y + 2.75, EYE.z - 4.5], rot: [Math.PI / 2, 0, 0] });
}
headG.add(shells.P1,shells.P2);jawG.add(shells.P3);P5.name='P5';
// The oral recess has a fixed upper edge and a lower occlusal edge carried by P3.
const mouthBox=new THREE.Group();headG.add(mouthBox);
const mouthLower=new THREE.Group();jawG.add(mouthLower);
const oralLiner=new THREE.MeshStandardMaterial({color:'#25201f',roughness:.85});
const ceramicEdge=new THREE.MeshStandardMaterial({color:'#b6a99a',roughness:.57});
const recess=mesh(new THREE.SphereGeometry(1,48,28),oralLiner,mouthBox,{pos:[0,-2.05,-2.78],shadow:false});
recess.scale.set(3.60,1.80,1.12);
// Behind the lip edges, short, separate occlusal pads follow the dental arc.
for(const [g,lower] of [[mouthBox,false],[mouthLower,true]]) {
  for(let i=0;i<8;i++) {
    const x=(i-3.5)*.50, arch=x*x;
    const pad=mesh(rbox(.48,.26,.51,.09),ceramicEdge,g,
      {pos:[x,(lower?-1.31:-1.03)+.014*arch,-.06-.138*arch]});
    pad.rotation.y=.27*x;pad.receiveShadow=true;
  }
}
// jaw support P4: U bracket on the hinge pins, rocker lever, chin plate
const P4 = new THREE.Group(); P4.name='P4'; jawG.add(P4);
{
  const pts = [[4.3, TMJ.y, TMJ.z], [4.37, -1.85, -5.48], [3.7, -2.94, -4.0], [2.2, -4.06, -2.73], [0, -4.22, -2.49], [-2.2, -4.06, -2.73], [-3.7, -2.94, -4.0], [-4.37, -1.85, -5.48], [-4.3, TMJ.y, TMJ.z]];
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 90, 0.34, 10), M.print, P4);
  for (const s of [1, -1]) mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.4, 20), M.metal, P4, { pos: [s * 4.3, TMJ.y, TMJ.z], rot: [0, 0, Math.PI / 2] });
  mesh(rbox(2.6, 0.4, 1.6, 0.15), M.print, P4, { pos: [0, -4.08, -1.87] });
}
const hardware=buildHardware({base:P7,yoke:P6,yawStage:yawG,carrier:P5,jaw:P4,pitch:PITCH,yaw:YAW,tmj:TMJ,
  groundY:LM.base_y,shellGroups:shells,screws:LM.screws});
MECH.push(...hardware.fade, M.sclera, IRIS, oralLiner);
for(const m of hardware.skin) shells.mats.push(xrayify(m));

const LEVER = { r: 1.6, a0: 135 * DEG, x: 4.6 };   // rocker lever on P4 (in the Z-Y plane at x)
const lever = new THREE.Mesh(unitCyl, M.print); P4.add(lever);
{ const a = new THREE.Vector3(LEVER.x, TMJ.y, TMJ.z), b = new THREE.Vector3(LEVER.x, TMJ.y + LEVER.r * Math.sin(LEVER.a0), TMJ.z + LEVER.r * Math.cos(LEVER.a0)); setBar(lever, a, b, 0.22); }
// jaw servo + crank + coupler (four-bar, solved every frame)
const CRANK = { S: new THREE.Vector2(TMJ.z-2.85, TMJ.y+.90), r: 1.0, x: 4.6 };    // (Z, Y) of the servo shaft
mesh(rbox(2.6, 2.0, 3.4, 0.22), M.dark, mechG, { pos: [CRANK.x - 1.65, CRANK.S.y, CRANK.S.x] });   // XL330
mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 20), M.metal, mechG, { pos: [CRANK.x - 0.25, CRANK.S.y, CRANK.S.x], rot: [0, 0, Math.PI / 2] });
const crank = new THREE.Mesh(unitCyl, M.metal), coupler = new THREE.Mesh(unitCyl, M.metal); mechG.add(crank, coupler);
const lever0 = new THREE.Vector2(TMJ.z + LEVER.r * Math.cos(LEVER.a0), TMJ.y + LEVER.r * Math.sin(LEVER.a0));
const crank0 = CRANK.S.clone().add(new THREE.Vector2(Math.cos(60 * DEG), Math.sin(60 * DEG)).multiplyScalar(CRANK.r));
const COUPLER_L = crank0.distanceTo(lever0);
let crankTip = crank0.clone();
function solveCrank(th) {   // th = J5 (rotation.x of the jaw); lever tip moves with the jaw
  const c = Math.cos(th), s = Math.sin(th), dz = lever0.x - TMJ.z, dy = lever0.y - TMJ.y;
  const L = new THREE.Vector2(TMJ.z + (dy * s + dz * c), TMJ.y + (dy * c - dz * s));
  const d = CRANK.S.distanceTo(L), a = (CRANK.r * CRANK.r - COUPLER_L * COUPLER_L + d * d) / (2 * d), h2 = CRANK.r * CRANK.r - a * a;
  if (h2 > 0 && d > 1e-6) {
    const base = CRANK.S.clone().add(L.clone().sub(CRANK.S).multiplyScalar(a / d)), h = Math.sqrt(h2);
    const perp = new THREE.Vector2(-(L.y - CRANK.S.y) / d, (L.x - CRANK.S.x) / d).multiplyScalar(h);
    const c1 = base.clone().add(perp), c2 = base.clone().sub(perp);
    crankTip = c1.distanceTo(crankTip) < c2.distanceTo(crankTip) ? c1 : c2;
  }
  const v = (p) => new THREE.Vector3(CRANK.x, p.y, p.x);
  setBar(crank, v(CRANK.S), v(crankTip), 0.2); setBar(coupler, v(crankTip), v(L), 0.13);
}
solveCrank(0);

// eyes (J3 common yaw, J4 common pitch; each about its own centre), lids, linkage
const eyes = [];
const cornealAngle=.515, irisR=EYE.r*Math.sin(cornealAngle), limbusZ=EYE.r*Math.cos(cornealAngle);
function opticalSurface(profile) {
  const position=[],uv=[],index=[],steps=80;
  for(let ring=0;ring<profile.length;ring++) {
    const [r,z,textureRadius]=profile[ring];
    for(let i=0;i<=steps;i++) {
      const u=i/steps, angle=u*2*Math.PI;
      position.push(r*Math.cos(angle),r*Math.sin(angle),z);
      uv.push(u,1-textureRadius);
      if(ring && i) {
        const out=ring*(steps+1)+i, inner=out-steps-1;
        index.push(inner-1,out-1,inner,inner,out-1,out);
      }
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
  return g;
}
const irisDish=opticalSurface([[.44*irisR,limbusZ-.055,0],[.53*irisR,limbusZ-.02,.14],
  [.65*irisR,limbusZ+.002,.37],[.86*irisR,limbusZ-.027,.76],[irisR,limbusZ-.01,1]]);
const pupilMat=new THREE.MeshBasicMaterial({color:'#080d10'});
const pupil=opticalSurface([[0,limbusZ-.13,0],[.46*irisR,limbusZ-.125,1],[.46*irisR,limbusZ-.045,1]]);
const globe=new THREE.SphereGeometry(EYE.r,80,48,0,Math.PI*2,cornealAngle,Math.PI-cornealAngle);
globe.rotateX(Math.PI/2);
// A clear cornea has a smaller radius of curvature than the white globe.
// Project the key and fill softboxes in reflection space so the catchlights
// move across the glass when the visitor or the eye changes direction.
const cornealR=irisR*1.20, cornealSweep=Math.asin(irisR/cornealR);
const cornea=new THREE.SphereGeometry(cornealR,72,28,0,Math.PI*2,0,cornealSweep);
cornea.rotateX(Math.PI/2);cornea.translate(0,0,limbusZ-Math.sqrt(cornealR**2-irisR**2));
const clearGlass=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
  vertexShader:`varying vec3 vEyeN; varying vec3 vToCamera;
  void main(){ vec4 p=modelMatrix*vec4(position,1.);vEyeN=mat3(modelMatrix)*normal;
    vToCamera=cameraPosition-p.xyz;gl_Position=projectionMatrix*viewMatrix*p; }`,
  fragmentShader:`varying vec3 vEyeN; varying vec3 vToCamera;
  float softbox(vec3 ray,vec3 axis,vec2 halfSize) {
    axis=normalize(axis);vec3 dx=normalize(cross(vec3(0,1,0),axis)),dy=cross(axis,dx);
    if(dot(ray,axis)<0.) return 0.;
    vec2 d=abs(vec2(dot(ray,dx),dot(ray,dy)))-halfSize;
    return 1.-smoothstep(-.024,.024,length(max(d,vec2(0.)))+min(max(d.x,d.y),0.)); }
  void main(){vec3 n=normalize(vEyeN),eye=normalize(vToCamera),r=reflect(-eye,n);
    float key=softbox(r,vec3(.20,.43,.93),vec2(.15,.105));
    float fill=softbox(r,vec3(-.57,.73,.73),vec2(.075,.16));
    float fres=pow(1.-clamp(dot(n,eye),0.,1.),4.);
    gl_FragColor=vec4(mix(vec3(.49,.60,.67),vec3(1.,.98,.94),key),.025+.18*fres+.81*key+.31*fill); }`});
for(const side of [-1,1]) {
  const g=new THREE.Group();g.position.set(side*EYE.x,EYE.y,EYE.z);mechG.add(g);
  const ball=new THREE.Group();g.add(ball);
  const cup=mesh(new THREE.SphereGeometry(1,48,30),oralLiner,g,{pos:[0,0,-.82]});cup.scale.set(2.13,1.80,1.04);
  mesh(globe,M.sclera,ball,{shadow:false}).receiveShadow=true;
  mesh(irisDish,IRIS,ball,{shadow:false}).receiveShadow=true;
  mesh(pupil,pupilMat,ball,{shadow:false});
  mesh(cornea,clearGlass,ball,{shadow:false});
  mesh(rbox(.3,.3,1.9,.1),M.metal,ball,{pos:[0,0,-1.9]});
  const gimbal=mesh(new THREE.TorusGeometry(EYE.r+.06,.07,12,64),M.print,g,{pos:[0,0,-1.39]});
  gimbal.scale.y=.94;eyes.push({g,ball});
}
const tieRod = new THREE.Mesh(unitCyl, M.metal), eyeLinkY = new THREE.Mesh(unitCyl, M.metal), eyeLinkP = new THREE.Mesh(unitCyl, M.metal); mechG.add(tieRod, eyeLinkY, eyeLinkP);
const EYE_SERVO_Y = [EYE.y + 1.65, EYE.y - 1.45], EYE_SERVO_Z = EYE.z - 4.4;
mesh(rbox(2.0, 2.6, 2.4, 0.2), M.dark, mechG, { pos: [0, EYE_SERVO_Y[0], EYE_SERVO_Z] });   // XL330, eye yaw
mesh(rbox(2.0, 2.6, 2.4, 0.2), M.dark, mechG, { pos: [0, EYE_SERVO_Y[1], EYE_SERVO_Z] });   // XL330, eye pitch
{ const c = new THREE.CatmullRomCurve3([[0, EYE_SERVO_Y[0] + 1.3, EYE_SERVO_Z], [0.8, EYE_SERVO_Y[0] + 2.3, EYE_SERVO_Z - 1.6], [1.5, EYE_SERVO_Y[0] + 2.5, PITCH.z + 0.6]].map((p) => new THREE.Vector3(...p))); mesh(new THREE.TubeGeometry(c, 30, 0.12, 8), M.cable, mechG); }

// ------------------------------------------------------------------------------------------------ the vocal tract (X-ray)
function resample(P, N) {   // closed polygon (flat x,y) -> N points equally spaced along its outline
  const n = P.length >> 1, cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(P[2 * j] - P[2 * i], P[2 * j + 1] - P[2 * i + 1]); }
  const L = cum[n] || 1e-9, out = new Float64Array(2 * N); let k = 0;
  for (let q = 0; q < N; q++) {
    const s = (q / N) * L; while (k < n - 1 && cum[k + 1] < s) k++;
    const j = (k + 1) % n, t = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1e-9);
    out[2 * q] = lerp(P[2 * k], P[2 * j], t); out[2 * q + 1] = lerp(P[2 * k + 1], P[2 * j + 1], t);
  }
  return out;
}
class Pillow {   // a closed mid-sagittal outline swept across X into a rounded solid
  constructor(N, K, halfW, mat, opt = {}) {
    Object.assign(this, { N, K, halfW, minS: opt.minS ?? 0.2, pw: opt.pw ?? 0.55, bendZ: opt.bendZ ?? 0, bendY: opt.bendY ?? 0, x0: opt.x0 ?? 0 });
    const nv = K * N + 2, g = new THREE.BufferGeometry(); this.pos = new Float32Array(nv * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = [];
    for (let j = 0; j < K - 1; j++) for (let i = 0; i < N; i++) {
      const a = j * N + i, b = j * N + (i + 1) % N, c = (j + 1) * N + (i + 1) % N, d = (j + 1) * N + i; idx.push(a, d, b, b, d, c);
    }
    const c0 = K * N, c1 = K * N + 1;
    for (let i = 0; i < N; i++) { idx.push(c0, i, (i + 1) % N); idx.push(c1, (K - 1) * N + (i + 1) % N, (K - 1) * N + i); }
    g.setIndex(idx); this.geo = g; this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false;
  }
  set(P) {
    const { N, K, halfW, minS, pw, bendZ, bendY, x0 } = this, R = resample(P, N), pos = this.pos;
    let cz = 0, cy = 0; for (let i = 0; i < N; i++) { cz += R[2 * i]; cy += R[2 * i + 1]; } cz /= N; cy /= N;
    for (let j = 0; j < K; j++) {
      const ph = -Math.PI / 2 + Math.PI * j / (K - 1), x = halfW * Math.sin(ph), s = minS + (1 - minS) * Math.pow(Math.max(Math.cos(ph), 0), pw);
      for (let i = 0; i < N; i++) {
        const o = 3 * (j * N + i);
        pos[o] = x0 + x; pos[o + 1] = cy + s * (R[2 * i + 1] - cy) - bendY * x * x; pos[o + 2] = cz + s * (R[2 * i] - cz) - bendZ * x * x;
      }
    }
    const e0 = 3 * K * N, e1 = e0 + 3;
    pos[e0] = x0 - halfW; pos[e0 + 1] = cy - bendY * halfW * halfW; pos[e0 + 2] = cz - bendZ * halfW * halfW;
    pos[e1] = x0 + halfW; pos[e1 + 1] = cy - bendY * halfW * halfW; pos[e1 + 2] = cz - bendZ * halfW * halfW;
    this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals();
  }
}
const ring = (P, open = false) => open ? P : P;
function stripOf(line, w) {   // an open line -> a closed band of width w around it
  const n = line.length >> 1, up = [], dn = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1), gx = line[2 * b] - line[2 * a], gy = line[2 * b + 1] - line[2 * a + 1], g = Math.hypot(gx, gy) || 1e-9;
    up.push(line[2 * i] - gy / g * w / 2, line[2 * i + 1] + gx / g * w / 2); dn.push(line[2 * i] + gy / g * w / 2, line[2 * i + 1] - gx / g * w / 2);
  }
  const o = up.slice(); for (let i = n - 1; i >= 0; i--) o.push(dn[2 * i], dn[2 * i + 1]); return Float64Array.from(o);
}
const T = {
  palate: new Pillow(110, 9, 2.5, M.bone, { bendZ: 0.05, bendY: 0.12, pw: 0.35 }),
  velum: new Pillow(70, 7, 1.6, M.soft, { pw: 0.5 }),
  wall: new Pillow(90, 7, 2.1, M.wall, { pw: 0.25, bendZ: -0.1 }),
  epi: new Pillow(40, 5, 0.75, M.soft),
  tongue: new Pillow(128, 11, 2.15, M.tongue, { minS: 0.22, pw: 0.5 }),
  ulip: new Pillow(64, 9, 2.25, M.lip, { minS: 0.3, pw: 0.45, bendZ: 0.17 }),
  llip: new Pillow(64, 9, 2.05, M.lip, { minS: 0.3, pw: 0.45, bendZ: 0.17 }),
  sym: new Pillow(64, 9, 2.0, M.bone, { minS: 0.35, pw: 0.4, bendZ: 0.3 }),
};
const TEETH_X = [-1.25, -0.42, 0.42, 1.25];
const teethU = TEETH_X.map((x) => new Pillow(36, 5, 0.38, M.tooth, { x0: x, minS: 0.55 })), teethL = TEETH_X.map((x) => new Pillow(36, 5, 0.34, M.tooth, { x0: x * 0.92, minS: 0.55 }));
for (const p of [...Object.values(T), ...teethU, ...teethL]) tractG.add(p.mesh);
T.palate.set(A.bone); T.velum.set(A.velum); T.wall.set(stripOf(A.pw, 0.34)); T.epi.set(A.epi);
teethU.forEach((p, i) => { p.set(A.ui); p.mesh.position.z = -0.3 * TEETH_X[i] ** 2; });
const SENSORS = ['TD', 'TB', 'TT', 'LI', 'UL', 'LL'];
const sensorDots = SENSORS.map((k) => {
  const col = { TD: C['c-tb'], TB: C['c-tb'], TT: C['c-tt'], LI: C['c-jaw'], UL: C['c-lips'], LL: C['c-lips'] }[k];
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
  m.renderOrder = 30; tractG.add(m); return m;
});

// ------------------------------------------------------------------------------------------------ things on the face (loads)
const props = {};
{
  const w = new THREE.Group(); jawG.add(w);   // weight hanging under the chin
  mesh(new THREE.TorusGeometry(0.35, 0.08, 8, 20), M.metal, w, { pos: [0, -5.45, -0.6] });
  bar([0, -5.75, -0.6], [0, -9.0, -0.6], 0.05, M.dark, w);
  mesh(new THREE.CylinderGeometry(1.3, 1.6, 2.3, 32), new THREE.MeshStandardMaterial({ color: '#3d4750', metalness: 0.6, roughness: 0.45 }), w, { pos: [0, -10.3, -0.6] });
  mesh(new THREE.TorusGeometry(0.55, 0.12, 10, 24, Math.PI), M.metal, w, { pos: [0, -9.1, -0.6] });
  props.weight = w;
  const pen = new THREE.Group(); headG.add(pen);   // pen across the mouth, between the teeth
  const penBody = mesh(new THREE.CylinderGeometry(0.42, 0.42, 11, 24), new THREE.MeshStandardMaterial({ color: '#f2a93b', roughness: 0.45 }), pen, { rot: [0, 0, Math.PI / 2] });
  mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.6, 24), new THREE.MeshStandardMaterial({ color: '#e2574c', roughness: 0.45 }), pen, { pos: [5.0, 0, 0], rot: [0, 0, Math.PI / 2] });
  mesh(new THREE.ConeGeometry(0.42, 1.2, 24), new THREE.MeshStandardMaterial({ color: '#f3dfc0', roughness: 0.6 }), pen, { pos: [-6.1, 0, 0], rot: [0, 0, Math.PI / 2] });
  props.pen = pen; props.penBody = penBody;
  const band = new THREE.Group(); jawG.add(band);   // rubber band from the lower lip to the chin
  const bc = new THREE.CatmullRomCurve3([[0.85, -1.95, 1.0], [1.05, -3.0, 0.8], [1.0, -4.3, 0.95], [0.65, -5.38, 0.15], [-0.65, -5.38, 0.15], [-1.0, -4.3, 0.95], [-1.05, -3.0, 0.8], [-0.85, -1.95, 1.0]].map((p) => new THREE.Vector3(...p)), true);
  mesh(new THREE.TubeGeometry(bc, 90, 0.13, 10, true), new THREE.MeshStandardMaterial({ color: '#d8453b', roughness: 0.5 }), band);
  props.band = band;
  const gum = mesh(new THREE.SphereGeometry(0.62, 24, 16), new THREE.MeshStandardMaterial({ color: '#8fdcb2', roughness: 0.35, emissive: '#1f5a3e', emissiveIntensity: 0.5 }), tractG, { shadow: false });
  gum.scale.set(1.3, 0.55, 1.0); gum.renderOrder = 25; props.gum = gum;
  const hand = new THREE.Group(); headG.add(hand);   // a gloved hand holding the chin up
  const glove = new THREE.MeshStandardMaterial({ color: '#86acd9', roughness: 0.6 });
  mesh(rbox(6.4, 1.5, 6.0, 0.7), glove, hand, { pos: [0, -6.4, -1.6], rot: [0.12, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const x = -2.25 + i * 1.5, f = new THREE.CatmullRomCurve3([[x, -6.2, 1.3], [x, -5.4, 2.4], [x, -4.2, 2.3]].map((p) => new THREE.Vector3(...p)));
    mesh(new THREE.TubeGeometry(f, 16, 0.55, 12), glove, hand);
  }
  mesh(rbox(1.6, 1.3, 4.5, 0.6), glove, hand, { pos: [-3.8, -7.1, -4.6] });
  const arm = new THREE.CatmullRomCurve3([[0, -6.9, -3.5], [0, -9.5, -1.0], [0, -14, 4]].map((p) => new THREE.Vector3(...p)));
  mesh(new THREE.TubeGeometry(arm, 20, 2.0, 16), glove, hand);
  props.hand = hand;
  const table = new THREE.Group(); baseG.add(table);   // the chin on a table
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 });
  const top = mesh(rbox(44, 1.6, 22, 0.4), wood, table, { pos: [0, -6.3, 5.2] }); top.receiveShadow = true;
  for (const [x, z] of [[-20, 15], [20, 15]]) mesh(new THREE.CylinderGeometry(0.9, 0.9, 6.5, 16), wood, table, { pos: [x, -10.3, z] });
  props.table = table;
  for (const k of ['weight', 'pen', 'band', 'gum', 'hand', 'table']) props[k].visible = false;
}

// ------------------------------------------------------------------------------------------------ joint arcs and tags (mechanism view)
function arcArrow(r, tube, color, sweep = 1.55 * Math.PI) {
  const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false });
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 64, sweep), mat); t.renderOrder = 40; g.add(t);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.2, tube * 7, 16), mat); cone.renderOrder = 40;
  cone.position.set(r * Math.cos(sweep), r * Math.sin(sweep), 0); cone.rotation.z = sweep; g.add(cone); return g;
}
const AX = {};
{
  const blue = C.blue, orange = C.accent;
  AX.J1 = arcArrow(5.4, 0.1, blue); AX.J1.rotation.x = Math.PI / 2; AX.J1.position.set(YAW.x, YAW.y + 0.7, YAW.z); baseG.add(AX.J1);
  AX.J2 = arcArrow(1.9, 0.09, orange); AX.J2.rotation.y = Math.PI / 2; AX.J2.position.set(8.3, PITCH.y - YAW.y, 0); yawG.add(AX.J2);
  AX.J3 = arcArrow(1.75, 0.07, blue); AX.J3.rotation.x = Math.PI / 2; AX.J3.position.set(EYE.x, EYE.y + 0.1, EYE.z); headG.add(AX.J3);
  AX.J4 = arcArrow(1.75, 0.07, orange); AX.J4.rotation.y = Math.PI / 2; AX.J4.position.set(-EYE.x - 1.5, EYE.y, EYE.z); headG.add(AX.J4);
  AX.J5 = arcArrow(1.5, 0.08, orange); AX.J5.rotation.y = Math.PI / 2; AX.J5.position.set(6.4, TMJ.y, TMJ.z); headG.add(AX.J5);
}
const AXES = Object.values(AX); AXES.forEach((a) => { a.visible = false; });
const TAGS = [
  { id: 'J1', text: 'J1 yaw', cls: 'j b', obj: baseG, at: [5.4, YAW.y + 0.7, YAW.z + 0.1] },
  { id: 'J2', text: 'J2 pitch', cls: 'j o', obj: yawG, at: [8.3, PITCH.y - YAW.y + 2.3, 0] },
  { id: 'J3', text: 'J3 eye yaw', cls: 'j b', obj: headG, at: [EYE.x, EYE.y + 2.0, EYE.z] },
  { id: 'J4', text: 'J4 eye pitch', cls: 'j o', obj: headG, at: [-EYE.x - 1.5, EYE.y + 2.1, EYE.z] },
  { id: 'J5', text: 'J5 jaw', cls: 'j o', obj: headG, at: [6.4, TMJ.y - 2.1, TMJ.z] },
  { id: 'P1', text: 'P1 face shell', cls: '', obj: shells.P1, at: [0, 10.5, -1.5] },
  { id: 'P2', text: 'P2 rear cover', cls: '', obj: shells.P2, at: [0, 11.5, -14.5] },
  { id: 'P3', text: 'P3 chin panel', cls: '', obj: shells.P3, at: [0, -4.6, 1.2] },
  { id: 'P4', text: 'P4 jaw support', cls: '', obj: P4, at: [-4.3, -2.0, -5.4] },
  { id: 'P5', text: 'P5 carrier', cls: '', obj: P5, at: [-3.6, 8.2, -10.4] },
  { id: 'P6', text: 'P6 pitch yoke', cls: '', obj: P6, at: [-3.8,3.5,0] },
  { id: 'P7', text: 'P7 base', cls: '', obj:P7, at:[0,LM.base_y+1.1,YAW.z+6.6] },
];
const tagLayer = $('#tags');
for (const t of TAGS) { t.el = document.createElement('div'); t.el.className = 'tag ' + t.cls; t.el.textContent = t.text; t.el.hidden = true; tagLayer.appendChild(t.el); }

// ------------------------------------------------------------------------------------------------ views: face / X-ray / mechanism
const view = { mode: 'face', x: 0, xT: 0, mech: 1, mechT: 1, tract: 0, tractT: 0, explode: 0, explodeT: 0 };
function setView(mode) {
  view.mode = mode;
  showCutaway(mode==='mech' ? false : cutawayVisible);
  view.xT = mode === 'face' ? 0 : 1;
  view.tractT = mode === 'xray' ? 1 : 0;
  view.mechT = mode === 'xray' ? 0.045 : 1;
  for (const [id, m] of [['#v-face', 'face'], ['#v-xray', 'xray'], ['#v-mech', 'mech']]) $(id).setAttribute('aria-pressed', String(mode === m));
  $('#explode').hidden = mode !== 'mech';
  AXES.forEach((a) => { a.visible = mode === 'mech'; });
  flyTo(VIEWS[mode]);
  if (mode !== 'mech') { view.explodeT = 0; $('#explode-r').value = 0; }
  hint(false);
}
$('#v-face').onclick = () => setView('face');
$('#v-xray').onclick = () => setView('xray');
$('#v-mech').onclick = () => setView('mech');
$('#explode-r').oninput = (e) => { view.explodeT = +e.target.value; };
if ($('#explode-btn')) $('#explode-btn').onclick = () => { setView('mech'); view.explodeT = 1; $('#explode-r').value = 1; stage.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); };
$('#reset-btn').onclick = () => flyTo(VIEWS[view.mode]);
const flatBox = $('#flat');
let cutawayVisible = true;
function showCutaway(visible) {
  flatBox.hidden = !visible;
  $('#flat-btn').setAttribute('aria-pressed', String(visible));
}
$('#flat-btn').onclick = () => {
  const visible = flatBox.hidden;
  if (view.mode !== 'mech') cutawayVisible = visible;
  showCutaway(visible);
};
let hintT = null;
function hint(show, text) { const h = $('#hint'); if (text) h.textContent = text; h.classList.toggle('gone', !show); clearTimeout(hintT); if (show) hintT = setTimeout(() => h.classList.add('gone'), 6000); }

// ------------------------------------------------------------------------------------------------ audio: one clock, variants switched in place
async function fetchAudio(url) {   // plain mp3 beside the page
  const r = await fetch(url); if (!r.ok) throw new Error(url); return r.arrayBuffer();
}
class Player {
  constructor() { this.ctx = null; this.buf = new Map(); this.raw = new Map(); this.src = null; this.gain = null; this.url = null; this.t0 = 0; this.off = 0; this.playing = false; this.starting = false; this.revision = 0; this.dur = 0; this.onstart = null; this.onend = null; }
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  prefetch(url) {
    if(!url || this.raw.has(url)) return;
    const bytes=fetchAudio(url); this.raw.set(url,bytes);
    bytes.catch(()=>this.raw.delete(url));
  }
  async buffer(url) {
    if (!this.buf.has(url)) {
      this.prefetch(url);
      const decoded=this.raw.get(url).then(a=>new Promise((res,rej)=>this.ctx.decodeAudioData(a.slice(0),res,rej)));
      this.buf.set(url,decoded);
      decoded.catch(()=>{ this.buf.delete(url); this.raw.delete(url); });
    }
    return this.buf.get(url);
  }
  time() { if (FAKE && this.playing) return clamp((performance.now() / 1000) - this.f0, 0, this.dur); return this.playing ? clamp(this.ctx.currentTime - this.t0, 0, this.dur) : this.off; }
  async play(url, from = this.off) {
    const revision=++this.revision;
    this.starting=true; this.ensure();
    let b;
    try { b=await this.buffer(url); }
    catch(error) { if(revision!==this.revision) return false; this.starting=false; throw error; }
    if(revision!==this.revision) return false;
    this.starting=false; const ctx=this.ctx;
    if(from==null) from=this.time();
    this.stopSrc();
    const g = ctx.createGain(), s = ctx.createBufferSource(); s.buffer = b; s.connect(g); g.connect(ctx.destination);
    const now = ctx.currentTime + 0.03, at = clamp(from, 0, Math.max(b.duration - 0.05, 0));
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 0.03);
    s.start(now, at); this.src = s; this.gain = g; this.url = url; this.t0 = now - at; this.f0 = performance.now() / 1000 - at; this.dur = b.duration; this.playing = true;
    s.onended = () => { if (this.src === s) { this.playing = false; this.off = 0; this.src = null; this.onend && this.onend(); } };
    this.onstart?.();
    return true;
  }
  pause() { ++this.revision; this.starting=false; if (!this.playing) return; this.off = this.time(); this.stopSrc(); this.playing = false; }
  stopSrc() {
    if (!this.src) return; const s = this.src, g = this.gain, now = this.ctx.currentTime; this.src = null;
    g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + 0.03); s.onended = null; s.stop(now + 0.04);
  }
  async swap(url) {
    this.requestedUrl=url;
    if(this.starting || (this.playing && url!==this.url)) { await this.play(url,null); }
    else this.url=url;
  }
  seek(t) {
    if(this.playing || this.starting) this.play(this.requestedUrl||this.url,t).catch(()=>this.onfail?.());
    else this.off=t;
  }
}
const player = new Player();

// ------------------------------------------------------------------------------------------------ state, clips, UI
const S = { kind: 'speech', clip: null, load: null, reflex: true, t: 0, ema: null, anim: null };
const SHELF = {
  weight: { name: 'Weight', title: 'A weight on the chin', icon: '<circle cx="24" cy="10.5" r="4.2" fill="none" stroke="#8fa0ad" stroke-width="2.6"/><path d="M16.5 15.5h15l5.2 21.3q.9 4.7-3.6 4.7H14.9q-4.5 0-3.6-4.7z" fill="#5a6b78" stroke="#38464f" stroke-width="1.6" stroke-linejoin="round"/><path d="M18 21h12" stroke="#c2d0da" stroke-width="2" stroke-linecap="round" opacity=".7"/>' },
  pen: { name: 'Pen', title: 'A pen between the teeth', icon: '<g transform="rotate(-118 24 24)"><rect x="20" y="5" width="8" height="28" rx="1.5" fill="#f2a93b" stroke="#8a560c" stroke-width="1.6"/><path d="M20 33h8l-4 9z" fill="#f3dfc0" stroke="#8a560c" stroke-width="1.6" stroke-linejoin="round"/><path d="M22.6 38.9h2.8L24 42z" fill="#3a2a12"/><rect x="20" y="5" width="8" height="5" rx="1.5" fill="#e2574c" stroke="#8a560c" stroke-width="1.6"/></g>' },
  band: { name: 'Band', title: 'A rubber band from the lower lip to the chin', icon: '<ellipse cx="24" cy="24" rx="15" ry="10.5" fill="none" stroke="#8c2a24" stroke-width="6" transform="rotate(-18 24 24)"/><ellipse cx="24" cy="24" rx="15" ry="10.5" fill="none" stroke="#e2574c" stroke-width="3.2" transform="rotate(-18 24 24)"/>' },
  gum: { name: 'Gum', title: 'Gum on the tongue', icon: '<path d="M9.5 31c-.9-7.6 4.2-13.3 10.7-12.3 2.7-4.7 9.9-4.6 12.5.3 5.6-.3 9.3 5.4 8 12z" fill="#c9f0dc" stroke="#4f9a78" stroke-width="1.7" stroke-linejoin="round"/><path d="M17 26.5q2.5-2.8 5.5-1.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M13 35.5h23" stroke="#4f9a78" stroke-width="1.7" stroke-linecap="round"/>' },
  hand: { name: 'Hand', title: 'A hand that holds the chin up', icon: '<path d="M8 27.5c0-2.2 1.8-4 4-4h17.5c2 0 3.5 1.4 3.5 3.2 0 1.9-1.5 3.3-3.5 3.3H26l11.2.1c2 0 3.3 1.3 3.3 3 0 1.8-1.3 3-3.3 3l-2.7.1c1.7.2 2.8 1.3 2.8 2.8 0 1.7-1.3 2.8-3.2 2.8H17.5C12 41.8 8 37.9 8 32.5z" fill="#c3d0d9" stroke="#51626e" stroke-width="1.7" stroke-linejoin="round"/><path d="M22 18V7.5M17.2 12.3 22 7.5l4.8 4.8" fill="none" stroke="#51626e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  table: { name: 'Table', title: 'The chin on a table', icon: '<rect x="5" y="17" width="38" height="6" rx="1.5" fill="#a9824f" stroke="#5f4526" stroke-width="1.6"/><path d="M11 23v18M37 23v18" stroke="#5f4526" stroke-width="5.2" stroke-linecap="round"/><path d="M11 23v18M37 23v18" stroke="#8d6c46" stroke-width="2.4" stroke-linecap="round"/>' },
};
const shelf = $('#shelf');
for (const [k, v] of Object.entries(SHELF)) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'tok'; b.dataset.load = k; b.title = v.title; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span class="disc"><svg viewBox="0 0 48 48" aria-hidden="true">${v.icon}</svg></span>${v.name}`;
  b.onclick = () => setLoad(S.load === k ? null : k); shelf.appendChild(b);
}
$('#reflex').onclick = () => { S.reflex = !S.reflex; $('#reflex').setAttribute('aria-checked', String(S.reflex)); applyVariant(); };

function variant() {   // the original recording; with a load on the face, our voice under that load
  const c = S.clip; if (!c) return null;
  if (S.load && c.loads && c.loads[S.load]) { const v = c.loads[S.load][S.reflex ? 'on' : 'off']; return { url: v.audio, ema: v.ema, key: `${S.load}_${S.reflex ? 'on' : 'off'}`, v }; }
  return { url: c.audio.orig, ema: c.ema, key: 'orig' };
}
let variantRevision=0;
async function applyVariant() {
  const revision=++variantRevision;
  const v = variant(); if (!v) return;
  player.prefetch(v.url);
  try { await player.swap(v.url); }
  catch { if(revision===variantRevision) $('#playcap').textContent='Audio could not load. Press play to retry.'; return; }
  if(revision!==variantRevision) return;
  S.ema = v.ema; S.cues = veraCues(S.clip, v.ema);
  renderScoreStatic(); updateCaptions();
}
function setLoad(k) {
  if (S.kind !== 'speech') return;
  S.load = k;
  if(k && S.clip.loads?.[k]) {
    player.prefetch(S.clip.loads[k].on.audio);
    player.prefetch(S.clip.loads[k].off.audio);
  }
  for (const b of shelf.children) b.setAttribute('aria-pressed', String(b.dataset.load === k));
  for (const p of ['weight', 'pen', 'band', 'gum', 'hand', 'table']) props[p].visible = p === k;
  if (k === 'gum' && view.mode === 'face') hint(true, 'Gum → X-ray');
  applyVariant();
}
function updateCaptions() {
  const c=S.clip;
  if (!c) return;
  const loaded=c.kind==='speech' && S.load && c.loads?.[S.load];
  $('#voicecap').textContent=loaded
    ? `Our synthesis · reflexes ${S.reflex?'on':'off'}`
    : c.kind==='song'?'Original singing':'Original recording';
  $('#reflex').disabled=!loaded;
  const heard=$('#heard');
  if(loaded) {
    const result=loaded[S.reflex?'on':'off'];
    heard.textContent='Recognizer heard ';
    const quote=document.createElement('q');quote.textContent=result.hyp || '…';heard.append(quote);
  } else {
    heard.textContent='Choose a load to hear our synthesized voice.';
  }
}
function renderClipList() {
  const select=$('#clips'), clips=manifest.clips.filter(c=>c.kind===S.kind);
  const index=clips.findIndex(c=>c.id===S.clip.id);
  select.replaceChildren(...clips.map((c,i)=>new Option(c.title,c.id,false,i===index)));
  const digits=n=>String(n).padStart(2,'0');
  $('#clip-no').textContent=`${S.kind==='speech'?'Sentence':'Song'} ${digits(index+1)} / ${digits(clips.length)}`;
}
$('#clips').onchange=e=>loadClip(e.target.value);
function setKind(k) {
  S.kind=k;
  $('#t-speech').setAttribute('aria-pressed',String(k==='speech'));
  $('#t-song').setAttribute('aria-pressed',String(k==='song'));
  $('#loadcard').hidden=k!=='speech';
  for(const b of shelf.children) b.disabled=k!=='speech';
  const first=manifest.clips.find(c=>c.kind===k);
  if(first) loadClip(first.id);
}
$('#t-speech').onclick = () => setKind('speech');
$('#t-song').onclick = () => setKind('song');

let loadSeq = 0;
async function loadClip(id) {
  const seq = ++loadSeq; const was = player.playing || player.starting; player.pause(); player.off = 0;
  ++variantRevision; setPlayIcon(false);
  $('#play').disabled=true; $('#scrub').disabled=true;
  let c;
  try { c=await getClip(id); }
  catch { if(seq===loadSeq) $('#playcap').textContent='Recording unavailable. Choose another clip.'; return; }
  if(seq!==loadSeq) return;
  S.clip = c; S.t = 0; if (c.kind !== 'speech') { S.load = null; for (const p of Object.keys(SHELF)) props[p].visible = false; for (const b of shelf.children) b.setAttribute('aria-pressed', 'false'); }
  renderClipList();
  const say = $('#say'); say.innerHTML = '';
  if (c.words && c.words.length) for (const [w, t0, t1] of c.words) { const s = document.createElement('span'); s.className = 'w'; s.textContent = w; s.dataset.t0 = t0; s.dataset.t1 = t1; say.append(s, ' '); }
  else say.textContent = c.text;
  $('#who').textContent = c.speaker || '';
  const scrub=$('#scrub');
  scrub.max=c.dur.toFixed(3); scrub.value='0';
  lastWord=-1;
  await applyVariant(); if(seq!==loadSeq) return;
  $('#play').disabled=false; $('#scrub').disabled=false; $('#playcap').textContent='';
  const packet=c.packet?.bytes ? ` · ${c.packet.bytes} B motor plan` : '';
  $('#scoremeta').textContent=`${c.gestures.length} gestures${packet} · ${c.dur.toFixed(2)} s`;
  if (was) play();
}

// play button
const ICON = { play: 'M7 4.5v15l13-7.5z', pause: 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z' };
function setPlayIcon(p) { $('#play-icon').setAttribute('d', p ? ICON.pause : ICON.play); $('#play').setAttribute('aria-label', p ? 'Pause' : 'Play'); }
async function play() {
  const v = variant(); if (!v) return;
  try { await player.play(v.url, player.off); }
  catch { player.onfail(); }
  hint(false);
}
player.onstart = () => { setPlayIcon(true); $('#playcap').textContent = ''; };
player.onfail = () => { setPlayIcon(player.playing); $('#playcap').textContent='Audio could not load. Press play to retry.'; };
player.onend = () => { setPlayIcon(false); S.anim = { yield: 0 }; };
const scrubber=$('#scrub');
scrubber.addEventListener('input',()=>player.seek(Number(scrubber.value)));
$('#play').onclick = () => { if (player.playing || player.starting) { player.pause(); setPlayIcon(false); } else play(); };
addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play').click(); } });

// ------------------------------------------------------------------------------------------------ per-frame posture
const z = new Float64Array(12);
function postureAt(t) {
  const c = S.clip, E = S.ema; if (!c || !E) return null;
  const f = clamp(t * c.fps, 0, c.T - 1), i = Math.floor(f), j = Math.min(i + 1, c.T - 1), a = f - i;
  for (let k = 0; k < 12; k++) z[k] = lerp(E[k][i], E[k][j], a);
  return f;
}
const J5_MAP = { closed: 2.05, open: 3.05, max: 9 * DEG };   // calibrated aperture map: LA (cm) -> hinge angle
const apertureAngle = (LAcm) => clamp((LAcm - J5_MAP.closed) / (J5_MAP.open - J5_MAP.closed), 0, 1.15) * J5_MAP.max;

// ------------------------------------------------------------------------------------------------ the mid-sagittal cut (2D)
const flat = $('#flatc'), fg = flat.getContext('2d');
function drawFlat(P) {
  const W = flat.width, H = flat.height, x0 = -10.3, x1 = 3.2, y0 = -7.3, y1 = 4.9, s = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
  fg.setTransform(1, 0, 0, 1, 0, 0); fg.fillStyle = C['a-air']; fg.fillRect(0, 0, W, H);
  fg.setTransform(s, 0, 0, -s, ox - x0 * s, oy + y1 * s);
  const poly = (pts, fc, ec, lw = 0.05) => { fg.beginPath(); fg.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) fg.lineTo(pts[i], pts[i + 1]); fg.closePath(); if (fc) { fg.fillStyle = fc; fg.fill(); } if (ec) { fg.strokeStyle = ec; fg.lineWidth = lw; fg.stroke(); } };
  const line = (pts, ec, lw = 0.05) => { fg.beginPath(); fg.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) fg.lineTo(pts[i], pts[i + 1]); fg.strokeStyle = ec; fg.lineWidth = lw; fg.stroke(); };
  poly(P.skin, C['a-skin']); poly(A.nasal, C['a-air']); poly(P.pharynx, C['a-air']); poly(P.oral, C['a-air']);
  for (const v of A.verts) poly(v, C['a-bone'], C['a-bone-edge'], 0.03);
  poly(A.bone, C['a-bone'], C['a-bone-edge']); poly(A.velum, C['a-soft'], C['a-soft-edge']); poly(P.sym, C['a-bone'], C['a-bone-edge']);
  poly(P.tongue.body, C['a-tongue'], C['a-tongue-edge']); poly(A.epi, C['a-soft'], C['a-soft-edge'], 0.04); poly(P.hy, C['a-bone'], C['a-bone-edge'], 0.04);
  poly(A.ui, C['a-tooth'], C['a-tooth-edge'], 0.04); poly(P.li, C['a-tooth'], C['a-tooth-edge'], 0.04);
  poly(P.ulip, C['a-lip']); poly(P.llip, C['a-lip']);
  line(P.profUp, C['a-skin-edge']); line(P.profLo, C['a-skin-edge']); line(A.pw, C['a-skin-edge']);
  if (S.load === 'gum') { fg.fillStyle = '#7fd3a6'; fg.beginPath(); fg.ellipse(P.S.TB[0], P.S.TB[1] + 0.32, 0.55, 0.28, 0, 0, Math.PI * 2); fg.fill(); }
  if (S.load === 'pen') { fg.fillStyle = '#f2a93b'; fg.strokeStyle = '#8a560c'; fg.lineWidth = 0.04; fg.beginPath(); fg.arc(-0.55, (P.el + P.eu) / 2 - 0.25, 0.42, 0, Math.PI * 2); fg.fill(); fg.stroke(); }
  const col = { TD: C['c-tb'], TB: C['c-tb'], TT: C['c-tt'], LI: C['c-jaw'], UL: C['c-lips'], LL: C['c-lips'] };
  for (const k of SENSORS) { const p = P.S[k]; fg.beginPath(); fg.arc(p[0], p[1], 0.17, 0, Math.PI * 2); fg.fillStyle = col[k]; fg.fill(); fg.lineWidth = 0.05; fg.strokeStyle = '#ffffff'; fg.stroke(); }
}

// ------------------------------------------------------------------------------------------------ the gestural score
const sc = $('#score'), sg = sc.getContext('2d'), tip = $('#tip');
let SL = null;   // layout + static layer
function scoreRows(c) {
  const rows = ORGAN.map((o) => ({ id: o, name: ORGAN_NAME[o], color: C[ORGAN_VAR[o].slice(2)] }));
  rows.push({ id: 'J5', name: 'VERA J5 jaw', color: C['c-jaw'], vera: true });
  rows.push({ id: 'J2', name: 'VERA J2 nod', color: C.accent });
  rows.push({ id: 'GAZE', name: 'VERA gaze', color: C.blue });
  if (c.kind === 'song') rows.push({ id: 'F0', name: 'Melody (f0)', color: C['c-pitch'] });
  return rows;
}
function seriesOf(E, c) {   // traces in mm from an EMA set
  const n = c.T, LA = new Float32Array(n), TTY = new Float32Array(n), TBY = new Float32Array(n), JAW = new Float32Array(n), J5 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    LA[i] = (E[9][i] - E[11][i]) * 10; TTY[i] = E[5][i] * 10; TBY[i] = E[3][i] * 10; JAW[i] = E[7][i] * 10; J5[i] = apertureAngle(E[9][i] - E[11][i]) / DEG;
  }
  return { LIPS: LA, TT: TTY, TBODY: TBY, JAW, J5 };
}
// ------------------------------------------------------------------------------------------------ VERA cue layer
// events e = (role, cue, target, onset, duration), as in the proposal; each is executed by a critically damped spring primitive,
// the same kind of primitive that moves our articulators. J5 comes from our body (lip aperture); J2 and gaze follow simple rules.
function spring(target, n, fps, hz) {   // z'' = k (g - z) - 2 sqrt(k) z', sampled at fps
  const out = new Float32Array(n), k = (2 * Math.PI * hz) ** 2, c = 2 * Math.sqrt(k), sub = 10, h = 1 / (fps * sub); let z = 0, v = 0;
  for (let i = 0; i < n; i++) { for (let s = 0; s < sub; s++) { v += h * (k * (target[i] - z) - c * v); z += h * v; } out[i] = z; }
  return out;
}
function veraCues(c, E) {
  const fps = c.fps, n = c.T, tail = Math.round(1.2 * fps), N = n + tail, dur = n / fps;
  const j5 = new Float32Array(n); for (let i = 0; i < n; i++) j5[i] = apertureAngle(E[9][i] - E[11][i]) / DEG;
  const j5Events = []; let s0 = -1, pk = 0;
  for (let i = 0; i <= n; i++) {
    const on = i < n && j5[i] > 1.2;
    if (on && s0 < 0) { s0 = i; pk = 0; } if (on) pk = Math.max(pk, j5[i]);
    if (!on && s0 >= 0) { if (i - s0 >= 3) j5Events.push({ role: 'articulate', cue: 'J5 jaw', t0: s0 / fps, t1: i / fps, target: pk }); s0 = -1; }
  }
  // nods: beats on the loudest syllables (>= 0.75 s apart), and a yield nod when the turn ends
  const L = c.loud || new Array(n).fill(-60), sm = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0, m = 0; for (let d = -3; d <= 3; d++) { const q = i + d; if (q >= 0 && q < n) { a += L[q]; m++; } } sm[i] = a / m; }
  const top = Math.max(...sm), peaks = [];
  for (let i = 2; i < n - 2; i++) if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > top - 9) peaks.push(i);
  peaks.sort((a, b) => sm[b] - sm[a]); const keep = [];
  for (const p of peaks) if (keep.every((q) => Math.abs(q - p) > 0.75 * fps)) keep.push(p);
  keep.sort((a, b) => a - b);
  const nodEvents = keep.map((p) => ({ role: 'beat', cue: 'J2 nod', t0: Math.max(p / fps - 0.08, 0), t1: p / fps + 0.27, target: 1.4 }));
  const lastWord = c.words && c.words.length ? c.words[c.words.length - 1][2] : dur - 0.2;
  nodEvents.push({ role: 'yield', cue: 'J2 nod', t0: Math.min(lastWord + 0.05, dur), t1: Math.min(lastWord + 0.05, dur) + 0.6, target: 3.2 });
  const g = new Float32Array(N);
  for (const e of nodEvents) for (let i = Math.round(e.t0 * fps); i < Math.min(Math.round(e.t1 * fps), N); i++) g[i] = Math.max(g[i], e.target);
  const j2 = spring(g, N, fps, 2.2);
  const gazeEvents = [{ role: 'attend', cue: 'J3/J4 gaze', t0: 0, t1: dur, target: 'partner' }];
  return { j5, j5Events, nodEvents, j2, gazeEvents, N, fps };
}
const eventType=$('#event-type');
let displayedEvent;
function showEvent(t) {
  const events=S.cues?.[eventType.value] || [];
  const event=events.find(e=>e.t1>t) || events[events.length-1];
  if(displayedEvent===event) return;
  displayedEvent=event;
  $('#evt-target').textContent=event ? (typeof event.target==='number'?event.target.toFixed(1)+'°':event.target) : '—';
  $('#evt-onset').textContent=event?event.t0.toFixed(2)+' s':'—';
  $('#evt-duration').textContent=event?(event.t1-event.t0).toFixed(2)+' s':'—';
}
const sampleAt = (arr, fps, t) => { const f = clamp(t * fps, 0, arr.length - 1), i = Math.floor(f), k = Math.min(i + 1, arr.length - 1); return lerp(arr[i], arr[k], f - i); };

function renderScoreStatic() {
  const c = S.clip; if (!c) return;
  const box = $('#scorebox'), dpr = Math.min(devicePixelRatio || 1, 2), W = Math.max(box.clientWidth, 560), H = 330;
  sc.width = Math.round(W * dpr); sc.height = Math.round(H * dpr); sc.style.width = W + 'px';
  const off = document.createElement('canvas'); off.width = sc.width; off.height = sc.height; const g = off.getContext('2d'); g.scale(dpr, dpr);
  const rows = scoreRows(c), gut = 112, top = 26, bot = 20, rh = (H - top - bot) / rows.length, dur = c.T / c.fps, xr = W - gut - 10, span = dur + 0.8;
  const X = (t) => gut + (t / span) * xr;   // 0.8 s past the end shows the yield nod
  g.font = '500 11px ' + css('--f-mono'); g.textBaseline = 'middle';
  // rows
  rows.forEach((r, k) => {
    const y = top + k * rh;
    g.fillStyle = k % 2 ? C.panel : C.surface; g.fillRect(gut, y, xr, rh);
    if (r.vera) { g.fillStyle = C.line; g.fillRect(0, y, W, 1); }
    g.fillStyle = r.color; g.fillRect(6, y + rh / 2 - 4, 8, 8);
    g.fillStyle = C['ink-2']; g.fillText(r.name, 20, y + rh / 2);
  });
  // gestures
  const rowIx = Object.fromEntries(rows.map((r, k) => [r.id, k]));
  const boxes = [];
  for (const [ph, org, on, offF, deg] of c.gestures) {
    const k = rowIx[org]; if (k == null) continue;
    const t0 = Math.max(on, 0) / c.fps, t1 = Math.max(offF, on + 1) / c.fps, x0 = X(t0), x1 = Math.max(X(t1), x0 + 2), y = top + k * rh + 3, h = rh - 6;
    g.globalAlpha = 0.16 + 0.6 * clamp(deg, 0, 1); g.fillStyle = rows[k].color; roundRect(g, x0, y, x1 - x0, h, 3); g.fill();
    g.globalAlpha = 0.9; g.strokeStyle = rows[k].color; g.lineWidth = 1; roundRect(g, x0 + 0.5, y + 0.5, x1 - x0 - 1, h - 1, 3); g.stroke(); g.globalAlpha = 1;
    if (x1 - x0 > 18) { g.fillStyle = deg > 0.55 ? '#ffffff' : C.ink; g.font = '500 10px ' + css('--f-mono'); g.fillText(ph, x0 + 3, y + h / 2); }
    boxes.push({ x0, x1, y, h, ph, org, t0, t1, deg });
  }
  // traces: the body's motion (current variant) over its own row; the unloaded plan faintly under a load
  const cur = seriesOf(S.ema, c), base = S.load ? seriesOf(c.ema, c) : null;
  const trace = (arr, k, color, dash, lw, lo, hi) => {
    const y0 = top + k * rh + 4, hh = rh - 8; g.beginPath();
    for (let i = 0; i < c.T; i++) { const x = X(i / c.fps), y = y0 + hh - ((arr[i] - lo) / (hi - lo || 1)) * hh; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = lw; g.stroke(); g.setLineDash([]);
  };
  for (const id of ['LIPS', 'TT', 'TBODY', 'JAW', 'J5']) {
    const k = rowIx[id]; let lo = Infinity, hi = -Infinity;
    for (const a of [cur[id], base && base[id]]) if (a) for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    if (base) trace(base[id], k, C['ink-3'], [3, 3], 1.1, lo, hi);
    trace(cur[id], k, id === 'J5' ? C['c-jaw'] : C.ink, null, id === 'J5' ? 1.8 : 1.4, lo, hi);
  }
  { // VERA rows: events in the proposal's format, executed by spring primitives
    const cu = S.cues || veraCues(c, S.ema), ev = (k, e, color, label) => {
      const x0 = X(e.t0), x1 = Math.max(X(Math.min(e.t1, span)), x0 + 3), y = top + k * rh + 3, h = rh - 6;
      g.globalAlpha = 0.18; g.fillStyle = color; roundRect(g, x0, y, x1 - x0, h, 3); g.fill();
      g.globalAlpha = 0.7; g.strokeStyle = color; g.lineWidth = 1; roundRect(g, x0 + 0.5, y + 0.5, x1 - x0 - 1, h - 1, 3); g.stroke(); g.globalAlpha = 1;
      if (label && x1 - x0 > 30) { g.fillStyle = C['ink-2']; g.font = '500 10px ' + css('--f-mono'); g.fillText(label, x0 + 4, y + h / 2); }
      boxes.push({ x0, x1, y, h, vera: e });
    };
    const k5 = rowIx.J5; for (const e of cu.j5Events) ev(k5, e, C['c-jaw'], null);
    const k2 = rowIx.J2; for (const e of cu.nodEvents) ev(k2, e, C.accent, e.role);
    const y0 = top + k2 * rh + 4, hh = rh - 8;
    g.beginPath(); for (let i = 0; i < Math.min(cu.N, c.T + Math.round(0.8 * c.fps)); i++) { const x = X(i / c.fps), y = y0 + hh - (cu.j2[i] / 3.6) * hh; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = C.accent; g.lineWidth = 1.6; g.stroke();
    const kg = rowIx.GAZE; for (const e of cu.gazeEvents) ev(kg, e, C.blue, 'attend · partner');
    { let lo = 0, hi = 0; for (const v of cu.j5) hi = Math.max(hi, v); hi = hi * 1.08 || 1; trace(cu.j5, k5, C['c-jaw'], null, 1.8, lo, hi); }
  }
  if (rowIx.F0 != null && c.f0) {
    const k = rowIx.F0, y0 = top + k * rh + 4, hh = rh - 8, f = c.f0.filter((v) => v > 0), lo = Math.log(Math.min(...f) * 0.9), hi = Math.log(Math.max(...f) * 1.1);
    g.strokeStyle = C['c-pitch']; g.lineWidth = 1.6; g.beginPath(); let pen = false;
    c.f0.forEach((v, i) => { if (v <= 0) { pen = false; return; } const x = X(i / c.fps), y = y0 + hh - ((Math.log(v) - lo) / (hi - lo)) * hh; pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; });
    g.stroke();
  }
  // words
  const words = [];
  if (c.words) c.words.forEach(([w, t0, t1], i) => {
    const x0 = X(t0), x1 = X(t1); g.fillStyle = i % 2 ? C.surface : C['line-2']; g.fillRect(x0, 3, Math.max(x1 - x0 - 1, 1), top - 7);
    g.fillStyle = C['ink-2']; g.font = '500 11px ' + css('--f-body'); g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, top); g.clip(); g.fillText(w, x0 + 3, (top - 4) / 2 + 1); g.restore();
    words.push({ x0, x1, t0, t1, w });
  });
  // time axis
  g.fillStyle = C['ink-3']; g.font = '500 10px ' + css('--f-mono'); g.textBaseline = 'alphabetic';
  const step = dur > 8 ? 1 : 0.5;
  for (let t = 0; t <= dur + 1e-6; t += step) { const x = X(t); g.fillRect(x, H - bot, 1, 4); g.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, x + 2, H - 5); }
  g.globalAlpha = 0.5; g.fillStyle = C['line-2']; g.fillRect(X(dur), top, X(span) - X(dur), H - top - bot); g.globalAlpha = 1;
  SL = { off, W, H, X, gut, xr, top, rh, dur, span, boxes, words, rows, dpr };
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawScore(t) {
  if (!SL) return;
  sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, sc.width, sc.height); sg.drawImage(SL.off, 0, 0);
  sg.setTransform(SL.dpr, 0, 0, SL.dpr, 0, 0);
  const x = SL.X(clamp(t, 0, SL.dur));
  sg.fillStyle = C.accent; sg.fillRect(x - 1, 0, 2, SL.H - 18);
  sg.beginPath(); sg.moveTo(x - 5, 0); sg.lineTo(x + 5, 0); sg.lineTo(x, 6); sg.closePath(); sg.fill();
}
function scoreT(ev) { const r = sc.getBoundingClientRect(); const x = (ev.clientX - r.left); return { x, y: ev.clientY - r.top, t: clamp((x - SL.gut) / SL.xr * SL.span, 0, SL.dur) }; }
let scrubbing = false;
sc.addEventListener('pointerdown', (e) => { if (!SL) return; scrubbing = true; sc.setPointerCapture(e.pointerId); const { t } = scoreT(e); player.seek(t); S.t = t; });
sc.addEventListener('pointermove', (e) => {
  if (!SL) return; const { x, y, t } = scoreT(e);
  if (scrubbing) { player.seek(t); S.t = t; }
  const b = SL.boxes.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y && y <= q.y + q.h);
  if (b) { tip.hidden = false; tip.textContent = b.vera ? `event · role ${b.vera.role} · cue ${b.vera.cue} · target ${typeof b.vera.target === 'number' ? b.vera.target.toFixed(1) + '°' : b.vera.target} · onset ${b.vera.t0.toFixed(2)} s · duration ${(b.vera.t1 - b.vera.t0).toFixed(2)} s` : `${ORGAN_NAME[b.org]} · ${b.ph} · degree ${b.deg.toFixed(2)} · ${b.t0.toFixed(2)}–${b.t1.toFixed(2)} s`;
    const bx = $('#scorebox').getBoundingClientRect(); tip.style.left = Math.min(x + 12, bx.width - 260) + 'px'; tip.style.top = (y + 14) + 'px'; }
  else tip.hidden = true;
});
sc.addEventListener('pointerup', () => { scrubbing = false; });
sc.addEventListener('pointerleave', () => { tip.hidden = true; });

// ------------------------------------------------------------------------------------------------ gaze, neck, blink: the VERA cue layer on top of speech
const gaze = { yaw: 0, pitch: 0, eyeYaw: 0, eyePitch: 0, neckYaw: 0, neckPitch: 0, lastPointer: -10, target: new THREE.Vector3(), blink: 0, nextBlink: 2.5, j5: 0, nod: 0, nodV: 0 };
const pointer = new THREE.Vector2(), ray = new THREE.Raycaster();
canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); gaze.lastPointer = clock.elapsedTime; });
const eyeMid = new THREE.Vector3(0, EYE.y, EYE.z);
function updateGaze(dt, time) {
  // where to look: the pointer when it moved recently, else the viewer (the camera)
  const attend=player.playing && S.cues?.gazeEvents.some(e => S.t >= e.t0 && S.t < e.t1);
  if (attend) gaze.target.set(12,7,120);
  else if (time - gaze.lastPointer < 2.5 && view.mode === 'face') { ray.setFromCamera(pointer, camera); gaze.target.copy(ray.ray.origin).addScaledVector(ray.ray.direction, camera.position.distanceTo(eyeMid) * 0.8); }
  else if (view.mode === 'face') gaze.target.set(12,14,110);
  else gaze.target.set(0, 4.5, 140);                                       // a partner straight ahead, so the profile stays readable
  const v = gaze.target.clone().sub(eyeMid);
  const yawT = clamp(Math.atan2(v.x, v.z), -1.0, 1.0), pitchT = clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)), -0.5, 0.5);
  // allocator: the neck takes part of the turn slowly, the eyes take the rest at once (within their range)
  const kN = 1 - Math.exp(-dt / 0.65), kE = 1 - Math.exp(-dt / 0.06);
  gaze.neckYaw += (0.55 * yawT - gaze.neckYaw) * kN; gaze.neckPitch += (0.35 * pitchT - gaze.neckPitch) * kN;
  gaze.eyeYaw += (clamp(yawT - gaze.neckYaw, -0.42, 0.42) - gaze.eyeYaw) * kE; gaze.eyePitch += (clamp(pitchT - gaze.neckPitch, -0.3, 0.3) - gaze.eyePitch) * kE;

}

// ------------------------------------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let visible = true, ready = false;
new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.01 }).observe(stage);
const ro = new ResizeObserver(() => { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(r.height, 1); camera.updateProjectionMatrix(); renderScoreStatic(); });
ro.observe(stage); new ResizeObserver(() => renderScoreStatic()).observe($('#scorebox'));
const tmpV = new THREE.Vector3();
function setTranslucent(material,on) {
  if(material.transparent===on && material.depthWrite===!on) return;
  material.transparent=on;material.depthWrite=!on;material.needsUpdate=true;
}
let lastWord = -1;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1), time = clock.elapsedTime;
  if (!ready) return;
  const t = player.time(); S.t = t;
  showEvent(t);
  if(!visible) {
    if(S.clip) { $('#time').textContent=`${t.toFixed(1)} / ${S.clip.dur.toFixed(1)} s`; scrubber.value=t; }
    drawScore(t);return;
  }
  // views
  const k = 1 - Math.exp(-dt / 0.18);
  view.x += (view.xT - view.x) * k; view.tract += (view.tractT - view.tract) * k; view.mech += (view.mechT - view.mech) * k; view.explode += (view.explodeT - view.explode) * k;
  XR.uXray.value = view.x;
  for(const m of shells.mats) setTranslucent(m,view.x>.015);
  for(const m of MECH) { m.opacity=view.mech; setTranslucent(m,view.mech<.985); }
  // Clear the line of sight from the side to the mid-sagittal articulators.
  // The shell supplies the outline and J5 still moves with the articulatory cue.
  const showHardware=view.mode!=='xray' || view.tract<.82;
  mechG.visible=P4.visible=P6.visible=showHardware;
  tractG.visible = view.tract > 0.02; mouthLower.visible = mouthBox.visible = view.x < 0.5;
  for (const m of [M.tongue, M.lip, M.bone, M.tooth, M.soft]) m.emissiveIntensity = 0.35 + 0.35 * view.tract;
  for (const d of sensorDots) d.material.opacity = view.tract;
  const ex = view.explode;
  contactStrength.value=.83*(1-.75*ex)*(1-view.x);
  shells.P1.position.set(0, 0, 7.5 * ex); shells.P2.position.set(0, 0, -8 * ex); jawPivot.position.set(TMJ.x, TMJ.y - 5 * ex, TMJ.z + 4.5 * ex);
  P6.position.set(0, -2.6 * ex, 0); P7.position.set(0, -6.5 * ex, 0); yawG.position.set(YAW.x, YAW.y - 6.5 * ex, YAW.z);
  shells.P3.position.set(0,-.80*ex,2.0*ex);
  pitchG.position.set(0,PITCH.y-YAW.y+6.5*ex,PITCH.z-YAW.z);
  // posture
  let f = postureAt(t);
  if (f != null) {
    const P = A.pose(z);
    T.tongue.set(P.tongue.body); T.ulip.set(P.ulip); T.llip.set(P.llip); T.sym.set(P.sym);
    teethL.forEach((p, i) => { p.set(P.li); p.mesh.position.z = -0.3 * TEETH_X[i] ** 2; });
    SENSORS.forEach((s, i) => sensorDots[i].position.set(0.06, P.S[s][1], P.S[s][0]));
    if (props.gum.visible) props.gum.position.set(0, P.S.TB[1] + 0.25, P.S.TB[0]);
    if (!flatBox.hidden) drawFlat(P);
    // J5: the aperture cue -> hinge angle (smoothed a little, as a servo would)
    const j5T = (!player.playing && t < 0.005) ? 0 : apertureAngle(P.LA);
    gaze.j5 += (j5T - gaze.j5) * (1 - Math.exp(-dt / 0.035));
    if (props.pen.visible) props.pen.position.set(0, (P.eu + P.el) / 2 - 0.15, 0.35);
    // words
    const ws = $('#say').children;
    let cw = -1; for (let i = 0; i < ws.length; i++) { const s = ws[i]; if (t >= +s.dataset.t0 && t < +s.dataset.t1) cw = i; }
    if (cw !== lastWord) { for (let i = 0; i < ws.length; i++) { ws[i].classList.toggle('now', i === cw); ws[i].classList.toggle('done', player.playing && i < cw); } lastWord = cw; }
  }
  if (window.__forceJ5 != null) gaze.j5 = window.__forceJ5 * DEG;   // local inspection hook
  jawPivot.rotation.x = gaze.j5; solveCrank(gaze.j5);
  // gaze allocator, nod at the end of a turn (yield), small beat nods with loudness
  updateGaze(dt, time);
  if (S.anim && S.anim.yield != null) { S.anim.yield += dt; if (S.anim.yield > 1.2) S.anim = null; }
  let nodT = 0;
  if (S.cues && S.clip) {
    if (player.playing) nodT = sampleAt(S.cues.j2, S.clip.fps, t) * DEG;
    else if (S.anim && S.anim.yield != null) nodT = sampleAt(S.cues.j2, S.clip.fps, S.clip.T / S.clip.fps + S.anim.yield) * DEG;
  }
  gaze.nod += (nodT - gaze.nod) * (1 - Math.exp(-dt / 0.03));
  yawG.rotation.y = reduceMotion ? 0 : gaze.neckYaw;
  pitchG.rotation.x = gaze.nod + (reduceMotion ? 0 : -gaze.neckPitch + Math.sin(time * 0.9) * 0.15 * DEG);
  for (const e of eyes) e.ball.rotation.set(-gaze.eyePitch,gaze.eyeYaw,0,'YXZ');
  // eye linkage: tie rod between the two arms' tips, links to the servos
  const tips = eyes.map((e) => e.ball.localToWorld(tmpV.set(0, 0, -2.75)).clone()).map((p) => mechG.worldToLocal(p));
  setBar(tieRod, tips[0], tips[1], 0.11);
  const mid = tips[0].clone().add(tips[1]).multiplyScalar(0.5);
  setBar(eyeLinkY, new THREE.Vector3(0, EYE_SERVO_Y[0], EYE_SERVO_Z + 1.2), mid, 0.08); setBar(eyeLinkP, new THREE.Vector3(0.0, EYE_SERVO_Y[1], EYE_SERVO_Z + 1.2), mid, 0.08);
  // readouts
  $('#j1').textContent = `${(yawG.rotation.y / DEG).toFixed(1)}°`;
  $('#j2').textContent = `${(pitchG.rotation.x / DEG).toFixed(1)}°`;
  $('#j34').textContent = `${(gaze.eyeYaw / DEG).toFixed(0)}° ${(gaze.eyePitch / DEG).toFixed(0)}°`;
  $('#j5').textContent = `${(gaze.j5 / DEG).toFixed(1)}°`;
  if(S.clip) {
    $('#time').textContent=`${t.toFixed(1)} / ${S.clip.dur.toFixed(1)} s`;
    scrubber.value=t;
  }
  drawScore(t);
  if (fly.t < 1 && fly.to) { fly.t = Math.min(fly.t + dt / 0.9, 1); const e = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - Math.pow(-2 * fly.t + 2, 2) / 2;
    camera.position.lerpVectors(fly.from.pos, fly.to.pos, e); controls.target.lerpVectors(fly.from.tgt, fly.to.tgt, e); }
  controls.update();
  // tags
  const showTags = view.mode === 'mech', rect = stage.getBoundingClientRect();
  for (const tg of TAGS) {
    if (!showTags || (tg.id[0] === 'P' && view.explode < 0.25 && tg.id !== 'P5' && tg.id !== 'P6' && tg.id !== 'P7')) { tg.el.hidden = true; continue; }
    const p = tg.obj.localToWorld(tmpV.set(...tg.at)).project(camera);
    if (p.z > 1) { tg.el.hidden = true; continue; }
    tg.el.hidden = false; tg.el.style.left = ((p.x + 1) / 2 * rect.width) + 'px'; tg.el.style.top = ((1 - p.y) / 2 * rect.height) + 'px';
  }
  renderer.render(scene, camera);
}

// theme changes
const reTheme = () => { readTheme(); XR.uRim.value.set(C.rim); renderScoreStatic(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme);
new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// go
const contactStrength={value:.83};
try { await applyAssemblyLight(root,contactStrength); }
catch { /* Direct and environment lighting remain available if the bake cannot load. */ }
$('#loading').remove();
ready = true;
setKind('speech');
hint(false);
requestAnimationFrame(frame);
window.__ready = true;
window.__dbg = {view,S,player,gaze,camera,controls,fly,shells,jawPivot,jawG,headG,crank,coupler,lever,eyes,P4,P5,P6,P7,renderer,scene};
