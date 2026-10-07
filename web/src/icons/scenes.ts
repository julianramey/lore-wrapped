// The lore deck, as objects. Each card is one small dev-world thing, modeled from rounded
// primitives and lit like a studio render.

import type { Node, Scene, V3 } from './sdf.ts'

const cap = (a: V3, b: V3, r: number, mat?: number): Node => ({ prim: { capsule: [a, b, r] }, mat })

function editor(): Scene {
  // a code page with one struck line, and the red pencil that struck it
  const lines: [number, number, number][] = [
    // [indent, half length, z]
    [0, 0.42, -0.66],
    [0.16, 0.3, -0.42],
    [0.16, 0.46, -0.18],
    [0.32, 0.26, 0.06],
    [0.16, 0.34, 0.3],
    [0, 0.2, 0.54],
  ]
  return {
    mats: [
      { color: '#f4f0e7', gloss: 0.15 },
      { color: '#cfc7b8', gloss: 0.1 },
      { color: '#e4532a', gloss: 0.55 },
      { color: '#efcc9c', gloss: 0.2 },
      { color: '#2a2724', gloss: 0.6 },
      { color: '#cbc4b5', gloss: 0.85, metal: 0.9 },
      { color: '#f39f92', gloss: 0.2 },
    ],
    root: {
      kids: [
        {
          rot: [0, -16, 0],
          kids: [
            { prim: { box: [0.82, 0.035, 1.02], round: 0.03 }, at: [0, -0.965, 0], mat: 0 },
            ...lines.map(([ind, w, z]): Node => ({ prim: { box: [w, 0.014, 0.042], round: 0.014 }, at: [-0.6 + ind + w, -0.92, z], mat: 1 })),
            { prim: { box: [0.56, 0.02, 0.026], round: 0.018 }, at: [-0.6 + 0.16 + 0.46, -0.9, -0.18], rot: [0, 4, 0], mat: 2 },
          ],
        },
        {
          // pencil along local Y, tip at the bottom
          at: [0.32, -0.3, 0.12],
          rot: [18, 28, -40],
          kids: [
            { prim: { cyl: [0.12, 0.1], round: 0.05 }, at: [0, 0.9, 0], mat: 6 },
            { prim: { cyl: [0.128, 0.09], round: 0.02 }, at: [0, 0.73, 0], mat: 5, ridge: [0.006, 90] },
            { prim: { cyl: [0.12, 0.6], round: 0.02 }, at: [0, 0.03, 0], mat: 2 },
            { prim: { cone: [0.15, 0.035, 0.12], round: 0.01 }, at: [0, -0.71, 0], mat: 3 },
            { prim: { cone: [0.05, 0.006, 0.04], round: 0.005 }, at: [0, -0.89, 0], mat: 4 },
          ],
        },
      ],
    },
  }
}

function delegator(): Scene {
  // a paper plane, already on its way
  const wing: Node = { prim: { poly: [[0, 1.1], [0.95, -0.72], [0.1, -0.48]], depth: 0.014, round: 0.008 }, rot: [90, 0, 0] }
  return {
    mats: [
      { color: '#6cc792', gloss: 0.3 },
      { color: '#2a8a55', gloss: 0.3 },
      { color: '#2a8a55', gloss: 0.4 },
    ],
    cam: { pitch: 18 },
    root: {
      kids: [
        {
          at: [0.12, 0.12, 0],
          rot: [-24, 116, -26],
          scale: 1.15,
          kids: [
            { mirrorX: true, kids: [{ rot: [0, 0, 10], kids: [wing] }], mat: 0 },
            { prim: { poly: [[-1.08, 0], [0.5, -0.36], [0.56, 0]], depth: 0.012, round: 0.006 }, rot: [0, 90, 0], mat: 1 },
          ],
        },
        // the dotted trail back to you
        { prim: { sphere: 0.07 }, at: [-0.78, -0.42, 0.34], mat: 2 },
        { prim: { sphere: 0.055 }, at: [-1.05, -0.6, 0.48], mat: 2 },
        { prim: { sphere: 0.04 }, at: [-1.28, -0.76, 0.6], mat: 2 },
      ],
    },
  }
}

