// Hardware for the VERA concept head. Side plates are extrusions in the sagittal
// plane. Turned parts have real shoulders and counterbores; all units are cm.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const up = new THREE.Vector3(0, 1, 0);
const alongX = (s) => [s, 0, 0];
const v3 = (p) => new THREE.Vector3(...p);
function group(parent, name) {
  const g = new THREE.Group(); g.name = name; parent.add(g); return g;
}
function put(parent, geom, mat, pos = [0, 0, 0], name = '') {
  const m = new THREE.Mesh(geom, mat);
  m.name = name; m.position.fromArray(pos); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function turned(parent, mat, center, axis, profile, name = '', segments = 80) {
  const g = new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), segments);
  const m = put(parent, g, mat, center, name); m.quaternion.setFromUnitVectors(up, v3(axis).normalize()); return m;
}
function box(parent, mat, dims, center, radius = .12) {
  return put(parent, new RoundedBoxGeometry(...dims, 2, radius), mat, center);
}
function rod(parent, mat, a, b, radius, name = '') {
  const start = v3(a), end = v3(b), delta = end.clone().sub(start);
  const m = put(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 20), mat, start.add(end).multiplyScalar(.5).toArray(), name);
  m.quaternion.setFromUnitVectors(up, delta.normalize()); return m;
}
function wire(parent, mat, path, r) {
  return put(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path.map(v3)), 56, r, 10, false), mat, [0,0,0], 'harness');
}
function roundedOutline(points, trim) {
  const s = new THREE.Shape(), n = points.length;
  const corners = points.map((p, i) => {
    const a = new THREE.Vector2(...points[(i+n-1)%n]), b = new THREE.Vector2(...p), c = new THREE.Vector2(...points[(i+1)%n]);
    const rad = Math.min(trim, a.distanceTo(b)*.33, c.distanceTo(b)*.33);
    return [a.sub(b).normalize().multiplyScalar(rad).add(b), b, c.sub(b).normalize().multiplyScalar(rad).add(b)];
  });
  s.moveTo(corners[0][0].x, corners[0][0].y);
  for (const [a, b, c] of corners) { s.lineTo(a.x,a.y); s.quadraticCurveTo(b.x,b.y,c.x,c.y); }
  s.closePath(); return s;
}
function flank(parent, mat, x, zy, holes, depth, fillet = .24, name = '') {
  const shape = roundedOutline(zy.map(([z,y])=>[-z,y]),fillet);
  for(const [z,y,r] of holes) { const h=new THREE.Path(); h.absarc(-z,y,r,0,Math.PI*2,true); shape.holes.push(h); }
  const geom=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.055,bevelSize:.055,bevelSegments:3,curveSegments:18});
  geom.translate(0,0,-depth/2);geom.rotateY(Math.PI/2);
  return put(parent,geom,mat,[x,0,0],name);
}
const screwCache = new Map();
export function fastener(parent, materials, p, normal, radius) {
  const key=radius.toFixed(3);
  if (!screwCache.has(key)) {
    const r=radius, profile=[[.39*r,.017],[.50*r,.038],[.64*r,.048],[.86*r,.043],[r,.014],[1.03*r,-.018],[.85*r,-.058]];
    const ringGeom=new THREE.LatheGeometry(profile.slice().reverse().map(([x,y])=>new THREE.Vector2(x,y)),28);
    const socketGeom=new THREE.CylinderGeometry(r*.475,r*.475,.018,6);
    const seatGeom=new THREE.CylinderGeometry(r*1.13,r*1.13,.032,30);
    screwCache.set(key,[ringGeom,socketGeom,seatGeom]);
  }
  const [ring,socket,seat]=screwCache.get(key);
  const g=group(parent,'socket-head');g.position.fromArray(p);g.quaternion.setFromUnitVectors(up,v3(normal).normalize());
  put(g,seat,materials.seal,[0,-.007,0]);put(g,ring,materials.steel,[0,.012,0]);
  put(g,socket,materials.socket,[0,.012,0]); return g;
}
function gear(parent, m, x, y, z, teeth, r, sign) {
  const ring=new THREE.Shape();
  for(let i=0;i<teeth;i++) {
    for(const [k,h] of [[0,.93],[.17,.93],[.32,1],[.64,1],[.81,.93]]) {
      const a=(i+k)*Math.PI*2/teeth, u=Math.cos(a)*h*r, v=Math.sin(a)*h*r;
      if(!i&&!k)ring.moveTo(u,v);else ring.lineTo(u,v);
    }
  }
  ring.closePath(); const hole=new THREE.Path();hole.absarc(0,0,r*.60,0,Math.PI*2,true);ring.holes.push(hole);
  const g=new THREE.ExtrudeGeometry(ring,{depth:.29,bevelEnabled:true,bevelSize:.022,bevelThickness:.021,bevelSegments:1,curveSegments:24});
  g.translate(0,0,-.145);g.rotateY(sign*Math.PI/2);return put(parent,g,m,[x,y,z],'drive-gear');
}
function material(color, metalness, roughness) {
  return new THREE.MeshStandardMaterial({color,metalness,roughness});
}

