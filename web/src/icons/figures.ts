// The builders lore matches you with, as little studio figurines: a bust on a plinth, read
// from their best-known public look (the turtleneck, the leather jacket, the stack of
// printouts) rather than drawn from any photo. Same scene language and light as the deck.

import type { Material, Node, Scene, V3 } from './sdf.ts'

// material slots every bust shares
const SKIN = 0
const HAIR = 1
const TOP = 2
const EYE = 3
const FRAME = 4
const MOUTH = 5
const PLINTH = 6
const TRIM = 7
// props start here
const P = 8

type Hair = 'short' | 'swept' | 'receding' | 'bald' | 'sides' | 'bob' | 'curly' | 'messy' | 'wild'
type Top = 'tee' | 'turtleneck' | 'hoodie' | 'jacket' | 'sweater' | 'shirt'

interface Look {
  skin: string
  hair: string
  /** Shirt, jacket or sweater color. */
  top: string
  trim?: string
  style: Hair
  wear: Top
  glasses?: 'round' | 'square' | 'big'
  frame?: string
  beard?: 'full' | 'short'
  /** Shinier skin, for a shaved head. */
  shine?: number
  /** A cloth jacket (blazer) instead of leather. */
  matte?: boolean
  prop?: Node[]
  propMats?: Material[]
  /** Extra pieces worn on the head. */
  worn?: Node[]
}

const cap = (a: V3, b: V3, r: number, mat?: number): Node => ({ prim: { capsule: [a, b, r] }, mat })
const ell = (r: V3, at: V3, mat?: number, rot?: V3): Node => ({ prim: { ellipsoid: r }, at, mat, rot })
const box = (b: V3, at: V3, round = 0, mat?: number, rot?: V3): Node => ({ prim: { box: b, round }, at, mat, rot })

// the head: center and radii, so hair and glasses can sit on it
const H: V3 = [0, 0.42, 0.02]
const R: V3 = [0.46, 0.53, 0.47]

/** Everything above the plane y = a + b·z, as a big box: hairlines, cut lines. */
function above(a: number, b: number, mat?: number): Node {
  const ang = Math.atan(b)
  // the box's bottom face is the plane: +Y turned by -ang about X is its normal (0, cos, -sin)
  return box([1.4, 0.9, 1.4], [0, a + Math.cos(ang) * 0.9, -Math.sin(ang) * 0.9], 0, mat, [-(ang * 180) / Math.PI, 0, 0])
}

/** A shell over the head, cut below a hairline. */
function shell(thick: number, a: number, b: number, mat = HAIR, ridge?: [number, number]): Node {
  return {
    op: 'inter',
    mat,
    kids: [{ prim: { ellipsoid: [R[0] + thick, R[1] + thick, R[2] + thick] }, at: [H[0], H[1] + thick * 0.4, H[2] - thick * 0.3], ridge }, above(a, b)],
  }
}

/** Hair: a shell over the head plus volumes, blended so it reads as one shape. */
function hair(style: Hair): Node[] {
  const blend = (...kids: Node[]): Node[] => [{ op: 'smooth', k: 0.07, mat: HAIR, kids }]
  switch (style) {
    case 'short':
      return blend(shell(0.035, 0.52, 0.6), ell([0.3, 0.1, 0.32], [0, 0.88, 0.02]))
    case 'swept':
      // a side part, the front swept up and over
      return blend(shell(0.04, 0.5, 0.58), ell([0.3, 0.11, 0.26], [0.05, 0.9, 0.16], HAIR, [12, 0, -12]), ell([0.17, 0.08, 0.14], [0.17, 0.86, 0.32], HAIR, [26, 0, -20]))
    case 'receding':
      // a high forehead: the hairline starts near the crown
      return [shell(0.03, 0.56, 0.86)]
    case 'sides':
      // the back and sides only
      return [{ op: 'inter', kids: [shell(0.045, 0.3, 0.1), box([1, 0.32, 0.6], [0, 0.3, -0.42])] }]
    case 'bob':
      return [
        {
          op: 'sub',
          kids: [ell([0.58, 0.56, 0.58], [0, 0.5, -0.03], HAIR), box([1.2, 0.5, 1], [0, -0.3, 0]), box([0.37, 0.26, 0.5], [0, 0.4, 0.4], 0.16)],
        },
        ell([0.4, 0.11, 0.2], [0, 0.78, 0.36], HAIR, [-24, 0, 0]),
        ell([0.4, 0.12, 0.42], [0, 0.88, 0], HAIR),
      ]
    case 'curly':
      return blend(shell(0.06, 0.52, 0.55, HAIR, [0.014, 46]), ell([0.3, 0.1, 0.32], [0, 0.9, 0.04], HAIR, undefined))
    case 'messy':
      return blend(shell(0.045, 0.5, 0.58), ell([0.17, 0.1, 0.14], [-0.14, 0.93, 0.18], HAIR, [0, 0, 20]), ell([0.15, 0.1, 0.15], [0.18, 0.94, 0.06], HAIR, [0, 0, -24]), ell([0.15, 0.09, 0.15], [0, 0.96, -0.14]))
    case 'wild':
      return blend(shell(0.07, 0.46, 0.5), ell([0.36, 0.14, 0.38], [0, 0.92, -0.02]), ell([0.13, 0.19, 0.2], [0.42, 0.56, -0.1]), ell([0.13, 0.19, 0.2], [-0.42, 0.56, -0.1]))
    case 'bald':
      return []
  }
}