function architect(): Scene {
  // a blueprint roll, the plan unrolled, a set square
  const plan: Node[] = [
    [0, 0.22, 0.58, 0.014],
    [0, -0.42, 0.58, 0.014],
    [-0.58, -0.1, 0.014, 0.32],
    [0.58, -0.1, 0.014, 0.32],
    [0.05, -0.1, 0.014, 0.32],
    [0.32, -0.1, 0.26, 0.014],
  ].map(([x, z, w, d]): Node => ({ prim: { box: [w, 0.01, d], round: 0.008 }, at: [x, -0.955, z + 0.25], mat: 0 }))
  return {
    mats: [
      { color: '#2f5fb3', gloss: 0.35 },
      { color: '#e7eef9', gloss: 0.1 },
      { color: '#d3dff4', gloss: 0.2 },
      { color: '#f2b33d', gloss: 0.6 },
    ],
    root: {
      kids: [
        {
          rot: [0, -12, 0],
          kids: [
            { prim: { box: [0.82, 0.02, 0.58], round: 0.015 }, at: [0, -0.98, 0.15], mat: 1 },
            ...plan,
            { prim: { cyl: [0.27, 0.92], round: 0.03 }, rot: [0, 0, 90], at: [0, -0.73, -0.5], mat: 0 },
            { mirrorX: true, kids: [{ prim: { torus: [0.16, 0.035] }, rot: [0, 0, 90], at: [0.93, -0.73, -0.5], mat: 2 }] },
          ],
        },
        {
          op: 'sub',
          at: [0.38, -0.18, -0.72],
          rot: [-10, -30, 0],
          mat: 3,
          kids: [
            { prim: { poly: [[-0.7, -0.62], [0.72, -0.62], [-0.7, 0.88]], depth: 0.04, round: 0.03 } },
            { prim: { poly: [[-0.5, -0.44], [0.24, -0.44], [-0.5, 0.33]], depth: 0.2 } },
          ],
        },
      ],
    },
  }
}

function sniper(): Scene {
  // a target with a dart dead center
  const rings: Node[] = [
    [1, 0.07, 1],
    [0.8, 0.09, 0],
    [0.6, 0.11, 1],
    [0.4, 0.13, 0],
    [0.2, 0.15, 1],
  ].map(([r, h, m]) => ({ prim: { cyl: [r, h], round: 0.035 }, mat: m }))
  const fin: Node = { prim: { poly: [[0, 0.5], [0.2, 0.74], [0.18, 0.86], [0, 0.82]], depth: 0.01, round: 0.006 } }
  return {
    mats: [
      { color: '#fbf8f2', gloss: 0.35 },
      { color: '#e0531f', gloss: 0.45 },
      { color: '#f2b33d', gloss: 0.5 },
      { color: '#cfcac0', gloss: 0.85, metal: 0.9 },
      { color: '#c9a37a', gloss: 0.2 },
      { color: '#2a2724', gloss: 0.5 },
    ],
    cam: { yaw: 18 },
    root: {
      kids: [
        {
          at: [0, 0.05, 0],
          rot: [78, -14, 0],
          kids: [
            ...rings,
            {
              // the dart, along its own +Y, tip in the bullseye
              at: [0, 0.12, 0],
              rot: [-28, 0, -32],
              kids: [
                { prim: { cone: [0.07, 0.004, 0.022], round: 0.003 }, at: [0, 0.07, 0], mat: 3 },
                { prim: { cyl: [0.055, 0.15], round: 0.03 }, at: [0, 0.27, 0], mat: 5, ridge: [0.005, 70] },
                { prim: { cyl: [0.022, 0.16], round: 0.01 }, at: [0, 0.55, 0], mat: 3 },
                { mirrorX: true, kids: [fin], at: [0, 0.08, 0], mat: 2 },
                { mirrorX: true, kids: [fin], at: [0, 0.08, 0], rot: [0, 90, 0], mat: 2 },
              ],
            },
          ],
        },
        { mirrorX: true, kids: [cap([0.45, -0.55, -0.32], [0.62, -0.98, -0.68], 0.05, 4)] },
      ],
    },
  }
}

