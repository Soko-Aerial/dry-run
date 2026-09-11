'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Upload, PanelLeft, PanelRight, PanelBottom } from 'lucide-react'
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
import { runSurvey, type Selection, type Survey } from '@/lib/survey'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

const Scene = dynamic(() => import('@/components/Scene'), { ssr: false })

function PanelTitle({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="border-border/60 flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[11px] font-medium">
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
  const [model, setModel] = useState<{ url: string; name: string } | null>(null)
  // glTF assets disagree on the forward axis; -90° suits a nose-along-+X model,
  // which is the common case. The knob in the inspector covers the rest.
  const [modelYaw, setModelYaw] = useState(-90)
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
  const headRef = useRef(0)
  const textRef = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLInputElement>(null)

  // Playback clamps at the last sample but nothing cleared the flag, so the
  // button showed Pause on a stopped flight and one click both rewound and
  // paused it.
  useEffect(() => {
    if (playing && survey && head >= survey.traj.length - 1) setPlaying(false)
  }, [playing, head, survey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = useCallback(
    // `fresh` = a newly opened file. A re-run of the same mission keeps the
    // selection: resetting it re-flows the inspector under the user's cursor,
    // so the next click lands on whatever moved into that spot.
    async (text: string, p = profile, t = threshold, fresh = false) => {
      textRef.current = text
      setBusy(true)
      setError(null)
      try {
        const s = await runSurvey(text, p, t)
        headRef.current = 0
        setHead(0)
        setSurvey(s)
        if (fresh) setSelection({ kind: 'mission' })
      } catch (e) {
        setSurvey(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [profile, threshold],
  )

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
            run(await f.text(), profile, threshold, true)
          }}
        />
        <input
          ref={modelRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setModel((prev) => {
              if (prev) URL.revokeObjectURL(prev.url)
              return { url: URL.createObjectURL(f), name: f.name }
            })
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
                  size="icon"
                  aria-label={label}
                  aria-pressed={on}
                  className="size-7"
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
                    <Button
                      size="icon-xs"
                      variant="secondary"
                      aria-label="Open mission"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload />
                    </Button>
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
                    <Scene
                      modelUrl={model?.url ?? null}
                      modelYawDeg={modelYaw}
                      survey={survey}
                      threshold={threshold}
                      playing={playing}
                      speed={speed}
                      chase={chase}
                      headRef={headRef}
                      onTick={setHead}
                      selection={selection}
                      onSelect={setSelection}
                    />
                    <div className="bg-card/80 border-border/60 absolute top-2 right-2 flex gap-0.5 rounded-md border p-0.5 backdrop-blur">
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
                  </>
                ) : (
                  <div className="grid h-full place-items-center">
                    {busy ? (
                      <span className="text-muted-foreground text-xs">Sampling terrain…</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 px-2.5 text-xs"
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload />
                        Open mission
                      </Button>
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
                    survey={survey}
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
                    modelYaw={modelYaw}
                    setModelYaw={setModelYaw}
                    onPickModel={() => modelRef.current?.click()}
                    onClearModel={() => {
                      if (model) URL.revokeObjectURL(model.url)
                      setModel(null)
                    }}
                    kind={kind}
                    setKind={(k) => {
                      setKind(k)
                      setProfile(PROFILES[k])
                      if (textRef.current) run(textRef.current, PROFILES[k])
                    }}
                    survey={survey}
                    selection={selection}
                    profile={profile}
                    setProfile={setProfile}
                    threshold={threshold}
                    setThreshold={setThreshold}
                    busy={busy}
                    onRerun={() => textRef.current && run(textRef.current)}
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
