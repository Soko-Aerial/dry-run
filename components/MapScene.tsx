'use client'

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { Box3, Vector3 } from 'three'
import { enuFactors } from '@/lib/mission'
import type { Selection, Survey } from '@/lib/survey'

const EMPTY_PATH = { type: 'FeatureCollection' as const, features: [] }
const DEFAULT_AIRCRAFT_YAW = 90
type AircraftPose = { lon: number; lat: number; altitude: number; heading: number }
type AircraftModel = { uri: string; scale: number; yaw: number }

function placeAircraft(map: mapboxgl.Map, pose: AircraftPose, model: AircraftModel) {
  const source = map.getSource('dry-run-aircraft') as mapboxgl.ModelSource
  source.setModels({ aircraft: {
    uri: model.uri, position: [pose.lon, pose.lat],
    orientation: [0, 0, 180 - pose.heading * 180 / Math.PI + model.yaw],
  } })
  map.setFeatureState({ source: 'dry-run-aircraft', sourceLayer: '', id: 'aircraft' }, { altitude: pose.altitude })
}

export default function MapScene({
  survey, threshold, playing, speed, chase, missionId, headRef, onTick,
  selection, onSelect, onDrop, onUnavailable, modelUrl, modelYawDeg,
}: {
  survey: Survey
  threshold: number
  playing: boolean
  speed: number
  chase: boolean
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
  const containerRef = useRef<HTMLDivElement>(null)
  const aircraftModelRef = useRef({ uri: '/aircraft.glb', scale: 1.8, yaw: DEFAULT_AIRCRAFT_YAW })
  const aircraftPositionRef = useRef<AircraftPose | null>(null)
  const aircraftMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const framedRef = useRef(-1)
  const [loaded, setLoaded] = useState<{ map: mapboxgl.Map; missionId: number } | null>(null)
  const map = loaded?.missionId === missionId ? loaded.map : null

  useEffect(() => {
    let active = true
    let instance: mapboxgl.Map | null = null
    fetch('/api/map-token').then(async (res) => {
      if (!res.ok) throw new Error('Mapbox token unavailable')
      return (await res.json()) as { token: string }
    }).then(({ token }) => {
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
      instance.on('style.load', () => {
        if (!instance || !active) return
        instance.addSource('dry-run-dem', {
          type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512, maxzoom: 14,
        })
        instance.setTerrain({ source: 'dry-run-dem', exaggeration: 1 })
        instance.addSource('dry-run-path', {
          type: 'geojson', lineMetrics: true, data: EMPTY_PATH,
        })
        instance.addLayer({
          id: 'dry-run-path', type: 'line', source: 'dry-run-path', slot: 'top',
          layout: {
            'line-elevation-reference': 'sea',
            'line-z-offset': [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
          },
          paint: {
            'line-color': ['case', ['boolean', ['get', 'breach'], false], '#d03b3b', '#3987e5'],
            'line-width': 5,
            'line-emissive-strength': 1,
          },
        })
        const first = survey.traj[0]
        const f = enuFactors(survey.origin.lat)
        instance.addSource('dry-run-aircraft', {
          type: 'model',
          models: { aircraft: {
            uri: '/aircraft.glb',
            position: [survey.origin.lon + (first?.e ?? 0) / f.lon, survey.origin.lat + (first?.n ?? 0) / f.lat],
            orientation: [0, 0, 180 - (first?.heading ?? 0) * 180 / Math.PI + DEFAULT_AIRCRAFT_YAW],
          } },
        })
        instance.addLayer({
          id: 'dry-run-aircraft', type: 'model', source: 'dry-run-aircraft', slot: 'top',
          layout: { visibility: first ? 'visible' : 'none' },
          paint: {
            'model-elevation-reference': 'sea',
            'model-translation': [0, 0, ['feature-state', 'altitude']],
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
      aircraftMarkerRef.current = null
      instance?.remove()
    }
    // A new imported mission gets a fresh map. Edits update its sources below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId])

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
    if (!map || !survey.traj.length) return
    const p = survey.traj[0]
    const f = enuFactors(survey.origin.lat)
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = '▲'
    el.title = 'Aircraft'
    el.className = 'grid size-4 place-items-center rounded-full border border-white bg-amber-600/70 text-[9px] text-white shadow-lg'
    el.addEventListener('click', (e) => { e.stopPropagation(); onSelect({ kind: 'vehicle' }) })
    const marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat([survey.origin.lon + p.e / f.lon, survey.origin.lat + p.n / f.lat])
      .setAltitude(Math.max(0, p.clearance ?? 0))
      .addTo(map)
    aircraftMarkerRef.current = marker
    return () => { aircraftMarkerRef.current = null; marker.remove() }
  }, [map, survey, onSelect])

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
          elevation: [prev.alt, next.alt],
          breach: Math.min(prev.clearance ?? Infinity, next.clearance ?? Infinity) < threshold,
        },
        geometry: { type: 'LineString' as const, coordinates: [lngLat(prev), lngLat(next)] },
      }
    })
    const source = map.getSource('dry-run-path') as mapboxgl.GeoJSONSource
    source.setData({ type: 'FeatureCollection', features })
  }, [map, survey, threshold])

  useEffect(() => {
    if (!map) return
    const markers = survey.waypoints.map((wp, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = String(i + 1)
      el.title = `Waypoint ${i + 1}`
      el.className = 'grid size-6 place-items-center rounded-full border-2 border-white bg-blue-600 text-xs font-semibold text-white shadow-md'
      if (selection?.kind === 'waypoint' && selection.index === i) el.classList.replace('bg-blue-600', 'bg-amber-600')
      if (survey.waypointClearance[i] < threshold) el.classList.replace('bg-blue-600', 'bg-red-600')
      el.addEventListener('click', (e) => { e.stopPropagation(); onSelect({ kind: 'waypoint', index: i }) })
      return new mapboxgl.Marker({ element: el, altitude: Math.max(0, survey.waypointClearance[i]) })
        .setLngLat([wp.lon, wp.lat]).addTo(map)
    })
    return () => markers.forEach((marker) => marker.remove())
  }, [map, survey, selection, onSelect, threshold])

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
      void fetch(uri, { method: 'DELETE', keepalive: true })
    }
    window.addEventListener('pagehide', release)
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
      const response = await fetch('/api/models', { method: 'POST', body: blob })
      if (!response.ok) throw new Error('Could not load the GLB into the map')
      const { url: uri } = await response.json() as { url: string }
      if (!active) { void fetch(uri, { method: 'DELETE', keepalive: true }); return }
      uploadedUri = uri
      const scale = 40 / Math.max(size.x, size.y, size.z, 1e-6)
      aircraftModelRef.current = { uri, scale, yaw: modelYawDeg }
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
      window.removeEventListener('pagehide', release)
      release()
    }
    // Changing yaw should rotate the loaded model, not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, modelUrl])

  useEffect(() => {
    aircraftModelRef.current.yaw = modelUrl ? modelYawDeg : DEFAULT_AIRCRAFT_YAW
    if (map && aircraftPositionRef.current) placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
  }, [map, modelUrl, modelYawDeg])

  useEffect(() => {
    if (!map) return
    const click = (e: mapboxgl.MapMouseEvent) => {
      if (onDrop) { onDrop(e.lngLat.lat, e.lngLat.lng); return }
      const p = aircraftPositionRef.current
      if (!p) return
      const screen = map.project([p.lon, p.lat], p.altitude)
      if (Math.hypot(e.point.x - screen.x, e.point.y - screen.y) < 25) onSelect({ kind: 'vehicle' })
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
    map.setLayoutProperty('dry-run-aircraft', 'visibility', survey.traj.length ? 'visible' : 'none')
    if (!survey.traj.length) return
    const routeHeading = survey.traj[0].heading
    const f = enuFactors(survey.origin.lat)
    const sampleDt = survey.traj.length > 1 ? survey.traj[1].t - survey.traj[0].t : 0.1
    const startIndex = Number.isFinite(headRef.current)
      ? Math.max(0, Math.min(survey.traj.length - 1, Math.floor(headRef.current))) : 0
    const start = survey.traj[startIndex]
    const startLon = survey.origin.lon + start.e / f.lon
    const startLat = survey.origin.lat + start.n / f.lat
    aircraftPositionRef.current = { lon: startLon, lat: startLat, altitude: start.alt, heading: routeHeading }
    placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
    let frame = 0
    let last = performance.now()
    let lastIndex = -1
    let lastCamera = 0
    const tick = (now: number) => {
      if (!Number.isFinite(headRef.current)) headRef.current = 0
      if (playing && survey.traj.length > 1 && sampleDt > 0) {
        const elapsed = Math.min(250, Math.max(0, now - last))
        headRef.current = Math.min(survey.traj.length - 1, headRef.current + elapsed * speed / 1000 / sampleDt)
      }
      last = now
      const i = Math.max(0, Math.min(survey.traj.length - 1, Math.floor(headRef.current)))
      const changed = i !== lastIndex
      if (changed) { onTick(i); lastIndex = i }
      const p = survey.traj[i]
      const position: [number, number] = [survey.origin.lon + p.e / f.lon, survey.origin.lat + p.n / f.lat]
      aircraftPositionRef.current = { lon: position[0], lat: position[1], altitude: p.alt, heading: routeHeading }
      if (changed) placeAircraft(map, aircraftPositionRef.current, aircraftModelRef.current)
      aircraftMarkerRef.current?.setLngLat(position).setAltitude(Math.max(0, p.clearance ?? 0)).setRotation(routeHeading * 180 / Math.PI)
      if (chase && now - lastCamera > 100) {
        map.jumpTo({ center: position, zoom: Math.max(map.getZoom(), 15), pitch: 75, bearing: p.heading * 180 / Math.PI })
        lastCamera = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [map, survey, threshold, playing, speed, chase, headRef, onTick])

  return <div ref={containerRef} className="size-full" />
}
