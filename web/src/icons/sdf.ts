// A tiny signed-distance scene language for the deck icons. One scene description
// compiles to a WebGL2 fragment shader (browser) and to a plain JS function (terminal),
// and both shade it with the same studio lighting.

export type V3 = [number, number, number]

export type Prim =
  | { sphere: number }
  | { ellipsoid: V3 }
  | { box: V3; round?: number }
  /** [radius, half height], along Y */
  | { cyl: [number, number]; round?: number }
  /** [half height, bottom radius, top radius], along Y */
  | { cone: [number, number, number]; round?: number }
  /** [ring radius, tube radius], in the XZ plane */
  | { torus: [number, number] }
  | { capsule: [V3, V3, number] }
  /** A polygon in XY, extruded along Z by ±depth */
  | { poly: [number, number][]; depth: number; round?: number }
  | { octa: number }

export interface Node {
  prim?: Prim
  kids?: Node[]
  /** How kids combine: union (default), smooth union with k, subtract kids[1..] from kids[0], intersect. */
  op?: 'union' | 'smooth' | 'sub' | 'inter'
  k?: number
  at?: V3
  /** Degrees, applied X then Y then Z. */
  rot?: V3
  scale?: number
  /** Mirror across the parent's X = 0 plane. */
  mirrorX?: boolean
  mat?: number
  /** Ripples along local Y: [amplitude, frequency]. */
  ridge?: [number, number]
}

export interface Material {
  color: string
  gloss?: number
  metal?: number
  emit?: number
}

export interface Scene {
  root: Node
  mats: Material[]
  cam?: { yaw?: number; pitch?: number; dist?: number; target?: V3; fov?: number }
  /** Y of the floor that catches the contact shadow; null for none. */
  ground?: number | null
}

// ───────────────────────── shared math

const rad = (d: number) => (d * Math.PI) / 180

/** Inverse rotation (world → local) as a row-major 3×3. */
function invRot(rot: V3 = [0, 0, 0]): number[] {
  const [x, y, z] = rot.map(rad)
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z)
  // R = Rz·Ry·Rx; inverse = Rxᵀ·Ryᵀ·Rzᵀ
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]
  const mul = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
    return o
  }
  const R = mul(Rz, mul(Ry, Rx))
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]
}

export function hexToLinear(hex: string): V3 {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return v.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as V3
}

/** Camera basis and the key light, which sits up and to the left of whatever the camera sees. */
export function camera(scene: Scene) {
  const c = scene.cam || {}
  const yaw = rad(c.yaw ?? 24)
  const pitch = rad(c.pitch ?? 22)
  const dist = c.dist ?? 7
  const t = c.target || [0, 0, 0]
  const ro: V3 = [t[0] + dist * Math.sin(yaw) * Math.cos(pitch), t[1] + dist * Math.sin(pitch), t[2] + dist * Math.cos(yaw) * Math.cos(pitch)]
  const f = norm(sub(t, ro))
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  const light = norm(add(add(scale(r, -0.62), [0, 0.95, 0]), scale(f, -0.45)))
  const fill = norm(add(add(scale(r, 0.9), [0, 0.15, 0]), scale(f, -0.2)))
  return { ro, f, r, u, light, fill, focal: 1 / Math.tan(rad(c.fov ?? 28) / 2) }
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.sqrt(dot(a, a))
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1))

/** Children inherit their parent's material unless they name their own. */
function withMats(n: Node, mat = 0): Node {
  const m = n.mat ?? mat
  return { ...n, mat: m, kids: n.kids?.map((k) => withMats(k, m)) }
}

// ───────────────────────── GLSL

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(+x.toFixed(5)))
const v3 = (a: V3) => `vec3(${a.map(f).join(',')})`