function star(r: number, inner: number): [number, number][] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? inner : r
    return [Math.cos(a) * rr, Math.sin(a) * rr]
  })
}

/** A crescent outline: the outer circle minus an offset inner one. */
function crescent(R: number, r: number, cx: number, cy: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2
    const x = Math.cos(a) * R, y = Math.sin(a) * R
    if (Math.hypot(x - cx, y - cy) > r) out.push([x, y])
  }
  // rotate the outer arc so it starts right after the cut
  const gap = out.findIndex((p, i) => i > 0 && Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > R * 0.2)
  const outer = gap > 0 ? [...out.slice(gap), ...out.slice(0, gap)] : out
  const inner: [number, number][] = []
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
    if (Math.hypot(x, y) < R) inner.push([x, y])
  }
  const ig = inner.findIndex((p, i) => i > 0 && Math.hypot(p[0] - inner[i - 1][0], p[1] - inner[i - 1][1]) > r * 0.2)
  const innerArc = ig > 0 ? [...inner.slice(ig), ...inner.slice(0, ig)] : inner
  return [...outer, ...innerArc.reverse()]
}

function night(): Scene {
  // a crescent moon and its stars
  return {
    mats: [
      { color: '#f6e6a4', gloss: 0.3, emit: 0.05 },
      { color: '#a3b2ff', gloss: 0.55, emit: 0.22 },
    ],
    ground: null,
    root: {
      kids: [
        { prim: { poly: crescent(1, 0.84, 0.46, 0.3), depth: 0.24, round: 0.17 }, at: [-0.12, -0.02, 0], rot: [0, -18, -8], mat: 0 },
        { prim: { poly: star(0.26, 0.12), depth: 0.07, round: 0.035 }, at: [0.86, 0.66, 0.2], rot: [0, -24, 14], mat: 1 },
        { prim: { poly: star(0.16, 0.075), depth: 0.05, round: 0.025 }, at: [1.02, -0.36, 0.36], rot: [0, -30, -10], mat: 1 },
        { prim: { poly: star(0.11, 0.05), depth: 0.04, round: 0.02 }, at: [-1.05, 0.82, -0.2], rot: [0, -10, 20], mat: 1 },
      ],
    },
  }
}

