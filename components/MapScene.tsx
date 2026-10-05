import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { Box3, Vector3 } from 'three'
import { enuFactors } from '@/lib/mission'
import { DEFAULT_AIRCRAFT_MAPBOX_YAW, mapboxModelYaw } from '@/lib/model-yaw'
import type { VehiclePosition } from '@/lib/mavlink'
import type { Selection, Survey } from '@/lib/survey'

const EMPTY_PATH = { type: 'FeatureCollection' as const, features: [] }
const DEFAULT_AIRCRAFT_YAW = DEFAULT_AIRCRAFT_MAPBOX_YAW
const CHASE_PITCH = 55
const CHASE_ZOOM_DELTA = 0.5
type AircraftPose = { lon: number; lat: number; clearance: number; heading: number }
type AircraftModel = { uri: string; scale: number; yaw: number }

function waypointModels(survey: Survey, threshold: number, selection: Selection | null) {
  return Object.fromEntries(survey.waypoints.map((wp, i) => [String(i), {
    uri: '/waypoint.glb',
    position: [wp.lon, wp.lat] as [number, number],
    featureProperties: {
      altitude: survey.waypointClearance[i],
      index: i,
      breach: survey.waypointClearance[i] < threshold,
      selected: selection?.kind === 'waypoint' && selection.index === i,
    },
  }]))
}

const mapboxYaw = (heading: number, modelYaw: number) =>
  180 + heading * 180 / Math.PI + modelYaw

function placeAircraft(map: mapboxgl.Map, pose: AircraftPose, model: AircraftModel) {
  const source = map.getSource('dry-run-aircraft') as mapboxgl.ModelSource
  source.setModels({ aircraft: {
    uri: model.uri, position: [pose.lon, pose.lat],
    orientation: [0, 0, mapboxYaw(pose.heading, model.yaw)],
    featureProperties: { altitude: pose.clearance },
  } })
}

