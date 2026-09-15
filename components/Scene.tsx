'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import { useTheme } from 'next-themes'
import { ZoomButtons, type ZoomCmd } from '@/components/zoom-buttons'
import * as THREE from 'three'
import { Model } from '@/components/model'
import { gridToMesh } from '@/lib/terrain'
import { enuFactors } from '@/lib/mission'
import type { Selection, Survey } from '@/lib/survey'

/** ENU metres -> three.js Y-up: x=east, y=alt, z=-north */
const v3 = (p: { e: number; n: number; alt: number }) => new THREE.Vector3(p.e, p.alt, -p.n)

// Same roles as the profile chart, so a leg reads the same colour in both views.
const PALETTE = {
  dark: { flight: '#3987e5', critical: '#d03b3b', aircraft: '#c98500', sky: '#9fb6cf', ground: '#1c2418' },
  light: { flight: '#2a78d6', critical: '#d03b3b', aircraft: '#c98500', sky: '#cfe0f0', ground: '#6b6a5e' },
}

function Terrain({
  survey,
  onDrop,
}: {
  survey: Survey
  onDrop: ((lat: number, lon: number) => void) | null
}) {
  const { grid, origin } = survey
  // Keyed on the grid, not the survey: an edited mission is a new survey over
  // the same terrain, and regenerating 90k verts plus a GPU upload for it is
  // seconds of nothing.
  const geom = useMemo(() => {
    const { positions, colors, indices } = gridToMesh(grid, origin, 90_000)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    g.computeVertexNormals()
    return g
    // origin is a fresh object every run; its two numbers are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, origin.lat, origin.lon])

  const f = enuFactors(survey.origin.lat)

  return (
    <mesh
      geometry={geom}
      onClick={
        onDrop
          ? (e) => {
              e.stopPropagation()
              // the mesh is built in the same ENU metres, so this inverts v3()
              onDrop(
                survey.origin.lat + -e.point.z / f.lat,
                survey.origin.lon + e.point.x / f.lon,
              )
            }
          : undefined
      }
    >
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
  colors,
  onSelectVehicle,
  modelUrl,
  modelYawDeg,
  headRef,
  onTick,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  onSelectVehicle: () => void
  home: THREE.Vector3
  colors: (typeof PALETTE)['dark']
  modelUrl: string | null
  modelYawDeg: number
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
    }

    if (performance.now() - lastTick.current > 100) {
      lastTick.current = performance.now()
      onTick(i)
    }
  })

  return (
    <>
      <group
        ref={body}
        onClick={(e) => {
          e.stopPropagation()
          onSelectVehicle()
        }}
      >
        {/* ponytail: cone, exaggerated ~20m for visibility at survey scale.
            An imported .glb replaces it at the same size. */}
        {modelUrl ? (
          // ponytail: glTF assets don't agree on which way the nose points, so
          // this is a knob rather than a guess.
          <group rotation={[0, (modelYawDeg * Math.PI) / 180, 0]}>
            <Suspense fallback={null}>
              <Model url={modelUrl} />
            </Suspense>
          </group>
        ) : (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[7, 22, 8]} />
            <meshStandardMaterial color={colors.aircraft} />
          </mesh>
        )}
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

function Rig({
  center,
  home,
  focus,
  focusKey,
  chase,
  flying,
  quiet,
  cmd,
  missionId,
}: {
  center: THREE.Vector3
  home: THREE.Vector3
  focus: THREE.Vector3 | null
  focusKey: string | null
  chase: boolean
  flying: React.RefObject<boolean>
  quiet: React.RefObject<boolean>
  missionId: number
  cmd: React.RefObject<((what: ZoomCmd) => void) | null>
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.Camera
    controls:
      | { target: THREE.Vector3; update: () => void; mouseButtons: { LEFT: number } }
      | null
  }
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)

  // Frame the mission when a mission is opened, and at no other time. Keying
  // this off the survey instead threw the view away on every re-run — a
  // vehicle switch or a threshold change cost you the shot you had lined up.
  const framing = useRef({ center, home })
  framing.current = { center, home }
  useEffect(() => {
    if (!controls) return
    camera.position.copy(framing.current.home)
    controls.target.copy(framing.current.center)
    controls.update()
  }, [controls, camera, missionId])

  // Buttons dolly along the view axis — the same thing the wheel does, for
  // trackpads and touch where the wheel is awkward. A step sets a goal and the
  // frame loop glides to it, so repeated clicks compound into one movement.
  cmd.current = (what) => {
    if (!controls) return
    flying.current = false
    if (what === 'stop') {
      goal.current = null
      return
    }
    if (what === 'fit') {
      goal.current = { pos: home.clone(), target: center.clone() }
      return
    }
    const t = (goal.current?.target ?? controls.target).clone()
    const offset = (goal.current?.pos ?? camera.position).clone().sub(t)
    const d = Math.min(120000, Math.max(30, offset.length() * (what === 'in' ? 0.75 : 1 / 0.75)))
    goal.current = { pos: t.clone().addScaledVector(offset.normalize(), d), target: t }
  }

  // Shift makes the left button pan. Right-drag pans too, but a trackpad
  // makes that awkward and nothing on screen says the button exists.
  useEffect(() => {
    if (!controls) return
    const set = (pan: boolean) => {
      controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
    }
    const down = (e: KeyboardEvent) => e.key === 'Shift' && set(true)
    const up = (e: KeyboardEvent) => e.key === 'Shift' && set(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      set(false)
    }
  }, [controls])

  // A selection flies the camera to it, then hands control back. It used to
  // lerp forever, so dragging snapped back the moment you let go. Clicking the
  // thing in 3D selects without moving the camera — you are already looking.
  // Keyed on what is selected, not on the focus point: a re-run rebuilds the
  // trajectory, and flying to the "new" point every time stole the camera.
  useEffect(() => {
    if (quiet.current) {
      quiet.current = false
      flying.current = false
      return
    }
    flying.current = !!focusKey
  }, [focusKey, flying, quiet])

  useFrame(() => {
    if (chase) {
      goal.current = null
      return
    }
    if (goal.current && controls) {
      camera.position.lerp(goal.current.pos, 0.18)
      controls.target.lerp(goal.current.target, 0.18)
      controls.update()
      if (camera.position.distanceTo(goal.current.pos) < 1) goal.current = null
    }
    if (!focus || !controls || !flying.current) return
    const want = focus.clone().add(new THREE.Vector3(260, 190, 260))
    camera.position.lerp(want, 0.08)
    controls.target.lerp(focus, 0.08)
    controls.update()
    if (camera.position.distanceTo(want) < 5) flying.current = false
  })

  return null
}

