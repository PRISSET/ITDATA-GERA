<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { feature } from 'topojson-client'
import landTopology from 'world-atlas/land-110m.json'
import { chapterWeights } from '../story'

const host = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let composer: EffectComposer | null = null
let bloom: UnrealBloomPass | null = null
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let groups: THREE.Group[] = []
let swarm: THREE.Points | null = null
let stars: THREE.Points | null = null
let resizeObserver: ResizeObserver | null = null
let progress = 0
let disposed = false
let animationFrame = 0
let startedAt = 0
let environment: THREE.WebGLRenderTarget | null = null
let pulseLight: THREE.PointLight | null = null
const lightRig = new THREE.Group()
const pointer = new THREE.Vector2()
const pointerSmooth = new THREE.Vector2()
const geraPulses: THREE.Mesh[] = []
const packetRoutes: { dot: THREE.Mesh; points: THREE.Vector3[]; offset: number }[] = []

const night = 0x000000
// vertical distance between chapter scenes; the camera flies down through them
const chapterGap = 7.5
const ink = 0x2b5d80
const accent = 0x54e6ff
const data = 0xffb35c

// Camera pose per chapter: [position, target]; blended by chapter weights.
const cameraPoses: [THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(0, -0.3, 8.6), new THREE.Vector3(0, 0.25, 0)],
  [new THREE.Vector3(0, 0.35, 7.6), new THREE.Vector3(0, 0, 0)],
  [new THREE.Vector3(-0.9, 1.3, 7.0), new THREE.Vector3(0.1, 0, 0)],
  [new THREE.Vector3(1.1, -0.35, 6.3), new THREE.Vector3(0.2, 0.15, 0)],
  [new THREE.Vector3(-0.7, 0.7, 6.9), new THREE.Vector3(0, 0.1, 0)],
  [new THREE.Vector3(0.2, 1.6, 7.3), new THREE.Vector3(0.1, -0.1, 0)],
  [new THREE.Vector3(0, 0.1, 8.3), new THREE.Vector3(0, 0, 0)],
  [new THREE.Vector3(0, -0.3, 8.6), new THREE.Vector3(0, 0.25, 0)],
]

function material(color: number, opacity = 1, emissive = 0x000000) {
  const result = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.8 : 0,
    roughness: 0.4,
    metalness: 0.45,
    transparent: true,
    opacity,
  })
  result.userData.baseOpacity = opacity
  return result
}

function lineMaterial(color: number, opacity = 1) {
  const result = new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
  result.userData.baseOpacity = opacity
  return result
}

function addLine(group: THREE.Group, points: THREE.Vector3[], color = ink, opacity = 1) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(color, opacity))
  group.add(line)
  return line
}

function addDot(group: THREE.Group, position: THREE.Vector3, radius = 0.045, color = accent) {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 10), material(color, 1, color))
  dot.position.copy(position)
  group.add(dot)
}

function addPacket(group: THREE.Group, points: THREE.Vector3[], offset: number, radius = 0.045) {
  const packet = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 12), material(data, 1, data))
  packet.position.copy(points[0])
  group.add(packet)
  packetRoutes.push({ dot: packet, points, offset })
}

function addArc(group: THREE.Group, start: THREE.Vector3, control: THREE.Vector3, end: THREE.Vector3, offset: number) {
  const curve = new THREE.QuadraticBezierCurve3(start, control, end)
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.01, 5, false), material(accent, 0.75, accent)))
  addPacket(group, curve.getPoints(60), offset)
}

function glowSprite(size: number, color = '84, 230, 255', inner = 0.5) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, `rgba(${color}, 0)`)
  gradient.addColorStop(inner, `rgba(${color}, 0.05)`)
  gradient.addColorStop(inner + 0.12, `rgba(${color}, 0.4)`)
  gradient.addColorStop(1, `rgba(${color}, 0)`)
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  const result = new THREE.SpriteMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  result.userData.baseOpacity = 1
  const sprite = new THREE.Sprite(result)
  sprite.scale.setScalar(size)
  return sprite
}