const LIB = /* glsl */ `
float sdEll(vec3 p, vec3 r){ float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/max(k1,1e-5); }
float sdBox(vec3 p, vec3 b, float r){ vec3 q=abs(p)-b+r; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-r; }
float sdCyl(vec3 p, float ra, float h, float rb){ vec2 d=vec2(length(p.xz)-ra+rb, abs(p.y)-h+rb); return min(max(d.x,d.y),0.0)+length(max(d,0.0))-rb; }
float sdCone(vec3 p, float h, float r1, float r2, float rr){
  h-=rr; r1-=rr; r2-=rr;
  vec2 q=vec2(length(p.xz),p.y); vec2 k1=vec2(r2,h); vec2 k2=vec2(r2-r1,2.0*h);
  vec2 ca=vec2(q.x-min(q.x,(q.y<0.0)?r1:r2),abs(q.y)-h);
  vec2 cb=q-k1+k2*clamp(dot(k1-q,k2)/dot(k2,k2),0.0,1.0);
  float s=(cb.x<0.0&&ca.y<0.0)?-1.0:1.0;
  return s*sqrt(min(dot(ca,ca),dot(cb,cb)))-rr; }
float sdTorus(vec3 p, float R, float r){ vec2 q=vec2(length(p.xz)-R,p.y); return length(q)-r; }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
float sdOcta(vec3 p, float s){ p=abs(p); return (p.x+p.y+p.z-s)*0.57735027; }
float extrude(vec3 p, float d2, float h, float r){ vec2 w=vec2(d2+r, abs(p.z)-h+r); return min(max(w.x,w.y),0.0)+length(max(w,0.0))-r; }
vec2 opU(vec2 a, vec2 b){ return a.x<b.x?a:b; }
vec2 opS(vec2 a, vec2 b, float k){ float h=clamp(0.5+0.5*(b.x-a.x)/k,0.0,1.0); return vec2(mix(b.x,a.x,h)-k*h*(1.0-h), a.x<b.x?a.y:b.y); }
`

export function compileGLSL(scene: Scene): { map: string; mats: Material[] } {
  const lines: string[] = []
  const fns: string[] = []
  let n = 0
  const v = (p: string) => `${p}${n++}`

  const prim = (p: Prim, q: string): string => {
    if ('sphere' in p) return `length(${q})-${f(p.sphere)}`
    if ('ellipsoid' in p) return `sdEll(${q},${v3(p.ellipsoid)})`
    if ('box' in p) return `sdBox(${q},${v3(p.box)},${f(p.round ?? 0)})`
    if ('cyl' in p) return `sdCyl(${q},${f(p.cyl[0])},${f(p.cyl[1])},${f(p.round ?? 0)})`
    if ('cone' in p) return `sdCone(${q},${f(p.cone[0])},${f(p.cone[1])},${f(p.cone[2])},${f(p.round ?? 0)})`
    if ('torus' in p) return `sdTorus(${q},${f(p.torus[0])},${f(p.torus[1])})`
    if ('capsule' in p) return `sdCap(${q},${v3(p.capsule[0])},${v3(p.capsule[1])},${f(p.capsule[2])})`
    if ('octa' in p) return `sdOcta(${q},${f(p.octa)})`
    // polygon: one function per shape, vertices inlined
    const name = v('poly')
    const pts = p.poly
    const N = pts.length
    fns.push(`float ${name}(vec2 p){ vec2 v[${N}]=vec2[${N}](${pts.map(([x, y]) => `vec2(${f(x)},${f(y)})`).join(',')});
  float d=dot(p-v[0],p-v[0]); float s=1.0;
  for(int i=0,j=${N - 1};i<${N};j=i,i++){ vec2 e=v[j]-v[i]; vec2 w=p-v[i]; vec2 b=w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0); d=min(d,dot(b,b));
    bvec3 c=bvec3(p.y>=v[i].y,p.y<v[j].y,e.x*w.y>e.y*w.x); if(all(c)||all(not(c))) s*=-1.0; }
  return s*sqrt(d); }`)
    return `extrude(${q},${name}(${q}.xy),${f(p.depth)},${f(p.round ?? 0)})`
  }

  const gen = (node: Node, pIn: string): string => {
    let q = pIn
    if (node.mirrorX || node.at || node.rot || node.scale) {
      q = v('q')
      lines.push(`vec3 ${q}=${pIn};`)
      if (node.mirrorX) lines.push(`${q}.x=abs(${q}.x);`)
      if (node.at) lines.push(`${q}-=${v3(node.at)};`)
      if (node.rot) {
        const m = invRot(node.rot)
        // GLSL mat3 is column-major; m is row-major
        lines.push(`${q}=mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(f).join(',')})*${q};`)
      }
      if (node.scale) lines.push(`${q}/=${f(node.scale)};`)
    }
    const out = v('d')
    if (node.prim) {
      lines.push(`vec2 ${out}=vec2(${prim(node.prim, q)},${f(node.mat ?? 0)});`)
      if (node.ridge) lines.push(`${out}.x+=${f(node.ridge[0])}*sin(${q}.y*${f(node.ridge[1])});`)
    } else {
      const kids = (node.kids || []).map((k) => gen(k, q))
      lines.push(`vec2 ${out}=${kids[0] || 'vec2(1e5,0.0)'};`)
      for (const k of kids.slice(1)) {
        if (node.op === 'sub') lines.push(`${out}.x=max(${out}.x,-${k}.x);`)
        else if (node.op === 'inter') lines.push(`${out}.x=max(${out}.x,${k}.x);`)
        else if (node.op === 'smooth') lines.push(`${out}=opS(${out},${k},${f(node.k ?? 0.1)});`)
        else lines.push(`${out}=opU(${out},${k});`)
      }
    }
    if (node.scale) lines.push(`${out}.x*=${f(node.scale)};`)
    return out
  }
  const res = gen(withMats(scene.root), 'p')
  return { map: `${LIB}\n${fns.join('\n')}\nvec2 map(vec3 p){\n${lines.join('\n')}\nreturn ${res};\n}`, mats: scene.mats }
}