function day(): Scene {
  // a twin-bell alarm clock at ten past ten
  const hand = (deg: number, len: number, w: number, mat: number): Node => ({
    at: [0, 0, 0.33],
    rot: [0, 0, deg],
    kids: [{ prim: { box: [w, len, 0.012], round: 0.012 }, at: [0, len - 0.04, 0], mat }],
  })
  return {
    mats: [
      { color: '#f2a91c', gloss: 0.65 },
      { color: '#fdf9ef', gloss: 0.2 },
      { color: '#2a2214', gloss: 0.4 },
      { color: '#e8c35c', gloss: 0.85, metal: 0.8 },
      { color: '#e0531f', gloss: 0.5 },
    ],
    root: {
      at: [0, -0.06, 0],
      rot: [0, -20, 0],
      kids: [
        { prim: { cyl: [0.8, 0.3], round: 0.13 }, rot: [90, 0, 0], mat: 0 },
        { prim: { torus: [0.69, 0.06] }, rot: [90, 0, 0], at: [0, 0, 0.27], mat: 0 },
        { prim: { cyl: [0.66, 0.02] }, rot: [90, 0, 0], at: [0, 0, 0.27], mat: 1 },
        ...[0, 90, 180, 270].map((d): Node => ({ rot: [0, 0, d], kids: [{ prim: { box: [0.024, 0.065, 0.012], round: 0.012 }, at: [0, 0.52, 0.3], mat: 2 }] })),
        hand(58, 0.22, 0.034, 2),
        hand(-62, 0.34, 0.026, 2),
        { prim: { sphere: 0.055 }, at: [0, 0, 0.34], mat: 4 },
        {
          mirrorX: true,
          kids: [
            {
              at: [0.5, 0.74, -0.04],
              rot: [0, 0, -36],
              mat: 3,
              kids: [
                { op: 'inter', kids: [{ prim: { sphere: 0.3 } }, { prim: { box: [0.4, 0.2, 0.4] }, at: [0, 0.2, 0] }] },
                { prim: { sphere: 0.06 }, at: [0, 0.32, 0] },
              ],
            },
            cap([0.42, -0.6, 0], [0.6, -0.96, 0.06], 0.07, 3),
          ],
        },
        cap([0, 0.82, -0.04], [0, 1.0, -0.04], 0.04, 3),
      ],
    },
  }
}

function conductor(): Scene {
  // three terminals in a fan, and the baton
  const win = (at: V3, rot: V3, body: number, bar: number, front = false): Node => ({
    at,
    rot,
    kids: [
      { prim: { box: [0.72, 0.5, 0.045], round: 0.06 }, mat: body },
      { prim: { box: [0.7, 0.075, 0.048], round: 0.045 }, at: [0, 0.42, 0.004], mat: bar },
      ...[5, 6, 7].map((m, i): Node => ({ prim: { sphere: 0.03 }, at: [-0.6 + i * 0.085, 0.42, 0.05], mat: front ? m : bar })),
      ...(front
        ? ([
            { prim: { poly: [[-0.55, 0.13], [-0.37, 0.01], [-0.55, -0.11], [-0.55, -0.05], [-0.45, 0.01], [-0.55, 0.07]] as [number, number][], depth: 0.016, round: 0.006 }, at: [0, 0, 0.05], mat: 4 },
            { prim: { box: [0.05, 0.075, 0.016], round: 0.01 }, at: [-0.24, 0.01, 0.05], mat: 4 },
            { prim: { box: [0.26, 0.022, 0.012], round: 0.01 }, at: [-0.28, -0.24, 0.05], mat: 8 },
          ] as Node[])
        : []),
    ],
  })
  return {
    mats: [
      { color: '#ddd5f4', gloss: 0.4 },
      { color: '#a891f2', gloss: 0.45 },
      { color: '#1c1530', gloss: 0.6 },
      { color: '#6a3fd6', gloss: 0.5 },
      { color: '#7df0a8', gloss: 0.2, emit: 0.9 },
      { color: '#ff6b5e', gloss: 0.5 },
      { color: '#ffc93c', gloss: 0.5 },
      { color: '#3fd17a', gloss: 0.5 },
      { color: '#6d5a95', gloss: 0.3 },
      { color: '#f7f5ef', gloss: 0.55 },
      { color: '#c99c6b', gloss: 0.2 },
    ],
    root: {
      kids: [
        win([-0.42, 0.42, -0.62], [0, 10, 9], 0, 1),
        win([-0.12, 0.12, -0.2], [0, 5, 4], 1, 3),
        win([0.2, -0.2, 0.28], [0, -6, -3], 2, 3, true),
        cap([-0.98, -0.9, 0.78], [0.42, -0.42, 1.0], 0.024, 9),
        cap([-1.0, -0.91, 0.78], [-0.78, -0.83, 0.81], 0.065, 10),
      ],
    },
  }
}