function textSprite(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgba(3, 8, 18, .75)'
  context.beginPath()
  context.roundRect(8, 14, 240, 68, 34)
  context.fill()
  context.strokeStyle = '#ffb35c'
  context.lineWidth = 3
  context.stroke()
  context.fillStyle = '#ffd9a8'
  context.font = '600 40px "Space Grotesk", Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 128, 50)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const result = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  result.userData.baseOpacity = 1
  const sprite = new THREE.Sprite(result)
  sprite.scale.set(0.62, 0.23, 1)
  return sprite
}

function globePoint(latitude: number, longitude: number, radius = 1.48) {
  const lat = latitude * Math.PI / 180
  const lon = longitude * Math.PI / 180
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon),
  )
}

function buildGlobe() {
  const globe = new THREE.Group()
  const planet = new THREE.Group()
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(1.43, 64, 40), material(0x06162a, 0.97)))
  const land = feature(landTopology as any, landTopology.objects.land as any) as unknown as {
    features: { geometry: { coordinates: number[][][][] } }[]
  }
  const coastlines: number[] = []
  for (const region of land.features) {
    for (const polygon of region.geometry.coordinates) {
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const from = globePoint(ring[i - 1][1], ring[i - 1][0], 1.445)
          const to = globePoint(ring[i][1], ring[i][0], 1.445)
          if (from.distanceTo(to) > 0.55) continue
          coastlines.push(from.x, from.y, from.z, to.x, to.y, to.z)
        }
      }
    }
  }
  const coastlineGeometry = new THREE.BufferGeometry()
  coastlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coastlines, 3))
  planet.add(new THREE.LineSegments(coastlineGeometry, lineMaterial(0x7fe9ff, 0.9)))

  for (let latitude = -60; latitude <= 60; latitude += 30) {
    addLine(planet, Array.from({ length: 101 }, (_, i) => globePoint(latitude, i * 3.6)), accent, 0.12)
  }
  for (let longitude = 0; longitude < 180; longitude += 30) {
    addLine(planet, Array.from({ length: 81 }, (_, i) => globePoint(-90 + i * 2.25, longitude)), accent, 0.08)
  }

  const gera = globePoint(50.88, 12.08, 1.51)
  addDot(planet, gera, 0.06, data)
  const normal = gera.clone().normalize()
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), material(data, 0.9, data))
  pillar.position.copy(normal.clone().multiplyScalar(1.76))
  pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
  planet.add(pillar)
  for (let i = 0; i < 3; i++) {
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 48), new THREE.MeshBasicMaterial({ color: data, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    pulse.position.copy(normal.clone().multiplyScalar(1.515))
    pulse.lookAt(normal.clone().multiplyScalar(3))
    pulse.userData.pulse = i / 3
    pulse.material.userData.baseOpacity = 1
    planet.add(pulse)
    geraPulses.push(pulse)
  }
  const label = textSprite('Gera')
  label.position.copy(normal.clone().multiplyScalar(2.12))
  planet.add(label)
  const destinations = [
    globePoint(52, -45, 1.51), globePoint(10, 55, 1.51), globePoint(-28, -55, 1.51),
    globePoint(35, 105, 1.51), globePoint(64, 30, 1.51), globePoint(-5, 20, 1.51),
  ]
  for (const [index, destination] of destinations.entries()) {
    const points = Array.from({ length: 48 }, (_, i) => {
      const t = i / 47
      return gera.clone().lerp(destination, t).normalize().multiplyScalar(1.53 + Math.sin(t * Math.PI) * 0.42)
    })
    addLine(planet, points, accent, 0.85)
    addDot(planet, destination, 0.035, accent)
    addPacket(planet, points, index * 0.19, 0.05)
  }
  planet.rotation.set(0.62, -0.21, 0)
  globe.add(planet)
  const halo = glowSprite(3.9, '84, 230, 255', 0.68)
  halo.material.userData.baseOpacity = 0.55
  globe.add(halo)
  globe.userData.spin = planet
  return globe
}