/** The shading half of the fragment shader; `map` and the material arrays are prepended. */
export const SHADE = /* glsl */ `
uniform vec2 uRes; uniform vec3 uRo, uF, uR, uU, uL, uL2; uniform float uFocal, uGround, uHasGround;
out vec4 outColor;
vec3 nrm(vec3 p){ const vec2 e=vec2(1.0,-1.0)*0.0006; return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x); }
float shadow(vec3 ro, vec3 rd){ float res=1.0, t=0.02; for(int i=0;i<48;i++){ float h=map(ro+rd*t).x; res=min(res,10.0*h/t); t+=clamp(h,0.015,0.25); if(res<0.002||t>6.0) break; } return clamp(res,0.0,1.0); }
float occ(vec3 p, vec3 n){ float o=0.0, s=1.0; for(int i=0;i<5;i++){ float h=0.02+0.11*float(i); o+=(h-map(p+n*h).x)*s; s*=0.75; } return clamp(1.0-2.2*o,0.0,1.0); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
vec4 shade(vec2 uv){
  vec3 rd=normalize(uF*uFocal+uv.x*uR+uv.y*uU);
  float t=0.0; vec2 h=vec2(1.0,0.0); bool hit=false;
  for(int i=0;i<140;i++){ h=map(uRo+rd*t); if(h.x<0.0005*t){ hit=true; break; } t+=h.x*0.85; if(t>16.0) break; }
  if(hit){
    vec3 p=uRo+rd*t; vec3 n=nrm(p); int m=int(h.y+0.5);
    vec3 alb=mCol[m]; vec4 pr=mProp[m]; float gloss=pr.x, metal=pr.y, emit=pr.z;
    float sh=shadow(p+n*0.003,uL); float ao=occ(p,n);
    float dif=clamp((dot(n,uL)+0.3)/1.3,0.0,1.0)*mix(0.25,1.0,sh);
    float dif2=clamp(dot(n,uL2),0.0,1.0);
    vec3 sky=mix(vec3(0.46,0.40,0.36),vec3(0.92,0.95,1.0),0.5+0.5*n.y);
    float fre=pow(1.0-clamp(dot(n,-rd),0.0,1.0),4.0);
    vec3 H=normalize(uL-rd);
    float spe=pow(clamp(dot(n,H),0.0,1.0),mix(10.0,140.0,gloss))*gloss*sh*(0.35+0.65*fre+0.4);
    vec3 lin=1.45*dif*vec3(1.0,0.95,0.88)+0.62*sky*ao+0.3*dif2*vec3(0.8,0.88,1.0)*ao;
    vec3 col=alb*lin*(1.0-0.75*metal);
    col+=spe*mix(vec3(1.0),alb*1.6,metal)*1.3;
    col+=fre*ao*sky*(0.12+0.3*gloss);
    col+=alb*emit*2.4;
    return vec4(aces(col*0.95),1.0);
  }
  if(uHasGround>0.5 && rd.y<0.0){
    float tg=(uGround-uRo.y)/rd.y; vec3 p=uRo+rd*tg;
    float sh=shadow(p+vec3(0.0,0.002,0.0),uL);
    float c=0.0; for(int i=0;i<4;i++){ float hh=0.08+0.22*float(i); c+=clamp(1.0-map(p+vec3(0.0,hh,0.0)).x/hh,0.0,1.0); }
    float a=clamp((1.0-sh)*0.32+c*0.16,0.0,0.7)*smoothstep(3.2,0.6,length(p.xz));
    return vec4(vec3(0.0),a);
  }
  return vec4(0.0);
}
void main(){
  vec4 acc=vec4(0.0);
  for(int j=0;j<AA;j++) for(int i=0;i<AA;i++){
    vec2 o=vec2(float(i),float(j))/float(AA)-0.5+0.5/float(AA);
    vec2 uv=(2.0*(gl_FragCoord.xy+o)-uRes)/uRes.y;
    vec4 c=shade(uv);
    c.rgb=pow(c.rgb,vec3(1.0/2.2));
    acc+=vec4(c.rgb*c.a,c.a);
  }
  outColor=acc/float(AA*AA);
}
`