export function buildHardware({base, yoke, yawStage, carrier, jaw, pitch, yaw, tmj, groundY, shellGroups, screws}) {
  const m={
    steel:material('#bcbab4',.77,.32), polish:material('#c5c3bd',.88,.24),
    alloy:material('#aaa9a3',.70,.38), chassis:material('#686965',.55,.45),
    seal:material('#2c3030',.16,.55), socket:material('#232627',.42,.52),
    shoulder:material('#b6b2aa',.56,.40), blue:material('#285575',.20,.42),
    loom:material('#323534',.12,.61), liner:material('#24201e',.12,.76),
    occlusal:material('#cdc7bb',.16,.48)
  };
  // Hardware continues to be visible in the mechanism view, and fades in X-ray.
  const skinM={steel:m.steel.clone(), seal:m.seal.clone(), socket:m.socket.clone(), cover:material('#dfdcd3',.06,.45)};
  for (const bolt of screws) fastener(shellGroups[bolt.part],skinM,bolt.p,bolt.n,bolt.r);

  const y0=groundY, z0=yaw.z;
  turned(base,m.seal,[0,y0,z0],[0,1,0],[[.1,.025],[6.49,.025],[6.67,.08],[6.74,.18],[6.67,.25],[.1,.25]],'isolation-foot');
  turned(base,m.steel,[0,y0,z0],[0,1,0],[[4.45,.17],[6.63,.17],[6.86,.25],[6.94,.39],[6.94,1.66],[6.90,1.75],[6.72,1.86],[4.69,1.86],[4.59,1.76],[4.45,.17]],'P7-base-cover',112);
  turned(base,m.chassis,[0,y0,z0],[0,1,0],[[3.30,1.68],[4.69,1.68],[4.69,1.80],[4.62,1.83],[3.30,1.83]],'turntable-seat');
  turned(yawStage,m.polish,[0,0,0],[0,1,0],[[2.55,-.41],[4.33,-.41],[4.48,-.34],[4.48,-.04],[4.41,.05],[2.60,.05]],'J1-yaw-bearing');
  turned(yawStage,m.chassis,[0,0,0],[0,1,0],[[.05,-.3],[3.65,-.3],[3.75,.02],[3.64,.24],[.05,.24]],'rotor');
  for(let i=0;i<6;i++) {
    const a=(i+.25)*Math.PI/3;
    fastener(base,m,[5.75*Math.cos(a),y0+1.866,z0+5.75*Math.sin(a)],[0,1,0],.19);
  }
  // Model the yoke in head coordinates and mount it on the rotating base.
  const fork=group(yoke,'P6-pitch-yoke');fork.position.copy(yaw).multiplyScalar(-1);
  const stem=group(fork,'neck motor');
  box(stem,m.chassis,[3.9,4.1,4.0],[0,-6.65,z0],.37);
  for(const cy of [-8.35,-5.13]) {
    turned(stem,m.polish,[0,cy,z0],[0,1,0],[[1.5,-.12],[2.25,-.12],[2.36,-.05],[2.36,.12],[2.28,.20],[1.5,.20]],'collar');
  }
  turned(stem,m.steel,[0,-6.60,z0],[0,1,0],[[1.68,-1.51],[2.38,-1.51],[2.47,-1.38],[2.42,1.34],[2.32,1.46],[1.66,1.46]],'neck spindle housing');
  for(const [cy,r,h] of [[-7.80,2.50,.83],[-6.71,2.38,.32],[-5.56,2.39,.44],[-4.97,2.58,.32]]) {
    turned(stem,m.alloy,[0,cy,z0],[0,1,0],[[1.85,-h*.5],[r-.10,-h*.5],[r,-h*.36],[r,h*.36],[r-.09,h*.5],[1.85,h*.5]],'neck sleeve');
  }
  for(const sign of [-1,1]) {
    const X=(x)=>sign*x, normal=alongX(sign);
    const ear=[X(6.62),pitch.y,pitch.z];
    // The fixed two-sided fork cradles the J2 shaft, with an opened web below it.
    const yz=[[-12.19,3.38],[-11.59,4.78],[-9.89,4.90],[-8.97,3.96],[-9.32,1.20],
      [-8.35,-2.72],[-8.25,-3.65],[-9.10,-4.16],[-10.14,-3.72],[-11.30,-.38]];
    flank(fork,m.chassis,X(5.79),yz,[[pitch.z,pitch.y,.75],[-9.7,-2.85,.38]],.41,.37,'pitch fork');
    const bottom=[[-12.92,-8.65],[-12.68,-7.29],[-11.20,-5.79],[-10.78,-3.49],[-9.84,-2.71],[-8.66,-3.34],
      [-8.34,-4.21],[-8.99,-6.22],[-7.34,-7.62],[-7.20,-8.65]];
    flank(fork,m.shoulder,X(3.60),bottom,[[-9.90,-4.05,.43],[-10.0,-7.42,.71]],.71,.32,'yoke foot');
    for(const [z,y] of [[-9.90,-4.05],[-10.0,-7.42],[-12.04,-8.01]])
      fastener(fork,m,[X(4.04),y,z],normal,.22);
    rod(fork,m.polish,[X(3.60),-4.05,-9.90],[X(5.82),-2.85,-9.70],.36);
    rod(fork,m.chassis,[X(2.6),-8.23,-8.14],[X(2.98),-4.44,-8.30],.38);
    rod(fork,m.alloy,[X(3.35),-8.42,-8.04],[X(3.10),-6.55,-6.95],.39);
    rod(fork,m.polish,[X(3.10),-6.55,-6.95],[X(3.04),-4.82,-6.01],.225);
    // Two rear shrouds wrap around the back of the bearing while the upper
    // web stays open. Both shrouds are carried by the removable P2 cover.
    const upperCover=[[-14.36,5.22],[-14.51,6.49],[-13.75,7.97],[-12.84,8.78],
      [-12.18,8.72],[-11.96,8.23],[-12.50,7.30],[-12.95,5.38],[-13.15,5.02]];
    flank(shellGroups.P2,skinM.cover,X(6.01),upperCover,[],.34,.22,'posterior temple shield');
    fastener(shellGroups.P2,skinM,[X(6.24),7.76,-13.17],normal,.16);
    const guard=[[-14.34,4.91],[-13.16,4.92],[-12.31,4.70],[-11.86,4.31],[-12.14,3.57],
      [-12.08,2.68],[-11.46,1.91],[-10.94,1.54],[-11.23,1.08],[-12.35,.88],
      [-13.55,1.34],[-14.15,2.30]];
    flank(shellGroups.P2,skinM.cover,X(6.30),guard,[],.39,.22,'rear bearing guard');
    for(const [z,y] of [[-13.69,4.47],[-13.05,1.72]]) fastener(shellGroups.P2,skinM,[X(6.55),y,z],normal,.145);
    // The rear shoulder of the bearing is toothed; the front has a machined
    // housing, a recessed black seal and a stepped hub on the same pitch axis.
    gear(carrier,m.chassis,X(6.41),pitch.y,pitch.z,38,1.99,sign);
    turned(fork,m.seal,ear,normal,[[.15,-.45],[1.70,-.45],[1.86,-.29],[1.86,.04],[1.72,.16],[.15,.16]],'bearing seal');
    turned(fork,m.steel,ear,normal,[[1.00,.02],[1.69,.02],[1.82,.12],[1.82,.47],[1.74,.57],[1.15,.57],[1.04,.49],[1.00,.02]],'J2 bearing race');
    turned(carrier,m.alloy,ear,normal,[[.38,.08],[.89,.08],[1.05,.27],[1.05,.44],[.93,.51],[.46,.51],[.38,.39],[.38,.08]],'pitch hub');
    turned(carrier,m.seal,ear,normal,[[.87,.42],[1.025,.42],[1.04,.48],[1.00,.505],[.91,.505],[.87,.48]],'hub seal');
    fastener(carrier,m,[X(7.08),pitch.y,pitch.z],normal,.38);
    for(let a=0;a<3;a++) { const k=(a+.28)*Math.PI*2/3;
      fastener(fork,m,[X(7.182),pitch.y+1.45*Math.cos(k),pitch.z+1.45*Math.sin(k)],normal,.089);
    }
    // Carrier cheek webs end inside the shell, leaving the actual negative spaces.
    // A recessed inner wall keeps daylight out of the eye and mouth openings.
    // The outer web stands on tubular spacers; components remain individually visible.
    const bulk=[[-13.52,7.65],[-12.76,8.31],[-7.35,8.23],[-4.97,7.24],[-3.42,6.11],
      [-4.34,5.28],[-5.12,4.12],[-4.96,1.70],[-2.97,-.62],[-2.91,-2.18],[-5.46,-2.98],
      [-9.67,-2.65],[-12.68,-1.20],[-13.73,2.15]];
    flank(carrier,m.chassis,X(3.65),bulk,[[-11.46,6.59,.68],[-8.46,6.37,.75],[-7.62,2.21,1.32],[-6.14,4.84,.64],[-5.83,-.48,1.0]],.34,.35,'inner carrier cheek');
    const link=[[-10.72,6.98],[-10.31,7.58],[-9.76,7.66],[-7.21,6.52],[-6.30,5.92],
      [-6.32,5.22],[-6.91,4.90],[-7.48,5.15],[-8.42,5.91],[-10.49,6.50]];
    flank(carrier,m.steel,X(6.02),link,[[-9.96,7.08,.16],[-6.93,5.56,.18]],.33,.19,'temple bridge');
    for(const [z,y] of [[-9.96,7.07],[-6.94,5.56]])fastener(carrier,m,[X(6.25),y,z],normal,.175);
    wire(carrier,m.blue,[[X(4.40),7.64,-5.16],[X(5.42),7.04,-6.04],[X(5.62),6.64,-7.65],[X(5.61),7.21,-9.06],[X(5.12),7.31,-10.49]],.085);
    const web=[[-13.11,2.84],[-13.39,5.48],[-12.55,7.85],[-10.71,8.28],[-9.18,7.60],[-8.08,7.25],
      [-7.56,5.81],[-7.77,4.83],[-8.73,4.50],[-9.26,3.09],[-10.56,2.62]];
    flank(carrier,m.alloy,X(5.93),web,[[-11.65,6.28,.70],[-9.45,6.16,.55]],.50,.27,'carrier side web');
    box(carrier,m.chassis,[1.42,2.24,2.77],[X(5.27),5.80,-11.83],.2);
    for(const [z,y,r] of [[-12.69,7.47,.57],[-9.66,7.88,.53],[-8.29,5.36,.36]]) {
      const center=[X(6.03),y,z];
      turned(carrier,m.polish,center,normal,[[.1,0],[r*.84,0],[r,.08],[r,.25],[r*.84,.31],[.12,.31]],'spacer');
      fastener(carrier,m,[X(6.36),y,z],normal,r*.35);
    }
    flank(carrier,m.alloy,X(5.58),[[-12.35,1.96],[-10.9,1.72],[-8.58,.12],[-7.51,-1.19],
          [-8.11,-2.35],[-9.71,-2.65],[-12.64,-.65]], [[-10.58,-.52,.54]],.48,.30,'lower gusset');
    for(const [z,y] of [[-11.7,.77],[-8.44,-1.42]]) fastener(carrier,m,[X(5.88),y,z],normal,.22);
    // The upper temple has two spaced lugs and a folded vertical servo mount.
    const upper=[[-13.08,8.53],[-12.61,9.06],[-11.80,9.10],[-10.24,9.55],[-8.95,9.44],
      [-8.14,8.82],[-8.43,8.23],[-9.27,8.33],[-10.45,8.67],[-12.32,8.28]];
    flank(carrier,m.steel,X(5.60),upper,[[-12.29,8.69,.20],[-9.38,8.99,.22]],.46,.20,'upper temple clevis');
    for(const [z,y] of [[-12.29,8.69],[-9.38,8.99]]) {
      rod(carrier,m.chassis,[X(4.25),y,z],[X(5.89),y,z],.35);
      fastener(carrier,m,[X(5.94),y,z],normal,.22);
    }
    const bracket=[[-9.37,7.62],[-7.99,7.64],[-7.45,7.29],[-7.43,5.46],[-7.94,5.18],
      [-8.50,4.83],[-8.56,3.92],[-9.10,3.89],[-9.24,5.24],[-9.52,5.64]];
    flank(carrier,m.steel,X(6.02),bracket,[] ,.54,.14,'servo bracket');
    for(const [z,y] of [[-9.04,7.31],[-7.83,7.13],[-7.86,5.69]])fastener(carrier,m,[X(6.35),y,z],normal,.136);
    for(const y of [5.62,6.32,7.04]) {
      rod(carrier,m.polish,[X(4.42),y,-7.22],[X(5.88),y,-7.22],.17);
      box(carrier,m.chassis,[.81,.22,1.24],[X(4.65),y,-7.4],.06);
    }
    // Two small lower roller axes stand clear of the gusset in the open bay.
    for(const [z,y] of [[-7.72,1.45],[-8.53,-1.76]]) {
      rod(carrier,m.steel,[X(3.86),y,z],[X(5.67),y,z],.36);
      turned(carrier,m.alloy,[X(5.78),y,z],normal,[[.16,-.21],[.48,-.21],[.52,-.13],[.52,.12],[.46,.21],[.16,.21]],'lower journal');
      fastener(carrier,m,[X(6.0),y,z],normal,.19);
    }
    wire(carrier,m.blue,[[X(4.41),1.52,-5.66],[X(5.19),1.28,-7.18],[X(5.45),.65,-8.31],
      [X(5.32),.10,-9.40],[X(5.18),-.34,-11.04]],.115);
    wire(carrier,m.loom,[[X(4.19),.96,-5.75],[X(4.95),.67,-7.23],[X(5.22),.12,-8.44],
      [X(5.07),-.47,-9.40],[X(5.11),-.80,-11.10]],.11);
    // Slack loops and clips stay inside the open ear bay, behind the face.
    for(const [dy,dx,mat,r] of [[0,0,m.blue,.102],[.32,-.21,m.loom,.124]]) {
      wire(carrier,mat,[[X(4.2),8.48+dy,-8.3],[X(5.86+dx),8.62+dy,-10.7],[X(6.07+dx),7.65+dy,-12.98],
        [X(6.14+dx),5.18+dy,-13.45],[X(5.99+dx),2.08+dy,-13.26],[X(5.59+dx),.30+dy,-12.84],
        [X(5.61+dx),-.95+dy,-10.98],[X(5.40+dx),-1.56+dy,-8.85],[X(4.48),-1.20,-7.35]],r);
    }
    wire(fork,m.loom,[[X(2.31),-8.56,-12.44],[X(3.42),-7.12,-12.66],[X(4.08),-4.32,-12.72],[X(4.47),-2.07,-12.39]],.18);
    wire(fork,m.blue,[[X(1.76),-8.57,-12.42],[X(2.97),-7.58,-12.75],[X(3.66),-5.10,-12.72],[X(4.34),-2.30,-12.15]],.094);
    for(const [z,y] of [[-13.18,6.30],[-12.91,1.68]]) box(carrier,m.chassis,[.35,.27,.48],[X(6.02),y,z],.045);
    // The black inner leaf closes the oral compartment behind the moving
    // cheek, while the visible hinge cap is attached to P4.
    const cheek=[[-7.30,-.42],[-6.60,.21],[-5.42,-.09],[-3.72,-.42],[-1.46,-.88],
      [-.27,-1.53],[-.01,-2.38],[-1.77,-3.86],[-4.46,-3.59],[-6.78,-2.31]];
    flank(jaw,m.seal,X(3.28),cheek.map(([z,y])=>[z-1.90,y]),[],.25,.35,'jaw inner leaf');
    const rocker=[[-9.39,-1.31],[-8.73,-.34],[-6.48,-.26],[-5.66,-.40],[-4.96,-1.33],
      [-5.43,-2.00],[-6.43,-1.71],[-8.58,-1.70]];
    flank(jaw,m.alloy,X(4.55),rocker,[[-8.70,-.98,.24]],.30,.19,'jaw rocker');
    for(const [z,y] of [[tmj.z,tmj.y],[-8.68,-.99]])fastener(jaw,m,[X(4.74),y,z],normal,.22);
    turned(jaw,m.alloy,[X(4.64),tmj.y,tmj.z],normal,[[.12,-.18],[.51,-.18],[.59,-.07],[.59,.17],[.46,.23],[.12,.23]],'J5 hinge');
    fastener(jaw,m,[X(4.88),tmj.y,tmj.z],normal,.21);
  }
  return {fade:Object.values(m),skin:Object.values(skinM)};
}
