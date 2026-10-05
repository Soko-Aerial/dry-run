import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

/** Imported .glb, normalised to ~22 m along its longest axis and centred. */
export function Model({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true)
    const box = new THREE.Box3().setFromObject(o)
    const size = box.getSize(new THREE.Vector3())
    const s = 22 / Math.max(size.x, size.y, size.z, 1e-6)
    o.scale.setScalar(s)
    o.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s))
    return o
  }, [gltf])
  return <primitive object={obj} />
}
