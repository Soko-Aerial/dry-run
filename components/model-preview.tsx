'use client'

import { Suspense, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Model } from '@/components/model'
import { ZoomButtons, type ZoomCmd } from '@/components/zoom-buttons'

const HOME = new THREE.Vector3(0, 12, 38)

/** Same glide-to-a-goal dolly as the main view, at model scale. */
function Dolly({ cmd }: { cmd: React.RefObject<((what: ZoomCmd) => void) | null> }) {
  const { camera } = useThree()
  const goal = useRef<THREE.Vector3 | null>(null)

  cmd.current = (what) => {
    if (what === 'stop') return void (goal.current = null)
    if (what === 'fit') return void (goal.current = HOME.clone())
    const from = goal.current ?? camera.position
    const d = Math.min(160, Math.max(8, from.length() * (what === 'in' ? 0.75 : 1 / 0.75)))
    goal.current = from.clone().normalize().multiplyScalar(d)
  }

  useFrame(() => {
    if (!goal.current) return
    // orbit controls owns direction; only the distance is ours to animate
    const want = camera.position.clone().normalize().multiplyScalar(goal.current.length())
    camera.position.lerp(want, 0.18)
    if (Math.abs(camera.position.length() - goal.current.length()) < 0.2) goal.current = null
  })

  return null
}

/** Small turntable so the yaw knob has something to aim at. */
export default function ModelPreview({ url, yawDeg }: { url: string; yawDeg: number }) {
  const cmd = useRef<((what: ZoomCmd) => void) | null>(null)
  return (
    <div className="relative aspect-4/3 w-full">
      <Canvas dpr={[1, 1.5]} camera={{ position: HOME.toArray(), fov: 45, near: 0.1, far: 500 }}>
        <hemisphereLight intensity={1.1} color="#cfe0f0" groundColor="#5b5b55" />
        <directionalLight position={[20, 30, 20]} intensity={1.6} />
        <group rotation={[0, (yawDeg * Math.PI) / 180, 0]}>
          <Suspense fallback={null}>
            <Model url={url} />
          </Suspense>
        </group>
        <Dolly cmd={cmd} />
        <OrbitControls autoRotate autoRotateSpeed={1.6} enablePan={false} makeDefault />
      </Canvas>
      <ZoomButtons
        size="icon-sm"
        onZoom={(what) => cmd.current?.(what)}
        className="absolute right-1 bottom-1"
      />
    </div>
  )
}