function loyalist(): Scene {
  // one ring
  return {
    mats: [
      { color: '#ebb64e', gloss: 0.88, metal: 0.85 },
      { color: '#d83a46', gloss: 0.95, emit: 0.06 },
    ],
    root: {
      at: [0, -0.26, 0],
      rot: [0, -28, 0],
      kids: [
        { prim: { torus: [0.62, 0.11] }, rot: [90, 0, 0], mat: 0 },
        { prim: { cone: [0.08, 0.1, 0.2], round: 0.02 }, at: [0, 0.76, 0], mat: 0 },
        ...[45, 135, 225, 315].map((d): Node => ({ rot: [0, d, 0], kids: [cap([0.15, 0.78, 0], [0.19, 0.98, 0], 0.025, 0)] })),
        {
          op: 'inter',
          at: [0, 0.98, 0],
          rot: [0, 22, 0],
          mat: 1,
          kids: [{ prim: { octa: 0.34 }, scale: 1 }, { prim: { box: [0.5, 0.16, 0.5] }, at: [0, -0.04, 0] }],
        },
      ],
    },
  }
}

function marathoner(): Scene {
  // a spool of thread, still unwinding
  const path: V3[] = [
    [0.4, -0.5, 0.36],
    [0.62, -0.82, 0.5],
    [0.92, -0.965, 0.46],
    [1.18, -0.965, 0.2],
    [1.12, -0.965, -0.08],
  ]
  return {
    mats: [
      { color: '#e3bd8d', gloss: 0.25 },
      { color: '#14968e', gloss: 0.35 },
      { color: '#d7d3cb', gloss: 0.9, metal: 0.9 },
    ],
    root: {
      kids: [
        {
          at: [-0.1, -0.36, 0],
          kids: [
            { mirrorX: false, prim: { cyl: [0.64, 0.07], round: 0.035 }, at: [0, 0.57, 0], mat: 0 },
            { prim: { cyl: [0.64, 0.07], round: 0.035 }, at: [0, -0.57, 0], mat: 0 },
            { prim: { cyl: [0.27, 0.52] }, mat: 0 },
            { prim: { cyl: [0.53, 0.5], round: 0.04 }, mat: 1, ridge: [0.008, 64] },
          ],
        },
        { op: 'smooth', k: 0.03, mat: 1, kids: path.slice(1).map((p, i) => cap(path[i], p, 0.026)) },
        cap([-0.22, -0.02, 0.48], [-0.62, 0.52, 0.2], 0.018, 2),
      ],
    },
  }
}

function sprinter(): Scene {
  // a lightning bolt
  const bolt: [number, number][] = [
    [0.04, 1.02],
    [0.44, 1.02],
    [0.12, 0.2],
    [0.44, 0.2],
    [-0.28, -1.06],
    [-0.06, -0.12],
    [-0.38, -0.12],
  ]
  return {
    mats: [
      { color: '#e8418b', gloss: 0.65 },
      { color: '#f6bfd6', gloss: 0.3 },
    ],
    ground: -1.15,
    root: {
      kids: [
        { prim: { poly: bolt, depth: 0.17, round: 0.07 }, at: [0.06, 0, 0], rot: [6, -26, -6], mat: 0 },
        cap([-0.62, 0.52, -0.3], [-1.12, 0.52, -0.3], 0.045, 1),
        cap([-0.78, 0.18, -0.2], [-1.3, 0.18, -0.2], 0.045, 1),
        cap([-0.66, -0.16, -0.1], [-1.02, -0.16, -0.1], 0.045, 1),
      ],
    },
  }
}