function buildNetwork() {
  const network = new THREE.Group()
  const endpoints = [
    new THREE.Vector3(-1.35, 0.9, -0.25),
    new THREE.Vector3(1.35, 0.85, -0.3),
    new THREE.Vector3(-1.35, -0.9, 0),
    new THREE.Vector3(1.35, -0.9, 0),
  ]
  endpoints.forEach((point, index) => {
    const device = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.2), material(0x0f2a40))
    device.position.copy(point)
    network.add(device)
    const signal = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.023, 0.014), material(accent, 1, accent))
    signal.position.copy(point).add(new THREE.Vector3(0, 0, 0.11))
    network.add(signal)
    const halo = glowSprite(0.7, '84, 230, 255', 0.35)
    halo.position.copy(point)
    network.add(halo)
    const side = Math.sign(point.x)
    const start = new THREE.Vector3(side * 0.98, -0.03, 0.28)
    const end = point.clone().add(new THREE.Vector3(-side * 0.2, 0, 0))
    const control = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, index % 2 ? 0.25 : -0.2, 0.5))
    addArc(network, start, control, end, index * 0.23)
  })
  return network
}

function ringOf(radius: number, y: number, x = 0) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 6, 96), material(accent, 0.95, accent))
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, y, 0)
  return ring
}

function buildRack() {
  const rack = new THREE.Group()
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.13, 1.22, 0.09, 64), material(0x0a1c2e))
  platform.position.y = -1.43
  rack.add(platform)
  rack.add(ringOf(1.14, -1.37))
  rack.add(ringOf(1.45, -1.37))
  return rack
}

function buildCloud() {
  const cloud = new THREE.Group()
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.65, 0.08, 64), material(0x0a1c2e))
  floor.position.y = -1.21
  cloud.add(floor)
  cloud.add(ringOf(1.56, -1.16))
  return cloud
}

function buildTraining() {
  const training = new THREE.Group()
  ;[-1.16, 0, 1.16].forEach((x) => {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.62, 0.1, 48), material(0x0a1c2e))
    stand.position.set(x, -1.05, 0)
    training.add(stand)
    training.add(ringOf(0.57, -0.99, x))
  })
  return training
}

const cloudTops: { laptop?: THREE.Vector3; rack?: THREE.Vector3 } = {}

function connectCloud() {
  const { laptop, rack } = cloudTops
  if (!laptop || !rack) return
  // laptop -> through the cloud -> rack, and back; everything stays above the models
  addArc(groups[4], laptop, new THREE.Vector3(0.1, 2.0, 0.1), rack, 0.1)
  addArc(groups[4], rack.clone().add(new THREE.Vector3(0.05, 0, 0.12)), new THREE.Vector3(0.4, 2.2, 0.35), laptop.clone().add(new THREE.Vector3(0.1, 0, 0.1)), 0.6)
}

function mountModel(model: THREE.Group, parent: THREE.Group, position: THREE.Vector3, targetSize: number, axis: 'x' | 'y', yaw = 0) {
  const bounds = new THREE.Box3().setFromObject(model)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const fit = targetSize / Math.max(size[axis], 0.001)
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const prepare = (source: THREE.Material) => {
        const copy = source.clone()
        copy.transparent = true
        copy.userData.baseOpacity = source.opacity
        return copy
      }
      object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material)
    }
  })
  model.scale.setScalar(fit)
  model.position.copy(center).multiplyScalar(-fit)
  const mount = new THREE.Group()
  mount.add(model)
  mount.position.copy(position)
  mount.rotation.y = yaw
  mount.userData.baseY = position.y
  mount.userData.baseYaw = yaw
  mount.userData.phase = position.x * 1.6
  parent.add(mount)
  return size.multiplyScalar(fit / 2)
}

