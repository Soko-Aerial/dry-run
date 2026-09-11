'use client'

import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import { gridToMesh } from '@/lib/terrain'
import { enuFactors } from '@/lib/mission'
import type { Survey } from '@/lib/survey'

/** ENU metres -> three.js Y-up: x=east, y=alt, z=-north */
const v3 = (p: { e: number; n: number; alt: number }) =>
  new THREE.Vector3(p.e, p.alt, -p.n)

function Terrain({ survey }: { survey: Survey }) {
  const geom = useMemo(() => {
    const { positions, colors, indices } = gridToMesh(survey.grid, survey.origin, 90_000)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    g.computeVertexNormals()
    return g
  }, [survey])

  return (
    <mesh geometry={geom} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  )
}

/**
 * Aircraft, its clearance drop-line, and the chase camera.
 * Playback advances a ref, not React state — 60fps re-renders are not a thing
 * we need. The parent gets a throttled tick for the readout.
 */
function Aircraft({
  survey,
  threshold,
  playing,
  speed,
  chase,
  home,
  headRef,
  onTick,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  home: THREE.Vector3
  headRef: React.RefObject<number>
  onTick: (i: number) => void
}) {
  const body = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Line>(null)
  const lastTick = useRef(0)
  const chaseEngaged = useRef(false)
  const { camera } = useThree()
  const dt = survey.traj[1].t - survey.traj[0].t

  useFrame((_, delta) => {
    if (playing) {
      headRef.current = Math.min(
        survey.traj.length - 1,
        headRef.current + (delta * speed) / dt,
      )
    }
    const i = Math.floor(headRef.current)
    const p = survey.traj[i]
    const next = survey.traj[Math.min(i + 1, survey.traj.length - 1)]
    if (!body.current) return

    const pos = v3(p)
    body.current.position.copy(pos)
    if (next !== p) body.current.lookAt(v3(next))

    // clearance drop-line: the element that makes 3D communicate clearance,
    // because perspective makes a vertical gap unjudgeable by eye.
    const g = drop.current!.geometry as THREE.BufferGeometry
    const arr = g.attributes.position.array as Float32Array
    arr[0] = pos.x; arr[1] = pos.y; arr[2] = pos.z
    arr[3] = pos.x; arr[4] = p.terrain!; arr[5] = pos.z
    g.attributes.position.needsUpdate = true
    const mat = drop.current!.material as THREE.LineBasicMaterial
    mat.color.set(p.clearance! < threshold ? '#ef4444' : '#22c55e')

    if (chase) {
      // Behind and above, in the aircraft's own frame. Snap on engage — lerping
      // in from wherever the orbit camera sat takes seconds the pilot will read
      // as the control being broken.
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(body.current.quaternion)
      const want = pos
        .clone()
        .addScaledVector(fwd, -180)
        .add(new THREE.Vector3(0, 70, 0))
      camera.position.lerp(want, chaseEngaged.current ? 0.15 : 1)
      chaseEngaged.current = true
      camera.lookAt(pos)
    } else if (chaseEngaged.current) {
      // Leaving chase must put the camera back where orbit left it, or the
      // pilot lands 180m behind the aircraft with no idea where they are.
      camera.position.copy(home)
      chaseEngaged.current = false
    }

    if (performance.now() - lastTick.current > 100) {
      lastTick.current = performance.now()
      onTick(i)
    }
  })

  return (
    <>
      <group ref={body}>
        {/* ponytail: cone, exaggerated ~20m for visibility at survey scale */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[7, 22, 8]} />
          <meshStandardMaterial color="#fbbf24" />
        </mesh>
      </group>
      <line ref={drop as never}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(6), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#22c55e" />
      </line>
    </>
  )
}

export default function Scene({
  survey,
  threshold,
  playing,
  speed,
  chase,
  headRef,
  onTick,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  headRef: React.RefObject<number>
  onTick: (i: number) => void
}) {
  const path = useMemo(
    () => survey.traj.filter((_, i) => i % 5 === 0).map((p) => v3(p).toArray()),
    [survey],
  )

  // Frame the mission, not the tile grid — the grid is padded far wider than
  // the flight and a fixed camera offset leaves short missions invisible.
  const { center, dist, marks } = useMemo(() => {
    const es = survey.traj.map((p) => p.e)
    const ns = survey.traj.map((p) => p.n)
    const alts = survey.traj.map((p) => p.alt)
    const extent = Math.max(
      Math.max(...es) - Math.min(...es),
      Math.max(...ns) - Math.min(...ns),
      200,
    )
    const f = enuFactors(survey.origin.lat)
    return {
      center: new THREE.Vector3(
        (Math.min(...es) + Math.max(...es)) / 2,
        (Math.min(...alts) + Math.max(...alts)) / 2,
        -(Math.min(...ns) + Math.max(...ns)) / 2,
      ),
      // floor it: a 200m mission framed tightly shows a featureless slope and
      // no sense of the terrain it sits in
      dist: Math.max(extent * 1.4 + 300, 1500),
      marks: survey.waypoints.map((w) =>
        v3({
          e: (w.lon - survey.origin.lon) * f.lon,
          n: (w.lat - survey.origin.lat) * f.lat,
          alt: w.alt,
        }),
      ),
    }
  }, [survey])

  const homePos = useMemo(
    () => new THREE.Vector3(center.x + dist, center.y + dist * 0.6, center.z + dist),
    [center, dist],
  )

  return (
    <Canvas
      // ponytail: AA off and DPR capped at 1.5. On a 4K display the default
      // devicePixelRatio alone quadruples the fragment cost for a terrain mesh
      // that gains nothing from it.
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{
        position: [homePos.x, homePos.y, homePos.z],
        near: 1,
        far: 200000,
      }}
    >
      {/* low fill + one strong raking light: relief has to read as shape */}
      <hemisphereLight intensity={0.35} groundColor="#1c2418" color="#9fb6cf" />
      <directionalLight position={[-1.0, 0.9, 0.6].map((v) => v * 8000) as never} intensity={1.5} />
      <Terrain survey={survey} />
      <Line points={path as [number, number, number][]} color="#38bdf8" lineWidth={2} />
      <Aircraft
        survey={survey}
        home={homePos}
        threshold={threshold}
        playing={playing}
        speed={speed}
        chase={chase}
        headRef={headRef}
        onTick={onTick}
      />
      {marks.map((m, i) => (
        <mesh key={i} position={m}>
          <sphereGeometry args={[Math.max(6, dist * 0.006), 12, 12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0c4a6e" />
        </mesh>
      ))}
      {!chase && <OrbitControls target={center} maxDistance={120000} />}
    </Canvas>
  )
}
