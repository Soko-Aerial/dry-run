'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Upload, PanelLeft, PanelRight, PanelBottom, MapPin, LocateFixed } from 'lucide-react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { ThemeToggle } from '@/components/theme-toggle'
import { MissionTree } from '@/components/mission-tree'
import { Inspector } from '@/components/inspector'
import { Timeline } from '@/components/timeline'
import { PROFILES, type VehicleProfile } from '@/lib/trajectory'
import { parseMission, type RawMission, type RawWaypoint } from '@/lib/mission'
import { sampleAt } from '@/lib/terrain'
import { surveyMission, type Selection, type Survey } from '@/lib/survey'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

const MapScene = dynamic(() => import('@/components/MapScene'), { ssr: false })

function PanelTitle({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="border-border/60 flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[11px] font-medium">
      {children}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

export default function Page() {
  const [kind, setKind] = useState<'fixedwing' | 'multirotor'>('fixedwing')
  const [profile, setProfile] = useState<VehicleProfile>(PROFILES.fixedwing)
  const [threshold, setThreshold] = useState(30)
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [model, setModel] = useState<{ url: string; name: string; yaw: number } | null>(null)
  const [missionId, setMissionId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>({ kind: 'mission' })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [head, setHead] = useState(0)
  const [showLeft, setShowLeft] = useState(true)
  const [showRight, setShowRight] = useState(true)
  const [showBottom, setShowBottom] = useState(true)
  const [chase, setChase] = useState(false)
  const [dropping, setDropping] = useState(false)
  const headRef = useRef(0)
  const missionRef = useRef<RawMission | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLInputElement>(null)

  // Playback clamps at the last sample but nothing cleared the flag, so the
  // button showed Pause on a stopped flight and one click both rewound and
  // paused it.
  useEffect(() => {
    if (playing && survey && head >= survey.traj.length - 1) setPlaying(false)
  }, [playing, head, survey])

  const run = useCallback(
    // `select` lands with the new survey, never before it: the inspector
    // indexes into survey.waypoints, so selecting a waypoint that only exists
    // in the edited mission throws on the render in between.
    // Omitting it keeps the current selection — resetting it on a re-run
    // re-flows the inspector under the user's cursor, so the next click lands
    // on whatever moved into that spot.
    async (mission: RawMission, p = profile, t = threshold, select?: Selection) => {
      missionRef.current = mission
      setBusy(true)
      setError(null)
      try {
        const s = await surveyMission(mission, p, t)
        headRef.current = 0
        setHead(0)
        setSurvey(s)
        if (select) setSelection(select)
      } catch (e) {
        setSurvey(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [profile, threshold],
  )

  // Edits work on the parsed mission, never on the file text: the text is the
  // artifact that was imported, and re-serialising it only to parse it again is
  // a round trip with nothing at the far end.
  const dropAt = useCallback(
    (lat: number, lon: number) => {
      const m = missionRef.current
      if (!m) return
      // drop after the selected waypoint, else extend the route
      const at =
        selection?.kind === 'waypoint' ? selection.index : m.waypoints.length - 1
      const anchor = m.waypoints[at]
      // What carries over is the *clearance*, not the number: inheriting
      // "100 m above launch" onto a hillside buries the waypoint in the ground
      // and calls it NO-GO before the pilot has typed anything. Match the
      // previous waypoint's height above ground over the spot just clicked —
      // 100 m for the first one — then express it in that waypoint's frame.
      const at0 = at >= 0 ? at : null
      const agl = at0 !== null && survey ? survey.waypointClearance[at0] : 100
      const frame = anchor?.frame ?? 'relative'
      const groundAmsl = survey ? sampleAt(survey.grid, lat, lon) : 0
      const wp: RawWaypoint = {
        lat,
        lon,
        alt:
          frame === 'terrain'
            ? agl
            : groundAmsl + agl - (frame === 'relative' && survey ? survey.launchAmsl : 0),
        frame,
        command: 16, // MAV_CMD_NAV_WAYPOINT
      }
      const waypoints = [...m.waypoints]
      waypoints.splice(at + 1, 0, wp)
      run({ ...m, waypoints }, profile, threshold, { kind: 'waypoint', index: at + 1 })
    },
    [run, selection, profile, threshold, survey],
  )

  const removeWaypoint = useCallback(
    (i: number) => {
      const m = missionRef.current
      if (!m || !m.waypoints.length) return
      const waypoints = m.waypoints.filter((_, n) => n !== i)
      run(
        { ...m, waypoints },
        profile,
        threshold,
        waypoints.length
          ? { kind: 'waypoint', index: Math.min(i, waypoints.length - 1) }
          : { kind: 'mission' },
      )
    },
    [run, profile, threshold],
  )

  // Typing "250" is three edits, and each one re-runs the whole check. Wait for
  // the typing to stop instead.
  const altTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setWaypointAlt = useCallback(
    (i: number, alt: number) => {
      if (altTimer.current) clearTimeout(altTimer.current)
      altTimer.current = setTimeout(() => {
        const m = missionRef.current
        if (!m) return
        run({
          ...m,
          waypoints: m.waypoints.map((w, n) => (n === i ? { ...w, alt } : w)),
        })
      }, 250)
    },
    [run],
  )

  // Start a mission where the pilot is standing: load the terrain around the
  // device location and nothing else. The waypoints are the pilot's to drop —
  // inventing one would put a marker on the map nobody asked for. Geolocation
  // needs a secure context: localhost or https, nothing else.
  const startHere = useCallback(() => {
    if (!navigator.geolocation) return setError('This browser has no geolocation.')
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords
        setFileName(`${lat.toFixed(5)}, ${lon.toFixed(5)}`)
        setSurvey(null)
        setMissionId((n) => n + 1)
        setDropping(true)
        run(
          {
            home: { lat, lon, alt: 0 },
            waypoints: [],
            source: 'waypoints',
            warnings: ['Started from your device location, not from a GCS export.'],
          },
          profile,
          threshold,
          { kind: 'mission' },
        )
      },
      (e) => {
        setBusy(false)
        setError(`Location unavailable: ${e.message}`)
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }, [run, profile, threshold])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the inspector is full of text fields; Backspace belongs to them there
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        setDropping(false)
        setSelection(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection?.kind === 'waypoint') {
        e.preventDefault()
        removeWaypoint(selection.index)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, removeWaypoint])

  return (
    <div className="bg-background flex h-full flex-col">
      {/* top bar */}
      <header className="border-border/60 flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <input
          ref={fileRef}
          type="file"
          accept=".waypoints,.txt,.plan,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setFileName(f.name)
            setSurvey(null)
            setMissionId((n) => n + 1)
            run(parseMission(await f.text()), profile, threshold, { kind: 'mission' })
          }}
        />
        <input
          ref={modelRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const url = URL.createObjectURL(f)
            try {
              const [{ GLTFLoader }, { inferModelYaw }] = await Promise.all([
                import('three/addons/loaders/GLTFLoader.js'),
                import('@/lib/model-yaw'),
              ])
              const yaw = inferModelYaw((await new GLTFLoader().loadAsync(url)).scene)
              setModel((prev) => {
                if (prev) URL.revokeObjectURL(prev.url)
                return { url, name: f.name, yaw }
              })
            } catch {
              URL.revokeObjectURL(url)
              setError('Could not read that vehicle model.')
            } finally {
              e.target.value = ''
            }
          }}
        />
        {error && <span className="text-destructive truncate text-xs">{error}</span>}

        <div className="ml-auto flex items-center gap-1.5">
          <ButtonGroup>
            {(
              [
                [PanelLeft, showLeft, setShowLeft, 'Toggle mission panel'],
                [PanelBottom, showBottom, setShowBottom, 'Toggle timeline'],
                [PanelRight, showRight, setShowRight, 'Toggle inspector'],
              ] as const
            ).map(([Icon, on, set, label], i) => (
              <Fragment key={label}>
                {i > 0 && <ButtonGroupSeparator />}
                <Button
                  variant="secondary"
                  size="icon-sm"
                  aria-label={label}
                  aria-pressed={on}
                  onClick={() => set(!on)}
                >
                  <Icon className={cn('size-3.5', !on && 'text-muted-foreground/50')} />
                </Button>
              </Fragment>
            ))}
          </ButtonGroup>
          <ThemeToggle />
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {showLeft && (
          <>
            <ResizablePanel defaultSize="16" minSize="10" maxSize="30">
              <div className="flex h-full flex-col">
                <PanelTitle
                  action={
                    <ButtonGroup>
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Open mission"
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload />
                      </Button>
                      <ButtonGroupSeparator />
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Start a mission at my location"
                        onClick={startHere}
                      >
                        <LocateFixed />
                      </Button>
                    </ButtonGroup>
                  }
                >
                  Mission
                </PanelTitle>
                <div className="min-h-0 flex-1">
                  <MissionTree
                    survey={survey}
                    fileName={fileName}
                    selection={selection}
                    onSelect={setSelection}
                    threshold={threshold}
                  />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}

        <ResizablePanel defaultSize="60" minSize="30">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={showBottom ? "66" : "100"} minSize="25">
              <div className="relative h-full">
                {survey ? (
                  <>
                    <MapScene
                      missionId={missionId}
                      modelUrl={model?.url ?? null}
                      modelYawDeg={model?.yaw ?? 0}
                      survey={survey}
                      threshold={threshold}
                      playing={playing}
                      speed={speed}
                      chase={chase}
                      headRef={headRef}
                      onTick={setHead}
                      selection={selection}
                      onSelect={setSelection}
                      onDrop={dropping && !chase ? dropAt : null}
                      onUnavailable={() => setError('Mapbox 3D map unavailable.')}
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={dropping ? 'default' : 'secondary'}
                      disabled={chase}
                      aria-pressed={dropping}
                      className="h-6 gap-1.5 px-2 text-xs"
                      onClick={() => setDropping((d) => !d)}
                    >
                      <MapPin className="size-3.5" />
                      Drop
                    </Button>
                    <div className="bg-card/80 border-border/60 flex gap-0.5 rounded-md border p-0.5 backdrop-blur">
                      {(['Orbit', 'Chase'] as const).map((m) => (
                        <Button
                          key={m}
                          size="sm"
                          variant={chase === (m === 'Chase') ? 'secondary' : 'ghost'}
                          className="h-6 px-2 text-xs"
                          onClick={() => setChase(m === 'Chase')}
                        >
                          {m}
                        </Button>
                      ))}
                    </div>
                    </div>
                    {dropping && (
                      <span className="bg-card/80 border-border/60 text-muted-foreground absolute top-2 left-1/2 -translate-x-1/2 rounded-md border px-2 py-1 text-[11px] backdrop-blur">
                        Click the terrain to drop a waypoint
                        {selection?.kind === 'waypoint' ? ` after ${selection.index + 1}` : ''}
                      </span>
                    )}
                  </>
                ) : (
                  <div className="grid h-full place-items-center">
                    {busy ? (
                      <span className="text-muted-foreground text-xs">Sampling terrain…</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 gap-1.5 px-2.5 text-xs"
                          onClick={() => fileRef.current?.click()}
                        >
                          <Upload />
                          Open mission
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 gap-1.5 px-2.5 text-xs"
                          onClick={startHere}
                        >
                          <LocateFixed />
                          Start here
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ResizablePanel>
            {showBottom && (
              <>
                <ResizableHandle />
                <ResizablePanel defaultSize="34" minSize="12">
                  <Timeline
                    survey={survey && survey.traj.length > 1 ? survey : null}
                    threshold={threshold}
                    head={head}
                    setHead={setHead}
                    headRef={headRef}
                    playing={playing}
                    setPlaying={setPlaying}
                    speed={speed}
                    setSpeed={setSpeed}
                    selection={selection}
                    onSelect={setSelection}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>

        {showRight && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize="24" minSize="14" maxSize="40">
              <div className="flex h-full flex-col">
                <PanelTitle
                  action={
                    selection && (
                      <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-normal">
                        <Kbd>Esc</Kbd> to clear
                      </span>
                    )
                  }
                >
                  Selection
                </PanelTitle>
                <div className="min-h-0 flex-1">
                  <Inspector
                    modelName={model?.name ?? null}
                    modelUrl={model?.url ?? null}
                    modelYaw={model?.yaw ?? 0}
                    onPickModel={() => modelRef.current?.click()}
                    onClearModel={() => {
                      if (model) URL.revokeObjectURL(model.url)
                      setModel(null)
                    }}
                    kind={kind}
                    setKind={(k) => {
                      setKind(k)
                      setProfile(PROFILES[k])
                      if (missionRef.current) run(missionRef.current, PROFILES[k])
                    }}
                    survey={survey}
                    selection={selection}
                    onRemoveWaypoint={removeWaypoint}
                    onSetWaypointAlt={setWaypointAlt}
                    profile={profile}
                    setProfile={setProfile}
                    threshold={threshold}
                    setThreshold={setThreshold}
                    busy={busy}
                    onRerun={() => missionRef.current && run(missionRef.current)}
                  />
                </div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
