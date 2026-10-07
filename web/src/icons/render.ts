// Renders deck icons in the browser: each scene compiles once to a WebGL2 shader and
// draws into a transparent canvas. Without WebGL2, a smaller CPU render stands in.

import { FIGURES } from './figures.ts'
import { SCENES } from './scenes.ts'
import { SHADE, camera, compileGLSL, hexToLinear, renderCPU, type Scene } from './sdf.ts'

let gl: WebGL2RenderingContext | null | undefined
let glCanvas: HTMLCanvasElement | null = null
const programs = new Map<string, WebGLProgram | null>()
const done = new Map<string, HTMLCanvasElement>()
const pending = new Map<string, Promise<HTMLCanvasElement>>()

function context() {
  if (gl !== undefined) return gl
  glCanvas = document.createElement('canvas')
  gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true })
  return gl
}

function program(key: string, scene: Scene, aa: number) {
  const id = `${key}@${aa}`
  if (programs.has(id)) return programs.get(id)!
  const g = context()!
  const { map, mats } = compileGLSL(scene)
  const lin = mats.map((m) => hexToLinear(m.color))
  const n = mats.length
  const head = `#version 300 es
precision highp float;
#define AA ${aa}
const vec3 mCol[${n}]=vec3[${n}](${lin.map((c) => `vec3(${c.map((x) => x.toFixed(5)).join(',')})`).join(',')});
const vec4 mProp[${n}]=vec4[${n}](${mats.map((m) => `vec4(${(m.gloss ?? 0.3).toFixed(3)},${(m.metal ?? 0).toFixed(3)},${(m.emit ?? 0).toFixed(3)},0.0)`).join(',')});
`
  const vs = g.createShader(g.VERTEX_SHADER)!
  g.shaderSource(vs, `#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}`)
  g.compileShader(vs)
  const fs = g.createShader(g.FRAGMENT_SHADER)!
  g.shaderSource(fs, head + map + SHADE)
  g.compileShader(fs)
  const p = g.createProgram()!
  g.attachShader(p, vs)
  g.attachShader(p, fs)
  g.bindAttribLocation(p, 0, 'a')
  g.linkProgram(p)
  const ok = g.getProgramParameter(p, g.LINK_STATUS)
  if (!ok) console.warn('lore icon shader', key, g.getShaderInfoLog(fs))
  programs.set(id, ok ? p : null)
  return ok ? p : null
}

let quad: WebGLBuffer | null = null

/** Draws a scene into the shared WebGL canvas at px × px. False when WebGL can't. */
function renderGL(key: string, scene: Scene, px: number, aa: number): boolean {
  const g = context()
  if (!g || !glCanvas) return false
  const p = program(key, scene, aa)
  if (!p) return false
  if (glCanvas.width !== px || glCanvas.height !== px) glCanvas.width = glCanvas.height = px
  g.viewport(0, 0, px, px)
  g.useProgram(p)
  if (!quad) {
    quad = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, quad)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
  }
  g.bindBuffer(g.ARRAY_BUFFER, quad)
  g.enableVertexAttribArray(0)
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
  const c = camera(scene)
  const u = (name: string) => g.getUniformLocation(p, name)
  g.uniform2f(u('uRes'), px, px)
  g.uniform3fv(u('uRo'), c.ro)
  g.uniform3fv(u('uF'), c.f)
  g.uniform3fv(u('uR'), c.r)
  g.uniform3fv(u('uU'), c.u)
  g.uniform3fv(u('uL'), c.light)
  g.uniform3fv(u('uL2'), c.fill)
  g.uniform1f(u('uFocal'), c.focal)
  const ground = scene.ground === undefined ? -1 : scene.ground
  g.uniform1f(u('uGround'), ground ?? 0)
  g.uniform1f(u('uHasGround'), ground === null ? 0 : 1)
  g.clearColor(0, 0, 0, 0)
  g.clear(g.COLOR_BUFFER_BIT)
  g.drawArrays(g.TRIANGLES, 0, 3)
  return true
}

function drawGL(key: string, scene: Scene, px: number): HTMLCanvasElement | null {
  if (!renderGL(key, scene, px, px > 700 ? 2 : 3)) return null
  const out = document.createElement('canvas')
  out.width = out.height = px
  out.getContext('2d')!.drawImage(glCanvas!, 0, 0)
  return out
}