export default function MapScene({
  survey, threshold, playing, speed, chase, missionId, headRef, onTick, livePosition,
  selection, onSelect, onDrop, onUnavailable, onChaseExit, modelUrl, modelYawDeg,
}: {
  survey: Survey
  livePosition: VehiclePosition | null
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
  onChaseExit: () => void
  missionId: number
  headRef: React.RefObject<number>
  onTick: (i: number) => void
  selection: Selection | null
  onSelect: (s: Selection) => void
  onDrop: ((lat: number, lon: number) => void) | null
  onUnavailable: () => void
  modelUrl: string | null
  modelYawDeg: number
}) {
  const liveMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const aircraftModelRef = useRef({ uri: '/aircraft.glb', scale: 1.8, yaw: DEFAULT_AIRCRAFT_YAW })
  const aircraftPositionRef = useRef<AircraftPose | null>(null)
  const framedRef = useRef(-1)
  const chaseMapRef = useRef<mapboxgl.Map | null>(null)
  const previousChaseRef = useRef(false)
  const chaseInterruptedRef = useRef(false)
  const [loaded, setLoaded] = useState<{ map: mapboxgl.Map; missionId: number } | null>(null)
  const map = loaded?.missionId === missionId ? loaded.map : null

  useEffect(() => {
    let active = true
    let instance: mapboxgl.Map | null = null
    Promise.resolve(window.dryRun.mapboxToken).then((token) => {
      if (!token?.startsWith('pk.')) throw new Error('Mapbox token unavailable')
      if (!active || !containerRef.current) return
      mapboxgl.accessToken = token
      instance = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/standard-satellite',
        center: [survey.origin.lon, survey.origin.lat],
        zoom: 13,
        pitch: 65,
        bearing: -25,
        projection: 'mercator',
        antialias: true,
      })
      // Startup timing, read by DevTools or a test harness (docs/desktop-plan.md).
      performance.mark('map:create')
      instance.once('render', () => performance.mark('map:first-render'))
      instance.once('idle', () => performance.mark('map:idle'))
      instance.on('style.load', () => {
        if (!instance || !active) return
        performance.mark('map:style')
        instance.addSource('dry-run-dem', {
          type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512, maxzoom: 14,
        })
        instance.setTerrain({ source: 'dry-run-dem', exaggeration: 1 })
        instance.addSource('dry-run-path', {
          type: 'geojson', lineMetrics: true, data: EMPTY_PATH,
        })
        instance.addSource('dry-run-waypoint-stems', {
          type: 'geojson', lineMetrics: true, data: EMPTY_PATH,
        })
        instance.addSource('dry-run-clearance', {
          type: 'geojson', lineMetrics: true, data: EMPTY_PATH,
        })
        instance.addSource('dry-run-waypoints', {
          type: 'model', models: waypointModels(survey, threshold, selection),
        })
        instance.addLayer({
          id: 'dry-run-path', type: 'line', source: 'dry-run-path', slot: 'top',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
            'line-elevation-reference': 'ground',
            'line-z-offset': [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
          },
          paint: {
            'line-color': [
              'case',
              ['boolean', ['get', 'selected'], false], '#c98500',
              ['boolean', ['get', 'breach'], false], '#d03b3b',
              '#3987e5',
            ],
            'line-width': ['case', ['boolean', ['get', 'selected'], false], 7, 5],
            'line-emissive-strength': 1,
          },
        })
        instance.addLayer({
          id: 'dry-run-waypoint-stems', type: 'line', source: 'dry-run-waypoint-stems', slot: 'top',
          layout: {
            'line-cap': 'round',
            'line-elevation-reference': 'ground',
            'line-z-offset': [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
          },
          paint: {
            'line-color': [
              'case',
              ['boolean', ['get', 'selected'], false], '#c98500',
              ['boolean', ['get', 'breach'], false], '#d03b3b',
              '#3987e5',
            ],
            'line-width': ['case', ['boolean', ['get', 'selected'], false], 4, 2],
            'line-opacity': 0.65,
            'line-emissive-strength': 1,
          },
        })
        instance.addLayer({
          id: 'dry-run-clearance', type: 'line', source: 'dry-run-clearance', slot: 'top',
          layout: {
            'line-cap': 'round',
            'line-elevation-reference': 'ground',
            'line-z-offset': [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
          },
          paint: {
            'line-color': ['case', ['boolean', ['get', 'breach'], false], '#d03b3b', '#22c55e'],
            'line-width': 4,
            'line-emissive-strength': 1,
          },
        })
        instance.addLayer({
          id: 'dry-run-waypoints', type: 'model', source: 'dry-run-waypoints', slot: 'top',
          paint: {
            'model-elevation-reference': 'ground',
            'model-translation': [0, 0, ['get', 'altitude']],
            'model-scale': [1.5, 1.5, 1.5],
            'model-color': [
              'case',
              ['boolean', ['get', 'selected'], false], '#c98500',
              ['boolean', ['get', 'breach'], false], '#d03b3b',
              '#3987e5',
            ],
            'model-color-mix-intensity': 1,
            'model-emissive-strength': 1,
          },
        })
        const first = survey.traj[0]
        const f = enuFactors(survey.origin.lat)
        instance.addSource('dry-run-aircraft', {
          type: 'model',
          models: { aircraft: {
            uri: '/aircraft.glb',
            position: [survey.origin.lon + (first?.e ?? 0) / f.lon, survey.origin.lat + (first?.n ?? 0) / f.lat],
            orientation: [0, 0, mapboxYaw(first?.heading ?? 0, DEFAULT_AIRCRAFT_YAW)],
            featureProperties: { altitude: first?.clearance ?? 0 },
          } },
        })
        instance.addLayer({
          id: 'dry-run-aircraft', type: 'model', source: 'dry-run-aircraft', slot: 'top',
          layout: { visibility: first ? 'visible' : 'none' },
          paint: {
            'model-elevation-reference': 'ground',
            'model-translation': [0, 0, ['get', 'altitude']],
            'model-scale': [1.8, 1.8, 1.8],
            'model-type': 'location-indicator',
          },
        })
        setLoaded({ map: instance, missionId })
      })
    }).catch(onUnavailable)
    return () => {
      active = false
      aircraftPositionRef.current = null
      instance?.remove()
    }
    // A new imported mission gets a fresh map. Edits update its sources below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId])

  useEffect(() => {
    if (!map) return
    const element = document.createElement('div')
    element.textContent = '▲'
    element.style.cssText = 'color:#14b8a6;font-size:24px;text-shadow:0 1px 3px #000;'
    element.setAttribute('aria-label', 'Live vehicle position')
    element.setAttribute('role', 'img')
    const marker = new mapboxgl.Marker({ element, rotationAlignment: 'map' })
    liveMarkerRef.current = marker
    return () => {
      marker.remove()
      liveMarkerRef.current = null
    }
  }, [map])

  useEffect(() => {
    const marker = liveMarkerRef.current
    if (!map || !marker) return
    if (!livePosition) { marker.remove(); return }
    marker.setLngLat([livePosition.lon, livePosition.lat])
      .setRotation(livePosition.heading ?? 0)
    if (!marker.getElement().isConnected) marker.addTo(map)
    marker.getElement().title = `Live vehicle at ${livePosition.altAmsl.toFixed(1)} m AMSL`
  }, [map, livePosition])

  useEffect(() => {
    if (!map || framedRef.current === missionId) return
    framedRef.current = missionId
    const points = [survey.origin, ...survey.waypoints]
    const bounds = new mapboxgl.LngLatBounds()
    points.forEach((p) => bounds.extend([p.lon, p.lat]))
    if (points.length > 1) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, pitch: 65, bearing: -25, duration: 0 })
    } else {
      map.jumpTo({ center: [survey.origin.lon, survey.origin.lat], zoom: 14, pitch: 65 })
    }
  }, [map, missionId, survey])

  useEffect(() => {
    const container = containerRef.current
    if (!map || !container) return
    let frame = 0
    const resize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.resize())
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    const f = enuFactors(survey.origin.lat)
    const lngLat = (p: { e: number; n: number }): [number, number] => [
      survey.origin.lon + p.e / f.lon,
      survey.origin.lat + p.n / f.lat,
    ]
    const sampled = survey.traj.filter((_, i) => i % 5 === 0 || i === survey.traj.length - 1)
    const features = sampled.slice(1).map((next, i) => {
      const prev = sampled[i]
      return {
        type: 'Feature' as const,
        properties: {
          elevation: [prev.clearance ?? 0, next.clearance ?? 0],
          breach: Math.min(prev.clearance ?? Infinity, next.clearance ?? Infinity) < threshold,
          legIndex: prev.legIndex,
          selected: selection?.kind === 'leg' && selection.index === prev.legIndex,
        },
        geometry: { type: 'LineString' as const, coordinates: [lngLat(prev), lngLat(next)] },
      }
    })
    const source = map.getSource('dry-run-path') as mapboxgl.GeoJSONSource
    source.setData({ type: 'FeatureCollection', features })
  }, [map, survey, threshold, selection])

  useEffect(() => {
    if (!map) return
    const waypointSource = map.getSource('dry-run-waypoints') as mapboxgl.ModelSource | undefined
    const stemSource = map.getSource('dry-run-waypoint-stems') as mapboxgl.GeoJSONSource | undefined
    if (!waypointSource || !stemSource) return
    waypointSource.setModels(waypointModels(survey, threshold, selection))
    stemSource.setData({
      type: 'FeatureCollection',
      features: survey.waypoints.map((wp, i) => ({
        type: 'Feature' as const,
        properties: {
          elevation: [0, survey.waypointClearance[i]],
          breach: survey.waypointClearance[i] < threshold,
          selected: selection?.kind === 'waypoint' && selection.index === i,
        },
        // A sub-centimetre horizontal offset keeps Mapbox from discarding the
        // two-vertex vertical line as a zero-length segment.
        geometry: {
          type: 'LineString' as const,
          coordinates: [[wp.lon, wp.lat], [wp.lon + 0.5 / enuFactors(wp.lat).lon, wp.lat]],
        },
      })),
    })
  }, [map, survey, selection, threshold])

  useEffect(() => {
    if (!map) return
    let active = true
    let uploadedUri: string | null = null
    if (!modelUrl) {
      aircraftModelRef.current = { uri: '/aircraft.glb', scale: 1.8, yaw: DEFAULT_AIRCRAFT_YAW }
      map.setPaintProperty('dry-run-aircraft', 'model-scale', [1.8, 1.8, 1.8])
      if (aircraftPositionRef.current) placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
      return
    }
    const release = () => {
      if (!uploadedUri) return
      const uri = uploadedUri
      uploadedUri = null
      URL.revokeObjectURL(uri)
    }
    const model = new Promise<{ size: Vector3; blob: Blob }>((resolve, reject) => {
      new GLTFLoader().load(modelUrl, (gltf) => {
        const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3())
        // Mapbox's model loader cannot read interleaved vertex buffers in some
        // valid GLBs. Three's exporter writes separate buffers for each attribute.
        new GLTFExporter().parseAsync(gltf.scene, { binary: true })
          .then((data) => resolve({ size, blob: new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }) }), reject)
      }, undefined, reject)
    })
    model.then(async ({ size, blob }) => {
      const uri = URL.createObjectURL(blob)
      if (!active) { URL.revokeObjectURL(uri); return }
      uploadedUri = uri
      const scale = 40 / Math.max(size.x, size.y, size.z, 1e-6)
      aircraftModelRef.current = { uri, scale, yaw: mapboxModelYaw(modelYawDeg) }
      map.setPaintProperty('dry-run-aircraft', 'model-scale', [scale, scale, scale])
      if (aircraftPositionRef.current) placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
    }).catch(() => {
      if (!active) return
      aircraftModelRef.current = { uri: '/aircraft.glb', scale: 1.8, yaw: DEFAULT_AIRCRAFT_YAW }
      map.setPaintProperty('dry-run-aircraft', 'model-scale', [1.8, 1.8, 1.8])
      if (aircraftPositionRef.current) placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
    })
    return () => {
      active = false
      release()
    }
    // Changing yaw should rotate the loaded model, not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, modelUrl])

  useEffect(() => {
    aircraftModelRef.current.yaw = modelUrl
      ? mapboxModelYaw(modelYawDeg)
      : DEFAULT_AIRCRAFT_YAW
    if (map && aircraftPositionRef.current) placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
  }, [map, modelUrl, modelYawDeg])

  useEffect(() => {
    if (!map) return
    const click = (e: mapboxgl.MapMouseEvent) => {
      if (onDrop) { onDrop(e.lngLat.lat, e.lngLat.lng); return }
      const p = aircraftPositionRef.current
      if (p) {
        const screen = map.project([p.lon, p.lat], p.clearance)
        if (Math.hypot(e.point.x - screen.x, e.point.y - screen.y) < 25) {
          onSelect({ kind: 'vehicle' })
          return
        }
      }
      const waypoint = map.getLayer('dry-run-waypoints')
        ? map.queryRenderedFeatures(e.point, { layers: ['dry-run-waypoints'] })[0]
        : undefined
      const waypointIndex = Number((waypoint as { properties?: Record<string, unknown> } | undefined)?.properties?.index)
      if (Number.isInteger(waypointIndex)) {
        onSelect({ kind: 'waypoint', index: waypointIndex })
        return
      }
      const leg = map.queryRenderedFeatures(e.point, { layers: ['dry-run-path'] })[0]
      const legIndex = Number((leg as { properties?: Record<string, unknown> } | undefined)?.properties?.legIndex)
      if (Number.isInteger(legIndex)) onSelect({ kind: 'leg', index: legIndex })
    }
    const canvas = map.getCanvas()
    map.on('click', click)
    canvas.style.cursor = onDrop ? 'crosshair' : ''
    return () => { map.off('click', click); canvas.style.cursor = '' }
  }, [map, onDrop, onSelect])

  useEffect(() => {
    if (!map || chase || !selection) return
    const f = enuFactors(survey.origin.lat)
    let target: [number, number] | null = null
    if (selection.kind === 'waypoint') {
      const wp = survey.waypoints[selection.index]
      if (wp) target = [wp.lon, wp.lat]
    } else if (selection.kind === 'leg') {
      const p = survey.traj.find((pt) => pt.legIndex === selection.index)
      if (p) target = [survey.origin.lon + p.e / f.lon, survey.origin.lat + p.n / f.lat]
    }
    if (target) map.flyTo({ center: target, zoom: Math.max(map.getZoom(), 15), pitch: 65, duration: 600 })
  }, [map, selection, survey, chase])

  useEffect(() => {
    if (!map) return
    if (chaseMapRef.current !== map) {
      chaseMapRef.current = map
      previousChaseRef.current = false
    }
    if (chase && !previousChaseRef.current) {
      chaseInterruptedRef.current = false
      map.jumpTo({ zoom: map.getZoom() + CHASE_ZOOM_DELTA, pitch: CHASE_PITCH })
    } else if (!chase && previousChaseRef.current) {
      map.jumpTo({ zoom: map.getZoom() - CHASE_ZOOM_DELTA, pitch: 65 })
    }
    previousChaseRef.current = chase
  }, [map, chase])

  useEffect(() => {
    if (!map || !chase) return
    const canvas = map.getCanvas()
    let pointer: { x: number; y: number } | null = null
    const interrupt = () => {
      if (chaseInterruptedRef.current) return
      chaseInterruptedRef.current = true
      onChaseExit()
    }
    const pointerDown = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY } }
    const pointerMove = (event: PointerEvent) => {
      if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) interrupt()
    }
    const pointerUp = () => { pointer = null }
    const keyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', 'PageUp', 'PageDown'].includes(event.key)) interrupt()
    }
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('wheel', interrupt, { passive: true })
    canvas.addEventListener('dblclick', interrupt)
    canvas.addEventListener('keydown', keyDown)
    window.addEventListener('pointerup', pointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('wheel', interrupt)
      canvas.removeEventListener('dblclick', interrupt)
      canvas.removeEventListener('keydown', keyDown)
      window.removeEventListener('pointerup', pointerUp)
    }
  }, [map, chase, onChaseExit])

  useEffect(() => {
    if (!map) return
    map.setLayoutProperty('dry-run-aircraft', 'visibility', survey.traj.length ? 'visible' : 'none')
    const clearanceSource = map.getSource('dry-run-clearance') as mapboxgl.GeoJSONSource
    if (!survey.traj.length) {
      clearanceSource.setData(EMPTY_PATH)
      return
    }
    const f = enuFactors(survey.origin.lat)
    const sampleDt = survey.traj.length > 1 ? survey.traj[1].t - survey.traj[0].t : 0.1
    const startIndex = Number.isFinite(headRef.current)
      ? Math.max(0, Math.min(survey.traj.length - 1, Math.floor(headRef.current))) : 0
    const start = survey.traj[startIndex]
    const startLon = survey.origin.lon + start.e / f.lon
    const startLat = survey.origin.lat + start.n / f.lat
    aircraftPositionRef.current = {
      lon: startLon,
      lat: startLat,
      clearance: start.clearance ?? 0,
      heading: start.heading,
    }
    placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
    let frame = 0
    let last = performance.now()
    let lastIndex = -1
    let lastRenderedHead = -1
    let chaseOffset: [number, number] = [0, 0]
    const tick = (now: number) => {
      if (!Number.isFinite(headRef.current)) headRef.current = 0
      if (playing && survey.traj.length > 1 && sampleDt > 0) {
        const elapsed = Math.min(250, Math.max(0, now - last))
        headRef.current = Math.min(survey.traj.length - 1, headRef.current + elapsed * speed / 1000 / sampleDt)
      }
      last = now
      const head = Math.max(0, Math.min(survey.traj.length - 1, headRef.current))
      const i = Math.floor(head)
      if (i !== lastIndex) { onTick(i); lastIndex = i }
      if (head === lastRenderedHead) {
        frame = requestAnimationFrame(tick)
        return
      }
      lastRenderedHead = head
      const p = survey.traj[i]
      const next = survey.traj[Math.min(i + 1, survey.traj.length - 1)]
      const mix = head - i
      const e = p.e + (next.e - p.e) * mix
      const n = p.n + (next.n - p.n) * mix
      const clearance = (p.clearance ?? 0) + ((next.clearance ?? 0) - (p.clearance ?? 0)) * mix
      const headingDelta = Math.atan2(Math.sin(next.heading - p.heading), Math.cos(next.heading - p.heading))
      const heading = p.heading + headingDelta * mix
      const position: [number, number] = [survey.origin.lon + e / f.lon, survey.origin.lat + n / f.lat]
      aircraftPositionRef.current = {
        lon: position[0],
        lat: position[1],
        clearance,
        heading,
      }
      placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
      clearanceSource.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            elevation: [0, clearance],
            breach: clearance < threshold,
          },
          geometry: {
            type: 'LineString',
            coordinates: [position, [position[0] + 0.5 / f.lon, position[1]]],
          },
        }],
      })
      if (chase && !chaseInterruptedRef.current) {
        const camera = {
          center: position,
          zoom: Math.max(map.getZoom(), 15 + CHASE_ZOOM_DELTA),
          pitch: CHASE_PITCH,
          bearing: heading * 180 / Math.PI,
          duration: 0,
        }
        map.easeTo({ ...camera, offset: chaseOffset })
        const canvas = map.getCanvas()
        const projected = map.project(position, clearance)
        const correction: [number, number] = [
          canvas.clientWidth / 2 - projected.x,
          canvas.clientHeight / 2 - projected.y,
        ]
        if (Math.abs(correction[0]) > 0.25 || Math.abs(correction[1]) > 0.25) {
          chaseOffset = [chaseOffset[0] + correction[0], chaseOffset[1] + correction[1]]
          map.easeTo({ ...camera, offset: chaseOffset })
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [map, survey, threshold, playing, speed, chase, headRef, onTick])

  return <div ref={containerRef} className="size-full" />
}