function decorateLaptop(model: THREE.Group, mode: 'files' | 'code') {
  // the laptop model is near-white and blooms; darken its body so the shape stays readable
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && 'color' in object.material) (object.material as THREE.MeshStandardMaterial).color.multiplyScalar(0.45)
  })
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 440
  const context = canvas.getContext('2d')
  if (!context) return
  context.fillStyle = '#04101e'
  context.fillRect(0, 0, 768, 440)
  context.fillStyle = '#0b2238'
  context.fillRect(0, 0, 768, 58)
  context.fillStyle = '#54e6ff'
  context.fillRect(22, 20, 18, 18)
  context.fillStyle = '#e8f4ff'
  context.font = 'bold 21px Arial'
  context.fillText(mode === 'files' ? 'DATEIEN' : 'CODE', 57, 37)
  context.fillStyle = '#3b6d8c'
  ;[94, 133, 172, 211].forEach((y, i) => context.fillRect(40, y, [120, 102, 118, 88][i], 8))
  context.fillStyle = '#12304a'
  context.fillRect(205, 75, 2, 340)
  if (mode === 'files') {
    for (let index = 0; index < 6; index++) {
      const x = 240 + (index % 3) * 160
      const y = 112 + Math.floor(index / 3) * 142
      context.fillStyle = index === 0 ? '#ffb35c' : '#54e6ff'
      context.fillRect(x + 14, y, 44, 31)
      context.fillRect(x, y + 12, 75, 49)
      context.fillStyle = '#3b6d8c'
      context.fillRect(x, y + 83, 100, 8)
    }
  } else {
    for (let index = 0; index < 10; index++) {
      const y = 92 + index * 30
      context.fillStyle = '#3b6d8c'
      context.fillRect(242, y, 18, 7)
      context.fillStyle = index % 3 === 0 ? '#ffb35c' : '#54e6ff'
      context.fillRect(274 + (index % 3) * 14, y, 70 + (index % 4) * 31, 7)
      context.fillStyle = '#1f4a66'
      context.fillRect(447, y, 86 + (index % 3) * 37, 7)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.283, 0.157), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
  screen.position.set(0, 0.119, -0.074)
  model.add(screen)
}

function loadModels() {
  const loader = new GLTFLoader()
  const assets = [
    { path: '/models/network-switch.glb', install: (model: THREE.Group) => {
      mountModel(model, groups[2], new THREE.Vector3(0, -0.03, 0.28), 1.75, 'x', -0.18)
    } },
    { path: '/models/compute-rack.glb', install: (model: THREE.Group) => {
      mountModel(model, groups[3], new THREE.Vector3(0, 0, 0), 2.7, 'y', -0.38)
    } },
    { path: '/models/laptop.glb', install: (model: THREE.Group) => {
      decorateLaptop(model, 'files')
      const half = mountModel(model, groups[4], new THREE.Vector3(-0.55, -0.49, 0.42), 1.9, 'x', -0.22)
      cloudTops.laptop = new THREE.Vector3(-0.5, -0.49 + half.y + 0.03, 0.42 - half.z * 0.8)
      connectCloud()
    } },
    { path: '/models/compute-rack.glb', install: (model: THREE.Group) => {
      const half = mountModel(model, groups[4], new THREE.Vector3(1.14, -0.08, -0.4), 1.83, 'y', -0.43)
      cloudTops.rack = new THREE.Vector3(1.14, -0.08 + half.y + 0.14, -0.4)
      connectCloud()
    } },
    { path: '/models/compute-rack.glb', install: (model: THREE.Group) => {
      mountModel(model, groups[5], new THREE.Vector3(-1.16, -0.05, 0), 1.6, 'y', -0.32)
    } },
    { path: '/models/laptop.glb', install: (model: THREE.Group) => {
      decorateLaptop(model, 'code')
      mountModel(model, groups[5], new THREE.Vector3(0, -0.33, 0), 1.05, 'x', -0.25)
    } },
    { path: '/models/network-switch.glb', install: (model: THREE.Group) => {
      mountModel(model, groups[5], new THREE.Vector3(1.16, -0.37, 0), 1.03, 'x', -0.36)
    } },
  ]
  for (const asset of assets) {
    loader.load(asset.path, ({ scene: model }) => {
      if (disposed) return
      asset.install(model)
    }, undefined, () => {
      host.value?.classList.add('model-load-error')
    })
  }
}