function drawCPU(scene: Scene, px: number): HTMLCanvasElement {
  const s = Math.min(px, 180)
  const rgba = renderCPU(scene, s, s, 2)
  const small = document.createElement('canvas')
  small.width = small.height = s
  // premultiplied → straight alpha for ImageData
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255
    if (a > 0) for (let k = 0; k < 3; k++) rgba[i + k] = rgba[i + k] / a
  }
  small.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, s, s), 0, 0)
  if (s === px) return small
  const out = document.createElement('canvas')
  out.width = out.height = px
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, px, px)
  return out
}

function cached(id: string, key: string, make: () => Scene, px: number): Promise<HTMLCanvasElement> {
  const hit = done.get(id)
  if (hit) return Promise.resolve(hit)
  if (pending.has(id)) return pending.get(id)!
  const p = new Promise<HTMLCanvasElement>((resolve) => {
    // yield between icons so a page full of them stays responsive (rAF would stall in a background tab)
    setTimeout(() => {
      const scene = make()
      let c: HTMLCanvasElement | null = null
      try {
        c = drawGL(key, scene, px)
      } catch (e) {
        console.warn('lore icon', key, e)
      }
      const out = c || drawCPU(scene, px)
      done.set(id, out)
      pending.delete(id)
      resolve(out)
    }, 0)
  })
  pending.set(id, p)
  return p
}

/** The icon for a deck card, rendered once per size. */
export function icon(key: string, px: number): Promise<HTMLCanvasElement> {
  return cached(`${key}@${px}`, key, SCENES[key] || SCENES.editor, px)
}

/** Already rendered at this size, or null. */
export function iconNow(key: string, px: number): HTMLCanvasElement | null {
  return done.get(`${key}@${px}`) || null
}

/** A builder's figurine, still; `head` frames just the face, for small sizes. */
export function figure(key: string, px: number, head = false): Promise<HTMLCanvasElement> {
  const make = FIGURES[key] || FIGURES.torvalds
  return cached(`fig:${key}@${px}${head ? ':head' : ''}`, `fig:${key}`, head ? () => ({ ...make(), cam: { yaw: 14, pitch: 4, dist: 3.7, target: [0, 0.4, 0], fov: 28 } }) : make, px)
}

/**
 * A figurine on a slow turntable: it sways a little, under lights that turn with the camera,
 * while it's on screen. One still frame without WebGL, with reduced motion, or on a GPU too
 * slow to keep up. Returns a stop function.
 */
export function animateFigure(canvas: HTMLCanvasElement, key: string, px: number): () => void {
  const base = (FIGURES[key] || FIGURES.torvalds)()
  const cam = base.cam || {}
  const ctx = canvas.getContext('2d')!
  canvas.width = canvas.height = px
  const id = `fig:${key}`
  let res = px
  const draw = (t: number) => {
    const scene: Scene = { ...base, cam: { ...cam, yaw: (cam.yaw ?? 24) + Math.sin(t / 1700) * 26, pitch: (cam.pitch ?? 22) + Math.sin(t / 2300) * 2 } }
    if (!renderGL(id, scene, res, 1)) return false
    ctx.clearRect(0, 0, px, px)
    ctx.drawImage(glCanvas!, 0, 0, res, res, 0, 0, px, px)
    return true
  }
  const still = () => figure(key, px).then((c) => (ctx.clearRect(0, 0, px, px), ctx.drawImage(c, 0, 0)))
  if (!context() || matchMedia('(prefers-reduced-motion: reduce)').matches || !draw(0)) {
    still()
    return () => {}
  }
  let raf = 0
  let visible = false
  let last = 0
  let slow = 0
  const loop = (now: number) => {
    raf = 0
    if (!visible) return
    if (now - last >= 33) {
      const t0 = performance.now()
      draw(now)
      const ms = performance.now() - t0
      last = now
      // too slow to animate smoothly: render smaller, then stop and keep a crisp still
      if (ms > 26 && ++slow > 4) {
        if (res > px * 0.6) {
          res = Math.round(res * 0.75)
          slow = 0
        } else {
          stop()
          still()
          return
        }
      }
    }
    raf = requestAnimationFrame(loop)
  }
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    if (visible && !raf) raf = requestAnimationFrame(loop)
  })
  io.observe(canvas)
  const stop = () => {
    io.disconnect()
    cancelAnimationFrame(raf)
  }
  return stop
}