// ───────────────────────── CPU (terminal)

type Fn = (p: V3) => [number, number]

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const ln2 = (x: number, y: number) => Math.sqrt(x * x + y * y)

function cpuPrim(p: Prim): (q: V3) => number {
  if ('sphere' in p) return (q) => len(q) - p.sphere
  if ('ellipsoid' in p) {
    const r = p.ellipsoid
    return (q) => {
      const k0 = len([q[0] / r[0], q[1] / r[1], q[2] / r[2]])
      const k1 = len([q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2])])
      return (k0 * (k0 - 1)) / Math.max(k1, 1e-5)
    }
  }
  if ('box' in p) {
    const b = p.box, r = p.round ?? 0
    return (q) => {
      const x = Math.abs(q[0]) - b[0] + r, y = Math.abs(q[1]) - b[1] + r, z = Math.abs(q[2]) - b[2] + r
      return len([Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)]) + Math.min(Math.max(x, Math.max(y, z)), 0) - r
    }
  }
  if ('cyl' in p) {
    const [ra, h] = p.cyl, rb = p.round ?? 0
    return (q) => {
      const dx = ln2(q[0], q[2]) - ra + rb, dy = Math.abs(q[1]) - h + rb
      return Math.min(Math.max(dx, dy), 0) + ln2(Math.max(dx, 0), Math.max(dy, 0)) - rb
    }
  }
  if ('cone' in p) {
    const rr = p.round ?? 0
    const h = p.cone[0] - rr, r1 = p.cone[1] - rr, r2 = p.cone[2] - rr
    return (q) => {
      const qx = ln2(q[0], q[2]), qy = q[1]
      const k2x = r2 - r1, k2y = 2 * h
      const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h
      const tt = clamp(((r2 - qx) * k2x + (h - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1)
      const cbx = qx - r2 + k2x * tt, cby = qy - h + k2y * tt
      const s = cbx < 0 && cay < 0 ? -1 : 1
      return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby)) - rr
    }
  }
  if ('torus' in p) {
    const [R, r] = p.torus
    return (q) => ln2(ln2(q[0], q[2]) - R, q[1]) - r
  }
  if ('capsule' in p) {
    const [a, b, r] = p.capsule
    const ba = sub(b, a)
    const bb = dot(ba, ba)
    return (q) => {
      const pa = sub(q, a)
      const h = clamp(dot(pa, ba) / bb, 0, 1)
      return len(sub(pa, scale(ba, h))) - r
    }
  }
  if ('octa' in p) return (q) => (Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) - p.octa) * 0.57735027
  const v = p.poly, N = v.length, depth = p.depth, r = p.round ?? 0
  return (q) => {
    const px = q[0], py = q[1]
    let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2
    let s = 1
    for (let i = 0, j = N - 1; i < N; j = i, i++) {
      const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1], wx = px - v[i][0], wy = py - v[i][1]
      const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
      const bx = wx - ex * t, by = wy - ey * t
      d = Math.min(d, bx * bx + by * by)
      const c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
    }
    const d2 = s * Math.sqrt(d)
    const wx = d2 + r, wy = Math.abs(q[2]) - depth + r
    return Math.min(Math.max(wx, wy), 0) + ln2(Math.max(wx, 0), Math.max(wy, 0)) - r
  }
}