function beard(kind: 'full' | 'short'): Node[] {
  if (kind === 'short') {
    // jaw and chin, a mustache, and the mouth left clear
    return [
      { op: 'sub', mat: HAIR, kids: [ell([R[0] + 0.02, R[1] + 0.018, R[2] + 0.02], H), above(0.27, -0.2), ell([0.11, 0.05, 0.2], [0, 0.225, 0.44])] },
      cap([-0.1, 0.285, 0.47], [0.1, 0.285, 0.47], 0.022, HAIR),
    ]
  }
  return [
    { op: 'smooth', k: 0.06, kids: [{ op: 'sub', kids: [ell([R[0] + 0.05, R[1] + 0.02, R[2] + 0.06], [0, 0.36, 0.04], HAIR), above(0.3, -0.25)] }, ell([0.3, 0.2, 0.22], [0, 0.04, 0.3], HAIR)] },
    cap([-0.12, 0.27, 0.49], [0.12, 0.27, 0.49], 0.035, HAIR),
  ]
}

function glasses(kind: 'round' | 'square' | 'big'): Node[] {
  const y = 0.47
  const z = 0.52
  const lens: Node =
    kind === 'round'
      ? { prim: { torus: [0.1, 0.011] }, rot: [90, 0, 0] }
      : { op: 'sub', kids: [box(kind === 'big' ? [0.15, 0.125, 0.012] : [0.125, 0.085, 0.012], [0, 0, 0], 0.035), box(kind === 'big' ? [0.128, 0.104, 0.05] : [0.104, 0.064, 0.05], [0, 0, 0], 0.025)] }
  const x = kind === 'big' ? 0.18 : 0.165
  return [
    { mirrorX: true, kids: [{ at: [x, y, z], kids: [lens] }, cap([x + (kind === 'big' ? 0.15 : 0.11), y + 0.01, z - 0.02], [0.47, y, 0.04], 0.012)], mat: FRAME },
    cap([-x + 0.1, y + 0.02, z + 0.01], [x - 0.1, y + 0.02, z + 0.01], 0.012, FRAME),
  ]
}

