'use client'

import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import { useTheme } from 'next-themes'
import * as THREE from 'three'
import { gridToMesh } from '@/lib/terrain'
import { enuFactors } from '@/lib/mission'
import type { Selection, Survey } from '@/lib/survey'

/** ENU metres -> three.js Y-up: x=east, y=alt, z=-north */
const v3 = (p: { e: number; n: number; alt: number }) => new THREE.Vector3(p.e, p.alt, -p.n)

// Same roles as the profile chart, so a leg reads the same colour in both views.
const PALETTE = {
  dark: { flight: '#3987e5', critical: '#d03b3b', aircraft: '#eda100', sky: '#9fb6cf', ground: '#1c2418' },
  light: { flight: '#2a78d6', critical: '#d03b3b', aircraft: '#c98500', sky: '#cfe0f0', ground: '#6b6a5e' },
}

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
    <mesh geometry={geom}>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  )
}

function Aircraft({
  survey,
  threshold,
  playing,
  speed,
  chase,
  home,
  focus,
  colors,
  headRef,
  onTick,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  home: THREE.Vector3
  focus: THREE.Vector3 | null
  colors: (typeof PALETTE)['dark']
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

    // clearance drop-line: perspective makes a vertical gap unjudgeable by eye
    const g = drop.current!.geometry as THREE.BufferGeometry
    const arr = g.attributes.position.array as Float32Array
    arr[0] = pos.x; arr[1] = pos.y; arr[2] = pos.z
    arr[3] = pos.x; arr[4] = p.terrain!; arr[5] = pos.z
    g.attributes.position.needsUpdate = true
    ;(drop.current!.material as THREE.LineBasicMaterial).color.set(
      p.clearance! < threshold ? colors.critical : '#22c55e',
    )

    if (chase) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(body.current.quaternion)
      const want = pos.clone().addScaledVector(fwd, -180).add(new THREE.Vector3(0, 70, 0))
      camera.position.lerp(want, chaseEngaged.current ? 0.15 : 1)
      chaseEngaged.current = true
      camera.lookAt(pos)
    } else if (chaseEngaged.current) {
      camera.position.copy(home)
      chaseEngaged.current = false
    } else if (focus) {
      // selecting in the tree pulls the camera toward the thing selected
      camera.position.lerp(
        focus.clone().add(new THREE.Vector3(260, 190, 260)),
        0.06,
      )
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
          <meshStandardMaterial color={colors.aircraft} />
        </mesh>
      </group>
      <line ref={drop as never}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} />
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
  selection,
  onSelect,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  headRef: React.RefObject<number>
  onTick: (i: number) => void
  selection: Selection | null
  onSelect: (s: Selection) => void
}) {
  const { resolvedTheme } = useTheme()
  const colors = PALETTE[resolvedTheme === 'light' ? 'light' : 'dark']

  const path = useMemo(
    () => survey.traj.filter((_, i) => i % 5 === 0).map((p) => v3(p).toArray()),
    [survey],
  )

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
      // Frame the mission, with a floor so a very short one still shows the
      // terrain it sits in. Too generous and the tile grid dominates instead.
      dist: Math.max(extent * 1.0 + 250, 900),
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

  const focus = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'waypoint') return marks[selection.index] ?? null
    if (selection.kind === 'leg') {
      const p = survey.traj.find((t) => t.legIndex === selection.index)
      return p ? v3(p) : null
    }
    return null
  }, [selection, marks, survey])

  const selectedWp = selection?.kind === 'waypoint' ? selection.index : -1

  return (
    <Canvas
      // ponytail: AA off and DPR capped at 1.5. On a 4K display the default
      // devicePixelRatio alone quadruples the fragment cost for a terrain mesh
      // that gains nothing from it.
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [homePos.x, homePos.y, homePos.z], near: 1, far: 200000 }}
    >
      <hemisphereLight intensity={0.35} groundColor={colors.ground} color={colors.sky} />
      <directionalLight position={[-8000, 7200, 4800]} intensity={1.5} />
      <Terrain survey={survey} />
      <Line points={path as [number, number, number][]} color={colors.flight} lineWidth={2} />
      <Aircraft
        survey={survey}
        home={homePos}
        focus={focus}
        colors={colors}
        threshold={threshold}
        playing={playing}
        speed={speed}
        chase={chase}
        headRef={headRef}
        onTick={onTick}
      />
      {marks.map((m, i) => (
        <mesh
          key={i}
          position={m}
          onClick={(e) => {
            e.stopPropagation()
            onSelect({ kind: 'waypoint', index: i })
          }}
        >
          <sphereGeometry
            args={[Math.max(6, dist * 0.006) * (i === selectedWp ? 1.8 : 1), 12, 12]}
          />
          <meshStandardMaterial
            color={
              survey.waypointClearance[i] < threshold ? colors.critical : colors.flight
            }
            emissive={i === selectedWp ? colors.flight : '#000000'}
            emissiveIntensity={i === selectedWp ? 0.6 : 0}
          />
        </mesh>
      ))}
      {!chase && <OrbitControls target={center} maxDistance={120000} makeDefault />}
    </Canvas>
  )
}