function buildFinal() {
  const final = new THREE.Group()
  const center = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), material(0x0b2a40, 1, 0x0a4a66))
  final.add(center)
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.56, 1)), lineMaterial(accent, 0.8))
  final.add(wire)
  final.add(glowSprite(1.8, '84, 230, 255', 0.4))
  const nodes = [
    new THREE.Vector3(-1.45, 0.8, 0.3), new THREE.Vector3(1.4, 0.75, 0.1),
    new THREE.Vector3(-1.25, -0.95, 0.4), new THREE.Vector3(1.28, -1.0, 0.1),
  ]
  nodes.forEach((point, index) => {
    const from = point.clone().normalize().multiplyScalar(0.6)
    const points = Array.from({ length: 30 }, (_, i) => from.clone().lerp(point, i / 29))
    addLine(final, points, accent, 0.6)
    addPacket(final, points, index * 0.25, 0.04)
    const object = new THREE.Mesh(new THREE.IcosahedronGeometry(index % 2 ? 0.14 : 0.11, 1), material(index % 2 ? ink : data, 1, index % 2 ? accent : data))
    object.position.copy(point)
    final.add(object)
  })
  final.userData.spin = wire
  return final
}

function buildThanks() {
  // empty on purpose: the particle word carries this scene
  return new THREE.Group()
}

// --- Particle swarm: one Points cloud that morphs through six formations ---

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8

function wordPixels(word: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 160
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff'
  context.font = '900 150px "Arial Black", "Helvetica Neue", Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(word, 320, 84)
  const { data } = context.getImageData(0, 0, 640, 160)
  const result: [number, number][] = []
  for (let y = 0; y < 160; y += 2) {
    for (let x = 0; x < 640; x += 2) {
      if (data[(y * 640 + x) * 4 + 3] > 128) result.push([(x - 320) / 640 * 6.4, (80 - y) / 160 * 1.6 + 1.25])
    }
  }
  return result.length ? result : [[0, 0]]
}
const dankePixels = wordPixels('DANKE')
const jaPixels = wordPixels('JA!')

function formation(chapter: number, out: THREE.Vector3) {
  const r = Math.random()
  if (chapter === 0) { // the word JA! for the welcome page
    const p = jaPixels[Math.floor(Math.random() * jaPixels.length)]
    return out.set(p[0] * 1.2 + gauss() * 0.012, (p[1] - 1.25) * 1.2 + 1.25 + gauss() * 0.012, gauss() * 0.16)
  }
  switch (chapter - 1) {
    case 0: { // orbital ring around the globe + atmospheric dust
      if (r < 0.2) return out.randomDirection().multiplyScalar(1.62 + Math.random() * 0.25)
      const a = Math.random() * Math.PI * 2
      const radius = 2.0 + Math.random() ** 2 * 1.1
      out.set(Math.cos(a) * radius, gauss() * 0.05, Math.sin(a) * radius)
      return out.applyEuler(new THREE.Euler(1.25, 0, 0.35))
    }
    case 1: { // constellation along network links
      const nodes = [[-1.35, 0.9, -0.25], [1.35, 0.85, -0.3], [-1.35, -0.9, 0], [1.35, -0.9, 0], [-0.98, -0.03, 0.28], [0.98, -0.03, 0.28]]
      const edges = [[4, 0], [5, 1], [4, 2], [5, 3], [0, 1], [2, 3]]
      if (r < 0.3) {
        const n = nodes[Math.floor(Math.random() * nodes.length)]
        return out.set(n[0] + gauss() * 0.2, n[1] + gauss() * 0.2, n[2] + gauss() * 0.2)
      }
      const [a, b] = edges[Math.floor(Math.random() * edges.length)]
      const t = Math.random()
      return out.set(
        nodes[a][0] + (nodes[b][0] - nodes[a][0]) * t + gauss() * 0.03,
        nodes[a][1] + (nodes[b][1] - nodes[a][1]) * t + gauss() * 0.03,
        nodes[a][2] + (nodes[b][2] - nodes[a][2]) * t + gauss() * 0.03,
      )
    }
    case 2: { // double helix around the rack
      const t = Math.random()
      const a = t * Math.PI * 7 + (r < 0.5 ? 0 : Math.PI)
      const radius = r < 0.85 ? 1.0 + gauss() * 0.04 : 1.2 + Math.random() * 0.8
      return out.set(Math.cos(a) * radius, -1.4 + t * 2.9, Math.sin(a) * radius)
    }
    case 3: { // Nextcloud above the devices
      const blobs = [[-0.45, 1.05, 0, 0.45], [0.15, 1.3, 0, 0.55], [0.75, 1.05, 0, 0.45], [0.2, 0.95, 0.25, 0.4]]
      const [x, y, z, s] = blobs[Math.floor(Math.random() * blobs.length)]
      out.randomDirection().multiplyScalar(s * (0.85 + Math.random() * 0.15))
      out.y *= 0.8
      return out.add(new THREE.Vector3(x, y, z))
    }
    case 4: { // three tilted orbits, one per profession
      const x = [-1.16, 0, 1.16][Math.floor(Math.random() * 3)]
      const a = Math.random() * Math.PI * 2
      const radius = 0.66 + gauss() * 0.025
      out.set(Math.cos(a) * radius, gauss() * 0.02, Math.sin(a) * radius)
      out.applyEuler(new THREE.Euler(0.18, 0, x * 0.1))
      return out.add(new THREE.Vector3(x, x < 0 ? 0.35 : x > 0 ? 0.12 : 0.45, 0))
    }
    case 6: { // the word DANKE, sampled from canvas pixels
      const p = dankePixels[Math.floor(Math.random() * dankePixels.length)]
      return out.set(p[0] + gauss() * 0.012, p[1] + gauss() * 0.012, gauss() * 0.14)
    }
    default: { // torus knot: everything connected
      const phi = Math.random() * Math.PI * 2
      const k = Math.cos(3 * phi) + 2.2
      return out.set(k * Math.cos(2 * phi), k * Math.sin(2 * phi), -Math.sin(3 * phi))
        .multiplyScalar(0.5)
        .add(new THREE.Vector3(gauss() * 0.05, gauss() * 0.05, gauss() * 0.05))
    }
  }
}