function torso(wear: Top): Node[] {
  const body: Node = {
    op: 'inter',
    mat: TOP,
    kids: [
      { op: 'smooth', k: 0.16, kids: [cap([-0.33, -0.48, 0], [0.33, -0.48, 0], 0.32), box([0.5, 0.26, 0.3], [0, -0.64, 0], 0.2)] },
      box([1.3, 0.5, 1.3], [0, -0.36, 0]),
    ],
  }
  const neck: Node = { prim: { cyl: [0.15, 0.16] }, at: [0, -0.08, 0], mat: SKIN }
  switch (wear) {
    case 'tee':
      return [body, neck, { prim: { torus: [0.165, 0.03] }, at: [0, -0.17, 0.02], mat: TRIM }]
    case 'turtleneck':
      return [body, { prim: { cyl: [0.185, 0.17], round: 0.05 }, at: [0, -0.06, 0], mat: TOP, ridge: [0.006, 70] }]
    case 'hoodie':
      return [
        body,
        neck,
        { prim: { torus: [0.26, 0.085] }, at: [0, -0.15, -0.06], rot: [-14, 0, 0], mat: TOP },
        { mirrorX: true, kids: [cap([0.09, -0.22, 0.3], [0.1, -0.5, 0.37], 0.016, TRIM)] },
      ]
    case 'jacket':
      return [
        body,
        neck,
        // the tee under the open jacket
        { op: 'inter', kids: [box([0.15, 0.3, 0.3], [0, -0.42, 0.06], 0.1, TRIM), box([1, 0.5, 1], [0, -0.36, 0])] },
        // collar, standing up
        { mirrorX: true, kids: [box([0.13, 0.1, 0.03], [0.16, -0.15, 0.12], 0.025, TOP, [-12, -38, 12])] },
        // lapels
        { mirrorX: true, kids: [box([0.06, 0.24, 0.025], [0.17, -0.42, 0.33], 0.02, TOP, [-14, 0, -16])] },
      ]
    case 'sweater':
      return [
        body,
        neck,
        // the collared shirt under a V neck
        { prim: { poly: [[-0.16, 0], [0.16, 0], [0, -0.26]], depth: 0.04, round: 0.02 }, at: [0, -0.16, 0.25], rot: [-26, 0, 0], mat: TRIM },
        { mirrorX: true, kids: [{ prim: { poly: [[0, 0], [0.13, 0.02], [0.05, -0.1]], depth: 0.02, round: 0.012 }, at: [0.04, -0.13, 0.18], rot: [-30, 0, 0], mat: TRIM }] },
      ]
    case 'shirt':
      return [
        body,
        neck,
        { mirrorX: true, kids: [{ prim: { poly: [[0, 0], [0.14, 0.03], [0.06, -0.12]], depth: 0.022, round: 0.012 }, at: [0.03, -0.12, 0.17], rot: [-30, 0, 0], mat: TRIM }] },
        ...[-0.3, -0.42, -0.54].map((y): Node => ({ prim: { sphere: 0.02 }, at: [0, y, 0.37 + (y + 0.3) * 0.05], mat: TRIM })),
      ]
  }
}

function bust(look: Look): Scene {
  const face: Node[] = [
    { op: 'smooth', k: 0.05, mat: SKIN, kids: [ell(R, H), ell([0.055, 0.075, 0.055], [0, 0.36, 0.49])] },
    { mirrorX: true, kids: [ell([0.06, 0.11, 0.07], [0.45, 0.4, 0.0], SKIN)] },
    { mirrorX: true, kids: [ell([0.048, 0.066, 0.034], [0.16, 0.46, 0.45], EYE)] },
    { mirrorX: true, kids: [cap([0.1, 0.585, 0.448], [0.23, 0.575, 0.418], 0.02, HAIR)] },
    { mirrorX: true, kids: [cap([0.075, 0.24, 0.444], [0, 0.222, 0.455], 0.016, MOUTH)] },
  ]
  return {
    mats: [
      { color: look.skin, gloss: look.shine ?? 0.18 },
      { color: look.hair, gloss: 0.22 },
      { color: look.top, gloss: look.wear === 'jacket' && !look.matte ? 0.8 : 0.12 },
      { color: '#1d1a17', gloss: 0.95 },
      { color: look.frame || '#2a2622', gloss: 0.7, metal: look.frame ? 0.8 : 0 },
      { color: '#9a4f3f', gloss: 0.3 },
      { color: '#ece6da', gloss: 0.25 },
      { color: look.trim || '#f4f0e8', gloss: 0.2 },
      ...(look.propMats || []),
    ],
    cam: { yaw: 16, pitch: 8, dist: 7.2, target: [look.prop ? 0.32 : 0, -0.02, 0], fov: 28 },
    root: {
      kids: [
        { prim: { cyl: [0.82, 0.07], round: 0.05 }, at: [0, -0.93, 0], mat: PLINTH },
        ...torso(look.wear),
        ...face,
        ...hair(look.style),
        ...(look.beard ? beard(look.beard) : []),
        ...(look.glasses ? glasses(look.glasses) : []),
        ...(look.worn || []),
        ...(look.prop || []),
      ],
    },
  }
}

// ───────────────────────── props

