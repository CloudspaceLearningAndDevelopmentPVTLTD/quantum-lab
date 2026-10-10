/**
 * qsphereScene.ts — the WebGL renderer behind components/circuit/QSphere.tsx.
 *
 * Same progressive-enhancement shape as components/ui/heroQubitScene.ts: a
 * dynamic import mounted after first paint, so three.js is never in the
 * simulator route's First Load JS, and the existing flat SVG (orthographic,
 * `rotateProject` in lib/qsphere-layout.ts) stays as the instant-paint
 * fallback and the no-WebGL floor. This module owns pixels only — node
 * positions, magnitudes and phases come from lib/qsphere-layout.ts every
 * frame, exactly what the SVG renderer already draws, so the two pictures
 * never disagree.
 *
 * Coordinates: QSphereNode is already unit-sphere with z as the pole axis
 * (+1 = |0...0⟩, matching Bloch conventions elsewhere in this app). three.js
 * is y-up, so the mapping is the same one heroQubitScene.ts and
 * components/viz/BlochSphere.tsx use: (x, y, z)_node → (x, z, y)_three.
 */

import * as THREE from 'three'
import type { QSphereNode } from '@/lib/qsphere-layout'

export interface QSphereColors {
  violet: string
  ink: string
  inkMuted: string
  line: string
}

export interface QSphereFrame {
  nodes: readonly QSphereNode[]
  yaw: number
  pitch: number
}

export interface QSphereSceneHandle {
  render(frame: QSphereFrame): void
  resize(px: number): void
  dispose(): void
}

const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y)

/**
 * Resolve a CSS colour string — including `oklch(...)`, which THREE.Color
 * cannot parse directly — to a THREE.Color via a 1×1 canvas readback. The
 * browser's own CSS Color 4 parser does the work; this just borrows it.
 * Cheap enough to call once per node per state change (not per frame: the
 * caller only rebuilds node meshes when the statevector actually changes).
 */
let swatch: CanvasRenderingContext2D | null = null
function cssColor(css: string): THREE.Color {
  if (!swatch) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    swatch = c.getContext('2d', { willReadFrequently: true })
  }
  if (!swatch) return new THREE.Color(0xffffff)
  swatch.clearRect(0, 0, 1, 1)
  swatch.fillStyle = css
  swatch.fillRect(0, 0, 1, 1)
  const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data
  return new THREE.Color(r / 255, g / 255, b / 255)
}

const MAX_NODE_R = 0.16
const EPS = 1e-9

export function mountQSphereScene(canvas: HTMLCanvasElement, colors: QSphereColors): QSphereSceneHandle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  const CAM_DIST = 4.6

  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.3)
  key.position.set(2.5, 3.5, 3)
  scene.add(key)
  const spec = new THREE.PointLight(0xffffff, 5, 12, 2)
  scene.add(spec)

  // ── Sphere shell: a faint glass ball so the nodes read as ON a sphere
  // rather than floating dots in space. Fainter than the hero's — this
  // widget's subject is the 20-odd data points, not the sphere itself.
  const violet = new THREE.Color(colors.violet)
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 36),
    new THREE.MeshPhysicalMaterial({
      color: violet,
      transparent: true,
      opacity: 0.06,
      roughness: 0.25,
      clearcoat: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  scene.add(shell)

  const lineColor = new THREE.Color(colors.ink)
  const equator = (() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2
      pts.push(toThree(Math.cos(t), Math.sin(t), 0))
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.18 }))
  })()
  scene.add(equator)

  // ── Node layer: rebuilt only when the node list changes (state changed —
  // a new gate ran), never per animation frame. Each node is a small emissive
  // sphere plus a thin ray from the centre, both tinted by phaseColor().
  const nodeGroup = new THREE.Group()
  scene.add(nodeGroup)
  let nodeMeshes: { sphere: THREE.Mesh; ray: THREE.Line }[] = []
  let currentKey = ''

  function rebuildNodes(nodes: readonly QSphereNode[]) {
    for (const { sphere, ray } of nodeMeshes) {
      sphere.geometry.dispose()
      ;(sphere.material as THREE.Material).dispose()
      ray.geometry.dispose()
      ;(ray.material as THREE.Material).dispose()
    }
    nodeGroup.clear()
    nodeMeshes = []

    for (const n of nodes) {
      const pos = toThree(n.x, n.y, n.z)
      if (n.magnitude < EPS) {
        // Empty basis state: a bare pinprick, same treatment as the SVG.
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.012, 8, 6),
          new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, opacity: 0.35 }),
        )
        dot.position.copy(pos)
        nodeGroup.add(dot)
        continue
      }
      const color = cssColor(`oklch(0.7 0.15 ${(((n.phase / (2 * Math.PI)) * 360 + 250) % 360 + 360) % 360})`)
      const r = Math.max(0.02, MAX_NODE_R * n.magnitude)
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 16),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.35 }),
      )
      sphere.position.copy(pos)
      const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos])
      const ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }))
      nodeGroup.add(sphere, ray)
      nodeMeshes.push({ sphere, ray })
    }
  }

  let sizePx = 1

  const render = (frame: QSphereFrame) => {
    const nodeKey = frame.nodes.map((n) => `${n.index}:${n.magnitude.toFixed(4)}:${n.phase.toFixed(4)}`).join('|')
    if (nodeKey !== currentKey) {
      currentKey = nodeKey
      rebuildNodes(frame.nodes)
    }

    // Same spherical camera orbit as heroQubitScene, driven by the SAME
    // yaw/pitch state QSphere.tsx already keeps for the SVG drag — dragging
    // feels identical whichever renderer is under the pointer.
    const { yaw, pitch } = frame
    camera.position.set(
      CAM_DIST * Math.cos(pitch) * Math.sin(-yaw),
      CAM_DIST * Math.sin(pitch),
      CAM_DIST * Math.cos(pitch) * Math.cos(-yaw),
    )
    camera.lookAt(0, 0, 0)
    spec.position.copy(camera.position).multiplyScalar(0.7).add(new THREE.Vector3(0.6, 1, 0))

    renderer.render(scene, camera)
  }

  const resize = (px: number) => {
    sizePx = Math.max(1, px)
    renderer.setSize(sizePx, sizePx, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
  }

  const dispose = () => {
    rebuildNodes([])
    shell.geometry.dispose()
    ;(shell.material as THREE.Material).dispose()
    equator.geometry.dispose()
    ;(equator.material as THREE.Material).dispose()
    renderer.dispose()
  }

  return { render, resize, dispose }
}
