import { Box3, Object3D, Vector3 } from 'three'

const FORWARD = /\b(front|nose|cockpit|camera|gimbal|head)\b/
const REAR = /\b(tail|rear|back)\b/

// Mapbox presents a glTF model's forward direction opposite Three's +Z
// convention used by the yaw inference below.
export const mapboxModelYaw = (inferredYaw = 0) => inferredYaw + 180

// The bundled cone's stored node transform already points its apex along +Z.
export const DEFAULT_AIRCRAFT_MAPBOX_YAW = 0

/** Infer the model's nose and return the Y rotation that points it along +Z. */
export function inferModelYaw(root: Object3D): number {
  root.updateWorldMatrix(true, true)
  const bounds = new Box3().setFromObject(root, true)
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const minOffset = Math.hypot(size.x, size.z) * 0.05
  const heading = new Vector3()

  root.traverse((part) => {
    const name = part.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    const direction = FORWARD.test(name) ? 1 : REAR.test(name) ? -1 : 0
    if (!direction) return

    const partCenter = new Box3().setFromObject(part, true).getCenter(new Vector3())
    partCenter.sub(center).setY(0)
    if (partCenter.length() < minOffset) return
    heading.add(partCenter.normalize().multiplyScalar(direction))
  })

  // Symmetric and unlabeled drones have no observable nose. glTF defines +Z
  // as forward, so zero is the only deterministic fallback.
  if (heading.lengthSq() < 0.25) return 0
  const yaw = -Math.atan2(heading.x, heading.z) * 180 / Math.PI
  return Object.is(yaw, -0) ? 0 : yaw
}