function volcano(): Scene {
  // the volcano, mid-sentence
  // the cone's surface radius at height y, so flows sit on it
  const surf = (y: number) => 0.34 + ((0.1 - y) / 1.12) * 0.74
  const flow = (a: number, len: number): Node => {
    const d = [Math.sin(a), Math.cos(a)]
    const at = (y: number, r: number): V3 => [d[0] * (surf(y) + r * 0.4), y, d[1] * (surf(y) + r * 0.4)]
    const y1 = 0.06 - len
    const mid = 0.06 - len * 0.55
    return {
      op: 'smooth',
      k: 0.06,
      kids: [cap(at(0.06, 0.07), at(mid, 0.065), 0.07), cap(at(mid, 0.065), at(y1, 0.055), 0.058), { prim: { sphere: 0.075 }, at: at(y1, 0.07) }],
    }
  }
  return {
    mats: [
      { color: '#6a4c40', gloss: 0.15 },
      { color: '#4a362e', gloss: 0.1 },
      { color: '#ff5b1f', gloss: 0.5, emit: 1.0 },
      { color: '#c4b8b0', gloss: 0.05 },
      { color: '#ffb02e', gloss: 0.4, emit: 1.3 },
    ],
    root: {
      kids: [
        {
          op: 'sub',
          kids: [
            {
              op: 'smooth',
              k: 0.18,
              kids: [
                { prim: { cone: [0.56, 1.08, 0.34], round: 0.07 }, at: [0, -0.46, 0], mat: 0 },
                { prim: { ellipsoid: [1.3, 0.16, 1.2] }, at: [0, -0.92, 0], mat: 1 },
              ],
            },
            { prim: { sphere: 0.31 }, at: [0, 0.27, 0] },
          ],
        },
        { prim: { cyl: [0.26, 0.03] }, at: [0, 0.02, 0], mat: 2 },
        { mat: 2, kids: [flow(0.35, 0.72), flow(-0.45, 0.48), flow(1.35, 0.36)] },
        {
          op: 'smooth',
          k: 0.14,
          mat: 3,
          kids: [
            { prim: { sphere: 0.24 }, at: [0, 0.6, -0.12] },
            { prim: { sphere: 0.2 }, at: [0.3, 0.7, -0.16] },
            { prim: { sphere: 0.18 }, at: [-0.26, 0.72, -0.14] },
            { prim: { sphere: 0.2 }, at: [0.08, 0.88, -0.2] },
          ],
        },
        { prim: { sphere: 0.05 }, at: [-0.34, 0.5, 0.14], mat: 4 },
        { prim: { sphere: 0.04 }, at: [0.46, 0.38, 0.22], mat: 4 },
      ],
    },
  }
}

function monk(): Scene {
  // a cairn, and something growing on it
  return {
    mats: [
      { color: '#9aa08a', gloss: 0.15 },
      { color: '#babba7', gloss: 0.15 },
      { color: '#7f8772', gloss: 0.15 },
      { color: '#cdccbb', gloss: 0.2 },
      { color: '#74a24e', gloss: 0.45 },
    ],
    root: {
      kids: [
        { prim: { ellipsoid: [0.92, 0.3, 0.7] }, at: [0, -0.71, 0], rot: [0, 10, 3], mat: 0 },
        { prim: { ellipsoid: [0.66, 0.25, 0.5] }, at: [0.05, -0.2, 0.02], rot: [0, -15, -5], mat: 1 },
        { prim: { ellipsoid: [0.47, 0.21, 0.37] }, at: [-0.03, 0.22, 0], rot: [0, 25, 6], mat: 2 },
        { prim: { ellipsoid: [0.29, 0.17, 0.25] }, at: [0.03, 0.57, 0.01], rot: [0, -8, -4], mat: 3 },
        cap([0.03, 0.7, 0], [0.05, 0.93, 0], 0.022, 4),
        { prim: { ellipsoid: [0.15, 0.028, 0.07] }, at: [0.17, 0.97, 0.01], rot: [0, -10, 28], mat: 4 },
        { prim: { ellipsoid: [0.12, 0.025, 0.06] }, at: [-0.07, 0.99, 0], rot: [0, 20, -32], mat: 4 },
      ],
    },
  }
}

