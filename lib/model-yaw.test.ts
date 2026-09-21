import { strict as assert } from 'node:assert'
import { BoxGeometry, Group, Mesh } from 'three'
import { inferModelYaw } from './model-yaw'

function part(name: string, x: number, z: number) {
  const mesh = new Mesh(new BoxGeometry())
  mesh.name = name
  mesh.position.set(x, 0, z)
  return mesh
}

{
  const aircraft = new Group()
  aircraft.add(part('body', 0, 0), part('tail_pusher_motor', -5, 0))
  assert.equal(Math.round(inferModelYaw(aircraft)), -90, 'tail at -X means the nose faces +X')
}

{
  const drone = new Group()
  drone.add(part('body', 0, 0), part('front_camera', 0, 3))
  assert.equal(Math.round(inferModelYaw(drone)), 0, 'front at +Z needs no correction')
}

{
  const symmetricDrone = new Group()
  symmetricDrone.add(part('motor', -1, -1), part('motor', 1, 1))
  assert.equal(inferModelYaw(symmetricDrone), 0, 'symmetric models use the glTF forward axis')
}

console.log('ok — model yaw inference')