/** Headphones over the head; `mic` adds a boom. */
function headphones(color: number, mic = false): Node[] {
  return [
    { op: 'inter', mat: color, kids: [{ prim: { torus: [0.53, 0.035] }, at: [0, 0.42, 0], rot: [90, 0, 0] }, box([1, 0.5, 1], [0, 0.9, 0])] },
    { mirrorX: true, kids: [{ prim: { cyl: [0.13, 0.06], round: 0.04 }, at: [0.5, 0.4, 0], rot: [0, 0, 90], mat: color }] },
    ...(mic ? [cap([-0.52, 0.33, 0.06], [-0.22, 0.2, 0.42], 0.018, color), { prim: { sphere: 0.045 }, at: [-0.2, 0.2, 0.44], mat: color } as Node] : []),
  ]
}

const LOOKS: Record<string, Look> = {
  torvalds: {
    skin: '#f0c7a6',
    hair: '#94785c',
    top: '#4f7fae',
    trim: '#3f6a94',
    style: 'receding',
    wear: 'tee',
    glasses: 'square',
    propMats: [
      { color: '#22201f', gloss: 0.4 },
      { color: '#f6f2ea', gloss: 0.3 },
      { color: '#f2a72e', gloss: 0.4 },
    ],
    // a penguin
    prop: [
      {
        at: [1.08, -0.64, 0.22],
        rot: [0, -24, 0],
        kids: [
          ell([0.26, 0.34, 0.24], [0, 0, 0], P),
          ell([0.19, 0.27, 0.12], [0, -0.03, 0.14], P + 1),
          ell([0.18, 0.17, 0.17], [0, 0.38, 0.0], P),
          { mirrorX: true, kids: [ell([0.035, 0.045, 0.02], [0.07, 0.41, 0.15], P + 1)] },
          { prim: { cone: [0.07, 0.06, 0.012], round: 0.01 }, at: [0, 0.34, 0.2], rot: [90, 0, 0], mat: P + 2 },
          { mirrorX: true, kids: [ell([0.09, 0.03, 0.12], [0.1, -0.33, 0.08], P + 2)] },
          { mirrorX: true, kids: [ell([0.05, 0.2, 0.08], [0.25, -0.02, 0.0], P, [0, 0, 18])] },
        ],
      },
    ],
  },
  karpathy: {
    skin: '#eec39f',
    hair: '#2b2522',
    top: '#3b4a5c',
    trim: '#2e3a48',
    style: 'swept',
    wear: 'hoodie',
    propMats: [{ color: '#e9e4da', gloss: 0.5 }],
    worn: headphones(P),
  },
  hotz: {
    skin: '#efc39d',
    hair: '#3a2b22',
    top: '#262427',
    trim: '#e9e4da',
    style: 'messy',
    wear: 'hoodie',
    propMats: [{ color: '#d23b3b', gloss: 0.5 }],
    worn: headphones(P, true),
  },
  woz: {
    skin: '#efc19c',
    hair: '#7d7064',
    top: '#3e5e8c',
    trim: '#324d74',
    style: 'wild',
    wear: 'shirt',
    beard: 'full',
    glasses: 'square',
    propMats: [{ color: '#2f7a4a', gloss: 0.4 }, { color: '#222222', gloss: 0.6 }, { color: '#c8a75a', gloss: 0.8, metal: 0.9 }],
    // a hand-built board
    prop: [
      {
        at: [1.12, -0.68, 0.0],
        rot: [-12, -26, 0],
        kids: [
          box([0.36, 0.3, 0.018], [0, 0, 0], 0.01, P),
          ...[-0.15, 0.15].flatMap((x) => [0.13, -0.08].map((y): Node => box([0.1, 0.05, 0.02], [x, y, 0.03], 0.01, P + 1))),
          // the edge connector: one strip, ridged into pins
          { at: [0, -0.27, 0.02], rot: [0, 0, 90], kids: [{ prim: { box: [0.025, 0.28, 0.01], round: 0.004 }, mat: P + 2, ridge: [0.006, 90] }] },
        ],
      },
    ],
  },
  gates: {
    skin: '#f0c7a4',
    hair: '#9c8770',
    top: '#7d93b3',
    trim: '#f4f0e8',
    style: 'short',
    wear: 'sweater',
    glasses: 'big',
    propMats: [{ color: '#2b2a2e', gloss: 0.5 }, { color: '#c9c7c2', gloss: 0.85, metal: 0.9 }, { color: '#efe9dc', gloss: 0.2 }],
    // a floppy disk
    prop: [
      {
        at: [1.1, -0.62, 0.25],
        rot: [0, -32, 8],
        kids: [box([0.3, 0.31, 0.025], [0, 0, 0], 0.02, P), box([0.15, 0.1, 0.03], [0.02, 0.2, 0], 0.01, P + 1), box([0.22, 0.13, 0.03], [0, -0.13, 0], 0.01, P + 2)],
      },
    ],
  },
  huang: {
    skin: '#ebc29b',
    hair: '#8e8b88',
    top: '#1c1b1d',
    trim: '#2a292c',
    style: 'swept',
    wear: 'jacket',
    propMats: [{ color: '#2a2a2d', gloss: 0.6 }, { color: '#b8b8bc', gloss: 0.8, metal: 0.9 }, { color: '#55c46a', gloss: 0.6, emit: 0.4 }],
    // a graphics card
    prop: [
      {
        at: [1.12, -0.72, 0.1],
        rot: [0, -60, 0],
        kids: [
          box([0.46, 0.14, 0.08], [0, 0, 0], 0.03, P),
          ...[-0.2, 0.2].map((x): Node => ({ at: [x, 0, 0.08], rot: [90, 0, 0], kids: [{ prim: { cyl: [0.11, 0.012], round: 0.008 }, mat: P + 1, ridge: [0.006, 50] }] })),
          box([0.4, 0.01, 0.06], [0, 0.145, 0], 0.005, P + 2),
        ],
      },
    ],
  },
  musk: {
    skin: '#efc3a0',
    hair: '#4a3a2e',
    top: '#1f1f22',
    trim: '#2c2c30',
    style: 'swept',
    wear: 'tee',
    propMats: [{ color: '#f1efea', gloss: 0.7 }, { color: '#2a2a2e', gloss: 0.6 }, { color: '#cfcac0', gloss: 0.8, metal: 0.8 }],
    // a rocket
    prop: [
      {
        at: [1.12, -0.15, 0.1],
        kids: [
          { prim: { cyl: [0.12, 0.62], round: 0.04 }, at: [0, 0, 0], mat: P },
          { prim: { cone: [0.18, 0.12, 0.01], round: 0.02 }, at: [0, 0.8, 0], mat: P },
          { prim: { cyl: [0.122, 0.04] }, at: [0, 0.45, 0], mat: P + 1 },
          ...[0, 120, 240].map((a): Node => ({ rot: [0, a, 0], kids: [{ prim: { poly: [[0, 0], [0.16, -0.12], [0.16, -0.3], [0, -0.22]], depth: 0.012, round: 0.008 }, at: [0.1, -0.42, 0], mat: P + 1 }] })),
          { prim: { cone: [0.06, 0.08, 0.11], round: 0.01 }, at: [0, -0.66, 0], mat: P + 2 },
        ],
      },
    ],
  },
  jobs: {
    skin: '#efc4a2',
    hair: '#56504c',
    top: '#1b1a1c',
    style: 'receding',
    wear: 'turtleneck',
    glasses: 'round',
    frame: '#c9c4bb',
  },
  bezos: {
    skin: '#efc0a0',
    hair: '#5a4a3c',
    top: '#8fb2d6',
    trim: '#f4f0e8',
    style: 'bald',
    wear: 'shirt',
    shine: 0.6,
    propMats: [{ color: '#c99a62', gloss: 0.15 }, { color: '#d9b27c', gloss: 0.35 }],
    // a shipping box
    prop: [
      {
        at: [1.12, -0.7, 0.18],
        rot: [0, -28, 0],
        kids: [box([0.3, 0.3, 0.3], [0, 0, 0], 0.02, P), box([0.07, 0.006, 0.305], [0, 0.3, 0], 0.003, P + 1), box([0.07, 0.3, 0.006], [0, 0, 0.3], 0.003, P + 1)],
      },
    ],
  },
  zuckerberg: {
    skin: '#f1c9a8',
    hair: '#6b4f3a',
    top: '#8d8f93',
    trim: '#7b7d81',
    style: 'curly',
    wear: 'hoodie',
  },
  chesky: {
    skin: '#eec29e',
    hair: '#3a2c24',
    top: '#2a2a2c',
    trim: '#3a3a3d',
    style: 'short',
    wear: 'tee',
    propMats: [{ color: '#f6f2ea', gloss: 0.2 }, { color: '#9a7350', gloss: 0.3 }, { color: '#e4532a', gloss: 0.4 }, { color: '#cfc7b8', gloss: 0.1 }],
    // a storyboard on an easel
    prop: [
      {
        at: [1.12, -0.42, 0.0],
        rot: [-8, -28, 0],
        kids: [
          cap([-0.22, -0.56, -0.1], [-0.12, 0.42, 0], 0.02, P + 1),
          cap([0.22, -0.56, -0.1], [0.12, 0.42, 0], 0.02, P + 1),
          box([0.3, 0.28, 0.015], [0, 0.1, 0.03], 0.01, P),
          ...[-0.16, 0, 0.16].flatMap((x) => [0.22, 0.0].map((y): Node => box([0.065, 0.075, 0.01], [x, y, 0.048], 0.006, x === 0 && y === 0 ? P + 2 : P + 3))),
        ],
      },
    ],
  },
  altman: {
    skin: '#efc6a6',
    hair: '#8a6b50',
    top: '#5d6b62',
    trim: '#5d6b62',
    style: 'messy',
    wear: 'tee',
    propMats: [{ color: '#a9845a', gloss: 0.3 }, { color: '#f6f2ea', gloss: 0.2 }, { color: '#c9c7c2', gloss: 0.85, metal: 0.9 }, { color: '#2b2a2e', gloss: 0.3 }],
    // a to-do list on paper, on a clipboard, the first two items ticked
    prop: [
      {
        at: [1.1, -0.6, 0.22],
        rot: [-14, -30, 0],
        kids: [
          box([0.21, 0.29, 0.014], [0, 0, 0], 0.02, P),
          box([0.18, 0.24, 0.006], [0, -0.03, 0.016], 0.004, P + 1),
          box([0.07, 0.03, 0.025], [0, 0.28, 0.02], 0.012, P + 2),
          ...[0.12, 0.03, -0.06, -0.15].map((y): Node => box([0.1, 0.009, 0.004], [0.04, y, 0.024], 0.003, P + 3)),
          ...[0.12, 0.03].map((y): Node => ({ at: [-0.11, y, 0.026], kids: [cap([-0.028, 0.004, 0], [-0.01, -0.016, 0], 0.008, P + 3), cap([-0.01, -0.016, 0], [0.026, 0.026, 0], 0.008, P + 3)] })),
        ],
      },
    ],
  },
  thiel: {
    skin: '#efc4a4',
    hair: '#7b5f48',
    top: '#1f2125',
    trim: '#f4f0e8',
    style: 'short',
    wear: 'jacket',
    matte: true,
    propMats: [{ color: '#f1ebdf', gloss: 0.45 }],
    // a chess knight (he's a chess Life Master)
    prop: [
      {
        at: [1.1, -0.93, 0.2],
        rot: [0, -60, 0],
        mat: P,
        kids: [
          { prim: { cyl: [0.2, 0.05], round: 0.03 }, at: [0, 0.05, 0] },
          { prim: { cone: [0.17, 0.16, 0.1], round: 0.02 }, at: [0, 0.26, 0] },
          { op: 'smooth', k: 0.06, kids: [cap([0, 0.4, -0.02], [0, 0.66, 0.02], 0.1), ell([0.09, 0.08, 0.17], [0, 0.66, 0.12], undefined, [-20, 0, 0]), ell([0.06, 0.14, 0.08], [0, 0.6, -0.1], undefined, [20, 0, 0])] },
          { mirrorX: true, kids: [{ prim: { cone: [0.05, 0.03, 0.005], round: 0.005 }, at: [0.04, 0.78, -0.02] }] },
        ],
      },
    ],
  },
  karp: {
    skin: '#e2b590',
    hair: '#9c968e',
    top: '#34353a',
    trim: '#f4f0e8',
    style: 'wild',
    wear: 'jacket',
    matte: true,
    glasses: 'round',
    frame: '#b9b6b0',
    propMats: [{ color: '#c9473a', gloss: 0.6 }, { color: '#b8b8bc', gloss: 0.8, metal: 0.9 }, { color: '#22201f', gloss: 0.4 }],
    // cross-country skis and poles, stood up together
    prop: [
      {
        at: [1.12, -1.0, 0.05],
        rot: [0, -30, 0],
        kids: [
          { mirrorX: true, kids: [{ at: [0.05, 0.62, 0], rot: [0, 0, -3], kids: [box([0.032, 0.6, 0.008], [0, 0, 0], 0.006, P), ell([0.032, 0.07, 0.03], [0, 0.6, 0.025], P, [-35, 0, 0])] }] },
          { mirrorX: true, kids: [cap([0.17, 0.02, 0.07], [0.09, 1.12, 0.03], 0.011, P + 1), cap([0.098, 1.0, 0.035], [0.092, 1.12, 0.032], 0.022, P + 2), { prim: { torus: [0.04, 0.007] }, at: [0.164, 0.11, 0.067], mat: P + 2 }] },
        ],
      },
    ],
  },
  ellison: {
    skin: '#e9b892',
    hair: '#9b958e',
    top: '#26272b',
    trim: '#141416',
    style: 'swept',
    beard: 'short',
    wear: 'jacket',
    matte: true,
    propMats: [{ color: '#f1efea', gloss: 0.7 }, { color: '#e3ddd0', gloss: 0.4 }, { color: '#2b2c30', gloss: 0.5 }, { color: '#5f8fbf', gloss: 0.6 }],
    // a racing catamaran with a wing sail, on a little sea
    prop: [
      {
        at: [1.12, -0.92, 0.15],
        rot: [0, -40, 0],
        scale: 1.2,
        kids: [
          ell([0.28, 0.035, 0.38], [0, 0, 0], P + 3),
          { mirrorX: true, kids: [ell([0.045, 0.04, 0.34], [0.15, 0.05, 0], P)] },
          box([0.16, 0.012, 0.012], [0, 0.085, 0.12], 0.006, P + 2),
          box([0.16, 0.012, 0.012], [0, 0.085, -0.14], 0.006, P + 2),
          box([0.13, 0.005, 0.12], [0, 0.085, -0.01], 0.003, P + 2),
          { prim: { poly: [[-0.11, 0], [0.09, 0], [0.04, 0.95], [0.0, 0.95]], depth: 0.012, round: 0.008 }, at: [0, 0.1, 0.0], rot: [0, 90, 0], mat: P + 1 },
          { prim: { poly: [[0, 0], [0.2, 0], [0, 0.6]], depth: 0.006, round: 0.004 }, at: [0, 0.12, 0.1], rot: [0, -90, 0], mat: P + 1 },
        ],
      },
    ],
  },
  amodei: {
    skin: '#eec6a4',
    hair: '#3b2a20',
    top: '#3d4a5c',
    trim: '#a9bfdc',
    style: 'curly',
    wear: 'sweater',
    glasses: 'round',
    propMats: [{ color: '#f6f2ea', gloss: 0.2 }, { color: '#e6dfd0', gloss: 0.2 }, { color: '#3a3d43', gloss: 0.3 }, { color: '#c9c7c2', gloss: 0.85, metal: 0.9 }],
    // a stapled four-page memo, fanned, propped up to face you
    prop: [
      {
        at: [1.12, -0.6, 0.24],
        rot: [-50, -30, 0],
        scale: 1.3,
        kids: [
          ...[-7, -3, 1].map((a, i): Node => box([0.17, 0.22, 0.004], [0.01 * (2 - i), 0, -0.012 * (3 - i)], 0.004, P + 1, [0, 0, a])),
          { rot: [0, 0, 4], kids: [
            box([0.17, 0.22, 0.004], [0, 0, 0], 0.004, P),
            box([0.08, 0.012, 0.003], [-0.05, 0.16, 0.005], 0.004, P + 2),
            ...[0.1, 0.06, 0.02, -0.02, -0.06, -0.1, -0.14].map((y, i): Node => box([i === 6 ? 0.07 : 0.12, 0.006, 0.002], [i === 6 ? -0.06 : -0.01, y, 0.005], 0.003, P + 2)),
            cap([-0.15, 0.17, 0.008], [-0.12, 0.2, 0.008], 0.007, P + 3),
          ] },
        ],
      },
    ],
  },
}

export const FIGURES: Record<string, () => Scene> = Object.fromEntries(Object.entries(LOOKS).map(([k, look]) => [k, () => bust(look)]))