function foreman(): Scene {
  // the hard hat
  return {
    mats: [
      { color: '#f6b400', gloss: 0.62 },
      { color: '#2b2b28', gloss: 0.3 },
      { color: '#f4f2ea', gloss: 0.4 },
    ],
    ground: -0.62,
    cam: { pitch: 20 },
    root: {
      rot: [0, -24, 0],
      mat: 0,
      op: 'smooth',
      k: 0.05,
      kids: [
        { op: 'inter', kids: [{ prim: { sphere: 0.8 }, at: [0, -0.55, 0] }, { prim: { box: [1, 0.5, 1] }, at: [0, -0.06, 0] }] },
        { op: 'inter', kids: [{ prim: { torus: [0.79, 0.075] }, rot: [0, 0, 90], at: [0, -0.55, 0] }, { prim: { box: [1, 0.5, 1] }, at: [0, 0.1, 0] }] },
        { prim: { ellipsoid: [1.0, 0.055, 1.1] }, at: [0, -0.57, 0.14] },
        { prim: { box: [0.16, 0.12, 0.02], round: 0.02 }, at: [0, -0.18, 0.74], rot: [-22, 0, 0], mat: 2 },
      ],
    },
  }
}

function pair(): Scene {
  // two rubber ducks, talking it through
  const duck = (body: number): Node => ({
    kids: [
      {
        op: 'smooth',
        k: 0.12,
        mat: body,
        kids: [
          { prim: { ellipsoid: [0.62, 0.42, 0.48] }, at: [0, -0.55, 0] },
          { prim: { ellipsoid: [0.22, 0.14, 0.2] }, at: [-0.52, -0.33, 0], rot: [0, 0, -38] },
          { prim: { sphere: 0.33 }, at: [0.3, 0.04, 0] },
          { prim: { ellipsoid: [0.3, 0.15, 0.08] }, at: [-0.04, -0.48, 0.42], rot: [-12, 0, -12] },
          { prim: { ellipsoid: [0.3, 0.15, 0.08] }, at: [-0.04, -0.48, -0.42], rot: [12, 0, -12] },
        ],
      },
      { prim: { ellipsoid: [0.19, 0.07, 0.14] }, at: [0.62, -0.02, 0], rot: [0, 0, -6], mat: 1 },
      { prim: { sphere: 0.048 }, at: [0.52, 0.13, 0.16], mat: 2 },
      { prim: { sphere: 0.048 }, at: [0.52, 0.13, -0.16], mat: 2 },
    ],
  })
  return {
    mats: [
      { color: '#ffd23f', gloss: 0.55 },
      { color: '#ff8a1f', gloss: 0.5 },
      { color: '#141414', gloss: 0.9 },
      { color: '#5b8ef7', gloss: 0.55 },
    ],
    root: {
      kids: [
        { ...duck(0), at: [0.42, 0, -0.25], rot: [0, 205, 0] },
        { ...duck(3), at: [-0.62, -0.28, 0.38], rot: [0, -28, 0], scale: 0.72 },
      ],
    },
  }
}

/** What each card's figure shows, for its caption. */
export const OBJECTS: Record<string, string> = {
  editor: 'the red pencil',
  delegator: 'paper plane',
  architect: 'blueprint and set square',
  sniper: 'bullseye',
  night: 'crescent',
  day: 'alarm clock, 10:10',
  conductor: 'three terminals, one baton',
  loyalist: 'the one ring',
  marathoner: 'spool of thread',
  sprinter: 'lightning',
  volcano: 'volcano',
  monk: 'cairn',
  foreman: 'hard hat',
  pair: 'rubber ducks',
}

export const SCENES: Record<string, () => Scene> = {
  editor,
  delegator,
  architect,
  sniper,
  night,
  day,
  conductor,
  loyalist,
  marathoner,
  sprinter,
  volcano,
  monk,
  foreman,
  pair,
}
