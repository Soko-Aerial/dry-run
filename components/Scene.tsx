'use client'

import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import { gridToMesh } from '@/lib/terrain'
import type { Survey } from '@/lib/survey'

/** ENU metres -> three.js Y-up: x=east, y=alt, z=-north */
const v3 = (p: { e: number; n: number; alt: number }) =>
  new THREE.Vector3(p.e, p.alt, -p.n)

function Terrain({ survey }: { survey: Survey }) {
  const geom = useMemo(() => {
    const { positions, colors, indices } = gridToMesh(survey.grid, survey.origin)
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
  const body = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Line>(null)
  const lastTick = useRef(0)
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
      const back = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(body.current.quaternion)
        .multiplyScalar(220)
      camera.position.lerp(pos.clone().sub(back).add(new THREE.Vector3(0, 90, 0)), 0.08)
      camera.lookAt(pos)
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
  const start = v3(survey.traj[0])

  return (
    <Canvas
      camera={{ position: [start.x + 900, start.y + 700, start.z + 900], near: 1, far: 60000 }}
    >
      <hemisphereLight intensity={0.8} groundColor="#3a3226" />
      <directionalLight position={[1500, 2500, 1000]} intensity={1.6} />
      <Terrain survey={survey} />
      <Line points={path as [number, number, number][]} color="#38bdf8" lineWidth={2} />
      <Aircraft
        survey={survey}
        threshold={threshold}
        playing={playing}
        speed={speed}
        chase={chase}
        headRef={headRef}
        onTick={onTick}
      />
      {!chase && <OrbitControls target={start} maxDistance={30000} />}
    </Canvas>
  )
}