export default function Scene({
  survey,
  threshold,
  playing,
  speed,
  chase,
  missionId,
  modelUrl,
  modelYawDeg,
  headRef,
  onTick,
  selection,
  onSelect,
  onDrop,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  missionId: number
  modelUrl: string | null
  modelYawDeg: number
  headRef: React.RefObject<number>
  onTick: (i: number) => void
  selection: Selection | null
  onSelect: (s: Selection) => void
  /** non-null while the user is dropping waypoints onto the terrain */
  onDrop: ((lat: number, lon: number) => void) | null
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

  const focusKey =
    selection && (selection.kind === 'waypoint' || selection.kind === 'leg')
      ? `${selection.kind}:${selection.index}`
      : null
  const selectedWp = selection?.kind === 'waypoint' ? selection.index : -1
  const flying = useRef(false)
  const quiet = useRef(false) // selection came from a click in the scene
  const cmd = useRef<((what: ZoomCmd) => void) | null>(null)

  // the selected leg, drawn over the path so it reads in 3D as well as the tree
  const legPath = useMemo(() => {
    if (selection?.kind !== 'leg') return null
    const pts = survey.traj
      .filter((t) => t.legIndex === selection.index)
      .map((t) => v3(t).toArray() as [number, number, number])
    return pts.length > 1 ? pts : null
  }, [selection, survey])

  return (
    <>
    <Canvas
      // ponytail: AA off and DPR capped at 1.5. On a 4K display the default
      // devicePixelRatio alone quadruples the fragment cost for a terrain mesh
      // that gains nothing from it.
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [homePos.x, homePos.y, homePos.z], near: 1, far: 200000 }}
      className={onDrop ? 'cursor-crosshair' : undefined}
    >
      <hemisphereLight intensity={0.35} groundColor={colors.ground} color={colors.sky} />
      <directionalLight position={[-8000, 7200, 4800]} intensity={1.5} />
      <Terrain survey={survey} onDrop={onDrop} />
      <Line
        points={path as [number, number, number][]}
        color={colors.flight}
        lineWidth={2}
        onClick={(e) => {
          e.stopPropagation()
          const p = e.point
          let best = 0
          let bestD = Infinity
          survey.traj.forEach((t, i) => {
            const d = (t.e - p.x) ** 2 + (t.alt - p.y) ** 2 + (-t.n - p.z) ** 2
            if (d < bestD) {
              bestD = d
              best = i
            }
          })
          quiet.current = true
          onSelect({ kind: 'leg', index: survey.traj[best].legIndex })
        }}
      />
      {legPath && <Line points={legPath} color={colors.aircraft} lineWidth={5} />}
      <Rig
        center={center}
        home={homePos}
        focus={focus}
        focusKey={focusKey}
        chase={chase}
        flying={flying}
        quiet={quiet}
        cmd={cmd}
        missionId={missionId}
      />
      <Aircraft
        survey={survey}
        home={homePos}
        colors={colors}
        modelUrl={modelUrl}
        modelYawDeg={modelYawDeg}
        onSelectVehicle={() => {
          quiet.current = true
          onSelect({ kind: 'vehicle' })
        }}
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
            quiet.current = true
            onSelect({ kind: 'waypoint', index: i })
          }}
        >
          <sphereGeometry
            args={[Math.max(3, dist * 0.0035) * (i === selectedWp ? 1.8 : 1), 12, 12]}
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
      {/* kept mounted so its target survives a chase-cam round trip */}
      <OrbitControls
        enabled={!chase}
        // pan across the ground rather than across the screen — this is a map
        screenSpacePanning={false}
        maxDistance={120000}
        makeDefault
        onStart={() => {
          flying.current = false
          cmd.current?.('stop')
        }}
      />
    </Canvas>
    <ZoomButtons
      onZoom={(what) => cmd.current?.(what)}
      disabled={chase}
      className="absolute right-2 bottom-2"
    />
    </>
  )
}