function buildSwarm(count: number) {
  const geometry = new THREE.BufferGeometry()
  const v = new THREE.Vector3()
  for (let shape = 0; shape < 8; shape++) {
    const array = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) formation(shape, v).toArray(array, i * 3)
    geometry.setAttribute(shape === 0 ? 'position' : `p${shape}`, new THREE.BufferAttribute(array, 3))
  }
  const seeds = new Float32Array(count * 4).map(() => Math.random())
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4))
  const shader = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      w: { value: [1, 0, 0, 0, 0, 0, 0, 0] },
      uTime: { value: 0 },
      uScatter: { value: 0 },
      uSize: { value: 26 },
      uColorA: { value: new THREE.Color(accent) },
      uColorB: { value: new THREE.Color(data) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 p1; attribute vec3 p2; attribute vec3 p3; attribute vec3 p4; attribute vec3 p5; attribute vec3 p6; attribute vec3 p7;
      attribute vec4 seed;
      uniform float w[8];
      uniform float uTime, uScatter, uSize;
      uniform vec3 uColorA, uColorB;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec3 pos = position * w[0] + p1 * w[1] + p2 * w[2] + p3 * w[3] + p4 * w[4] + p5 * w[5] + p6 * w[6] + p7 * w[7];
        float word = w[0] + w[7];
        // JA! beats like a heart, waiting for the audience
        float beat = pow(max(sin(uTime * 3.2), 0.0), 10.0);
        pos += (pos - vec3(0.0, 1.25, 0.0)) * beat * 0.09 * w[0];
        // the DANKE letters ripple like a flag
        pos.y += sin(pos.x * 1.4 - uTime * 2.2) * 0.07 * w[7];
        pos.z += cos(pos.x * 1.1 - uTime * 1.8) * 0.12 * w[7];
        vec3 dir = normalize(seed.xyz - 0.5 + 0.001);
        pos += dir * uScatter * (0.8 + seed.w * 3.2);
        pos += 0.035 * vec3(sin(uTime * 0.7 + seed.x * 40.0), cos(uTime * 0.6 + seed.y * 40.0), sin(uTime * 0.5 + seed.z * 40.0));
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.35 + seed.w * seed.w * 1.4) * (1.0 + uScatter * 0.8 + word * 0.5 + beat * w[0] * 0.6) / -mv.z;
        vAlpha = (0.55 + 0.45 * sin(uTime * 2.0 + seed.w * 60.0)) * (1.0 + word * 0.9 + beat * w[0] * 0.8);
        vColor = mix(uColorA, uColorB, step(0.9, seed.x));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a * a * vAlpha);
      }`,
  })
  const points = new THREE.Points(geometry, shader)
  points.frustumCulled = false
  return points
}

function buildStars(count: number) {
  const positions = new Float32Array(count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    v.set((Math.random() - 0.5) * 40, 12 - Math.random() * (chapterGap * 7 + 24), -4 - Math.random() * 26).toArray(positions, i * 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x8fb8d8, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false }))
}

function setOpacity(group: THREE.Group, opacity: number) {
  group.visible = opacity > 0.002
  if (!group.visible) return
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((item) => {
        item.opacity = (item.userData.baseOpacity as number ?? 1) * opacity
      })
    }
  })
}

const mobileScales = [0.5, 1, 1, 0.95, 1, 0.75, 1, 0.5]
// the thanks page is centered; every other chapter sits right of the text
const centered = [1, 0, 0, 0, 0, 0, 0, 1]
const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3
const cameraPosition = new THREE.Vector3()
const cameraTarget = new THREE.Vector3()

function render() {
  if (!composer || !scene || !camera) return
  const weights = chapterWeights(progress)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const mobile = window.matchMedia('(max-width: 760px)').matches
  const time = performance.now() * 0.001
  const intro = reducedMotion ? 1 : easeOutCubic((time - startedAt) / 2.6)
  const position = progress * (groups.length - 1)
  // 0 when resting on a chapter, 0.5 mid-transition
  const transition = 1 - Math.max(...weights)
  const offsetX = mobile ? 0 : 1.55
  const offsetY = mobile ? 1.35 : 0
  const baseScale = mobile ? 0.62 : 1

  geraPulses.forEach((pulse) => {
    const t = reducedMotion ? 0.3 : (time * 0.5 + pulse.userData.pulse) % 1
    pulse.scale.setScalar(1 + t * 4)
    ;(pulse.material as THREE.Material).userData.baseOpacity = (1 - t) * 0.9
  })
  groups.forEach((group, index) => {
    const w = weights[index]
    const away = index - position
    setOpacity(group, Math.min(1, w * 2.2) * intro)
    group.rotation.y = (centered[index] ? 0 : progress * 0.35 - 0.16) + (reducedMotion ? 0 : away * 0.9)
    group.rotation.x = 0
    group.position.set(centered[index] ? 0 : offsetX, offsetY - index * chapterGap, 0)
    group.scale.setScalar(baseScale * mobileScales[index] * (0.8 + 0.2 * w) * (0.7 + 0.3 * intro))
    if (group.userData.spin && !reducedMotion) group.userData.spin.rotation.y = index === 1 ? -0.21 + Math.sin(time * 0.25) * 0.22 + progress * 1.7 : time * 0.12
    group.traverse((object) => {
      if (object.userData.baseY !== undefined) {
        object.position.y = object.userData.baseY + (reducedMotion ? 0 : Math.sin(time * 1.1 + object.userData.phase) * 0.055)
        object.rotation.y = object.userData.baseYaw + (reducedMotion ? 0 : Math.sin(time * 0.6 + object.userData.phase) * 0.065)
      }
    })
  })

  if (swarm) {
    const uniforms = (swarm.material as THREE.ShaderMaterial).uniforms
    uniforms.w.value = weights
    uniforms.uTime.value = time
    uniforms.uScatter.value = reducedMotion ? 0 : transition * 1.6 + (1 - intro) * 4
    uniforms.uSize.value = (mobile ? 18 : 26) * renderer!.getPixelRatio()
    // the swarm travels with the camera and matches the resting chapter's transform
    const centeredWeight = weights.reduce((sum, w, i) => sum + w * centered[i], 0)
    swarm.position.set(offsetX * (1 - centeredWeight), offsetY - position * chapterGap, 0)
    swarm.scale.setScalar(baseScale * (mobile ? weights.reduce((sum, w, i) => sum + w * mobileScales[i], 0) : 1))
    swarm.rotation.y = (progress * 0.35 - 0.16) * (1 - centeredWeight)
  }

  if (!reducedMotion) {
    packetRoutes.forEach(({ dot, points, offset }) => {
      const point = ((time * 0.22 + offset) % 1) * (points.length - 1)
      const from = Math.floor(point)
      dot.position.copy(points[from]).lerp(points[Math.min(from + 1, points.length - 1)], point - from)
    })
  }

  cameraPosition.set(0, 0, 0)
  cameraTarget.set(0, 0, 0)
  weights.forEach((w, i) => {
    cameraPosition.addScaledVector(cameraPoses[i][0], w)
    cameraTarget.addScaledVector(cameraPoses[i][1], w)
  })
  if (reducedMotion) cameraPosition.set(0, 0.3, 7.6)
  pointerSmooth.lerp(pointer, 0.05)
  cameraPosition.x += pointerSmooth.x * 0.35
  cameraPosition.y += pointerSmooth.y * 0.22
  cameraPosition.z += (1 - intro) * 5
  cameraPosition.y -= position * chapterGap
  cameraTarget.y -= position * chapterGap
  lightRig.position.y = -position * chapterGap
  camera.position.copy(cameraPosition)
  camera.fov = 40 + (reducedMotion ? 0 : transition * 16)
  camera.updateProjectionMatrix()
  camera.lookAt(cameraTarget)

  if (bloom) bloom.strength = 0.55 + (reducedMotion ? 0 : transition * 1.4 + (1 - intro) * 1.5)
  if (pulseLight) pulseLight.intensity = reducedMotion ? 8 : 8 + Math.sin(time * 2.2) * 3
  composer.render()
}

function setProgress(value: number) {
  progress = Math.max(0, Math.min(1, value))
}

function onPointerMove(event: PointerEvent) {
  pointer.set(event.clientX / window.innerWidth * 2 - 1, -(event.clientY / window.innerHeight * 2 - 1))
}

defineExpose({ setProgress })

onMounted(() => {
  disposed = false
  if (!host.value) return
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch {
    host.value.classList.add('webgl-unavailable')
    return
  }
  const mobile = window.matchMedia('(max-width: 760px)').matches
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  host.value.appendChild(renderer.domElement)
  scene = new THREE.Scene()
  scene.background = new THREE.Color(night)
  scene.fog = new THREE.FogExp2(night, 0.028)
  const pmrem = new THREE.PMREMGenerator(renderer)
  environment = pmrem.fromScene(new RoomEnvironment())
  pmrem.dispose()
  scene.environment = environment.texture
  scene.environmentIntensity = 0.7
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  scene.add(new THREE.AmbientLight(0x9fc4ff, 0.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(3, 5, 7)
  key.target.position.set(0, 0, 0)
  const rim = new THREE.DirectionalLight(accent, 4.5)
  rim.position.set(-4, 2, -5)
  rim.target.position.set(0, 0, 0)
  pulseLight = new THREE.PointLight(data, 8, 6)
  pulseLight.position.set(1.6, 1.4, 3)
  lightRig.add(key, key.target, rim, rim.target, pulseLight)
  scene.add(lightRig)
  groups = [new THREE.Group(), buildGlobe(), buildNetwork(), buildRack(), buildCloud(), buildTraining(), buildFinal(), buildThanks()]
  groups.forEach((group) => scene?.add(group))
  // ponytail: particle count is a fixed desktop/mobile split; tune if weak GPUs stutter
  swarm = buildSwarm(mobile ? 2600 : 6500)
  stars = buildStars(mobile ? 700 : 1600)
  scene.add(swarm, stars)
  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.62)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  loadModels()
  resizeObserver = new ResizeObserver(() => {
    if (!host.value || !renderer || !camera || !composer) return
    const { width, height } = host.value.getBoundingClientRect()
    renderer.setSize(width, height, false)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(width, height)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(host.value)
  window.addEventListener('pointermove', onPointerMove)
  startedAt = performance.now() * 0.001
  const animate = () => {
    if (disposed) return
    render()
    animationFrame = requestAnimationFrame(animate)
  }
  animate()
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onPointerMove)
  scene?.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((item) => item.dispose())
    }
  })
  composer?.dispose()
  renderer?.dispose()
  environment?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <div ref="host" class="scene-canvas" aria-hidden="true" />
</template>