function cpuNode(node: Node): Fn {
  const m = node.rot ? invRot(node.rot) : null
  const at = node.at
  const sc = node.scale
  const xf = (p: V3): V3 => {
    let x = node.mirrorX ? Math.abs(p[0]) : p[0], y = p[1], z = p[2]
    if (at) (x -= at[0]), (y -= at[1]), (z -= at[2])
    if (m) [x, y, z] = [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
    if (sc) (x /= sc), (y /= sc), (z /= sc)
    return [x, y, z]
  }
  let inner: Fn
  if (node.prim) {
    const d = cpuPrim(node.prim)
    const mat = node.mat ?? 0
    const ridge = node.ridge
    inner = ridge ? (q) => [d(q) + ridge[0] * Math.sin(q[1] * ridge[1]), mat] : (q) => [d(q), mat]
  } else {
    const kids = (node.kids || []).map(cpuNode)
    const k = node.k ?? 0.1
    inner = (q) => {
      let a = kids[0] ? kids[0](q) : ([1e5, 0] as [number, number])
      for (let i = 1; i < kids.length; i++) {
        const b = kids[i](q)
        if (node.op === 'sub') a = [Math.max(a[0], -b[0]), a[1]]
        else if (node.op === 'inter') a = [Math.max(a[0], b[0]), a[1]]
        else if (node.op === 'smooth') {
          const h = clamp(0.5 + (0.5 * (b[0] - a[0])) / k, 0, 1)
          a = [b[0] * (1 - h) + a[0] * h - k * h * (1 - h), a[0] < b[0] ? a[1] : b[1]]
        } else if (b[0] < a[0]) a = b
      }
      return a
    }
  }
  return (p) => {
    const r = inner(xf(p))
    return sc ? [r[0] * sc, r[1]] : r
  }
}

/** Renders a scene to premultiplied RGBA bytes on the CPU. Small sizes only (the terminal). */
export function renderCPU(scene: Scene, w: number, h: number, aa = 2): Uint8ClampedArray {
  const map = cpuNode(withMats(scene.root))
  const cam = camera(scene)
  const mats = scene.mats.map((m) => ({ alb: hexToLinear(m.color), gloss: m.gloss ?? 0.3, metal: m.metal ?? 0, emit: m.emit ?? 0 }))
  const ground = scene.ground === undefined ? -1 : scene.ground
  const out = new Uint8ClampedArray(w * h * 4)
  const nrm = (p: V3): V3 => {
    const e = 0.0006
    const a = map([p[0] + e, p[1] - e, p[2] - e])[0], b = map([p[0] - e, p[1] - e, p[2] + e])[0]
    const c = map([p[0] - e, p[1] + e, p[2] - e])[0], d = map([p[0] + e, p[1] + e, p[2] + e])[0]
    return norm([a - b - c + d, -a - b + c + d, -a + b - c + d])
  }
  const shadow = (ro: V3, rd: V3) => {
    let res = 1, t = 0.02
    for (let i = 0; i < 32; i++) {
      const hh = map(add(ro, scale(rd, t)))[0]
      res = Math.min(res, (10 * hh) / t)
      t += clamp(hh, 0.02, 0.3)
      if (res < 0.002 || t > 6) break
    }
    return clamp(res, 0, 1)
  }
  const occ = (p: V3, n: V3) => {
    let o = 0, s = 1
    for (let i = 0; i < 4; i++) {
      const hh = 0.02 + 0.14 * i
      o += (hh - map(add(p, scale(n, hh)))[0]) * s
      s *= 0.75
    }
    return clamp(1 - 2.2 * o, 0, 1)
  }
  const aces = (x: number) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
  const shade = (u: number, v: number): [number, number, number, number] => {
    const rd = norm(add(add(scale(cam.f, cam.focal), scale(cam.r, u)), scale(cam.u, v)))
    let t = 0
    let hit: [number, number] | null = null
    for (let i = 0; i < 100; i++) {
      const hh = map(add(cam.ro, scale(rd, t)))
      if (hh[0] < 0.001 * t) {
        hit = hh
        break
      }
      t += hh[0] * 0.85
      if (t > 16) break
    }
    if (hit) {
      const p = add(cam.ro, scale(rd, t))
      const n = nrm(p)
      const m = mats[Math.round(hit[1])] || mats[0]
      const sh = shadow(add(p, scale(n, 0.003)), cam.light)
      const ao = occ(p, n)
      const dif = clamp((dot(n, cam.light) + 0.3) / 1.3, 0, 1) * (0.25 + 0.75 * sh)
      const dif2 = clamp(dot(n, cam.fill), 0, 1)
      const sk = 0.5 + 0.5 * n[1]
      const sky: V3 = [0.46 + (0.92 - 0.46) * sk, 0.4 + (0.95 - 0.4) * sk, 0.36 + (1 - 0.36) * sk]
      const fre = Math.pow(1 - clamp(-dot(n, rd), 0, 1), 4)
      const H = norm(sub(cam.light, rd))
      const spe = Math.pow(clamp(dot(n, H), 0, 1), 10 + 130 * m.gloss) * m.gloss * sh * (0.75 + 0.65 * fre)
      const key: V3 = [1, 0.95, 0.88], fill: V3 = [0.8, 0.88, 1]
      const c = [0, 1, 2].map((i) => {
        const lin = 1.45 * dif * key[i] + 0.62 * sky[i] * ao + 0.3 * dif2 * fill[i] * ao
        let col = m.alb[i] * lin * (1 - 0.75 * m.metal)
        col += spe * (m.metal ? m.alb[i] * 1.6 * m.metal + (1 - m.metal) : 1) * 1.3
        col += fre * ao * sky[i] * (0.12 + 0.3 * m.gloss)
        col += m.alb[i] * m.emit * 2.4
        return Math.pow(aces(col * 0.95), 1 / 2.2)
      })
      return [c[0], c[1], c[2], 1]
    }
    if (ground !== null && rd[1] < 0) {
      const tg = (ground - cam.ro[1]) / rd[1]
      const p = add(cam.ro, scale(rd, tg))
      const sh = shadow(add(p, [0, 0.002, 0]), cam.light)
      let c = 0
      for (let i = 0; i < 3; i++) {
        const hh = 0.08 + 0.3 * i
        c += clamp(1 - map(add(p, [0, hh, 0]))[0] / hh, 0, 1)
      }
      const r = ln2(p[0], p[2])
      const fade = clamp((3.2 - r) / 2.6, 0, 1)
      return [0, 0, 0, clamp((1 - sh) * 0.32 + c * 0.2, 0, 0.7) * fade * fade * (3 - 2 * fade)]
    }
    return [0, 0, 0, 0]
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0]
      for (let j = 0; j < aa; j++)
        for (let i = 0; i < aa; i++) {
          const px = x + (i + 0.5) / aa, py = h - (y + (j + 0.5) / aa)
          const c = shade((2 * px - w) / h, (2 * py - h) / h)
          acc[0] += c[0] * c[3]
          acc[1] += c[1] * c[3]
          acc[2] += c[2] * c[3]
          acc[3] += c[3]
        }
      const o = (y * w + x) * 4
      for (let k = 0; k < 4; k++) out[o + k] = (acc[k] / (aa * aa)) * 255
    }
  return out
}
