import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Pause, Play, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Selection, Survey } from '@/lib/survey'

/**
 * Clearance profile: terrain silhouette with the flight line above it, against
 * distance flown. This is the view where a conflict is obvious at a glance —
 * in 3D, perspective hides vertical gaps.
 *
 * Palette validated with the dataviz validator against the real panel surfaces
 * (#171717 dark, #ffffff light): all six checks pass in both modes.
 */

const PAD = { top: 10, right: 12, bottom: 18, left: 44 }

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

function ClearanceProfile({
  survey,
  threshold,
  head,
  selectedLeg,
  onSelectLeg,
}: {
  survey: Survey
  threshold: number
  head: number
  selectedLeg: number
  onSelectLeg: (i: number) => void
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const traj = survey.traj
  const geom = useMemo(() => {
    const maxS = traj[traj.length - 1].s ?? 1
    let lo = Infinity
    let hi = -Infinity
    for (const p of traj) {
      lo = Math.min(lo, p.terrain!)
      hi = Math.max(hi, p.alt, p.terrain! + threshold)
    }
    const pad = Math.max(20, (hi - lo) * 0.12)
    return { maxS, lo: lo - pad * 0.3, hi: hi + pad }
  }, [traj, threshold])

  const iw = Math.max(1, w - PAD.left - PAD.right)
  const ih = Math.max(1, h - PAD.top - PAD.bottom)
  const x = (s: number) => PAD.left + (s / geom.maxS) * iw
  const y = (alt: number) => PAD.top + (1 - (alt - geom.lo) / (geom.hi - geom.lo)) * ih

  // one sample per ~1.5px is plenty and keeps the path small
  const step = Math.max(1, Math.floor(traj.length / Math.max(1, iw / 1.5)))
  const pts = useMemo(() => {
    const out: typeof traj = []
    for (let i = 0; i < traj.length; i += step) out.push(traj[i])
    if (out[out.length - 1] !== traj[traj.length - 1]) out.push(traj[traj.length - 1])
    return out
  }, [traj, step])

  if (w < 80 || h < 60) return <div ref={ref} className="h-full w-full" />

  const terrainPath =
    `M ${x(0)} ${y(pts[0].terrain!)} ` +
    pts.map((p) => `L ${x(p.s!)} ${y(p.terrain!)}`).join(' ') +
    ` L ${x(geom.maxS)} ${PAD.top + ih} L ${x(0)} ${PAD.top + ih} Z`

  const bandPath =
    `M ${x(0)} ${y(pts[0].terrain! + threshold)} ` +
    pts.map((p) => `L ${x(p.s!)} ${y(p.terrain! + threshold)}`).join(' ') +
    ` ` +
    [...pts].reverse().map((p) => `L ${x(p.s!)} ${y(p.terrain!)}`).join(' ') +
    ' Z'

  const bandTop =
    'M ' + pts.map((p) => `${x(p.s!)} ${y(p.terrain! + threshold)}`).join(' L ')

  const flightPath = 'M ' + pts.map((p) => `${x(p.s!)} ${y(p.alt)}`).join(' L ')

  // violating stretches, drawn over the flight line in the critical colour
  const bad: string[] = []
  let run: string[] = []
  for (const p of pts) {
    if (p.clearance! < threshold) run.push(`${x(p.s!)} ${y(p.alt)}`)
    else if (run.length) {
      if (run.length > 1) bad.push('M ' + run.join(' L '))
      run = []
    }
  }
  if (run.length > 1) bad.push('M ' + run.join(' L '))

  // selected leg, same amber as the 3D highlight so the two views agree
  const legRun = pts.filter((p) => p.legIndex === selectedLeg)
  const legPath =
    legRun.length > 1 ? 'M ' + legRun.map((p) => `${x(p.s!)} ${y(p.alt)}`).join(' L ') : null

  const worst = traj.reduce((a, b) => (b.clearance! < a.clearance! ? b : a))
  const cur = traj[Math.min(head, traj.length - 1)]
  const hoverPt = hover == null ? null : traj[Math.min(hover, traj.length - 1)]

  const atX = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const s = ((clientX - rect.left - PAD.left) / iw) * geom.maxS
    let lo = 0
    let hi = traj.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((traj[mid].s ?? 0) < s) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const yTicks = 4
  const xTicks = 5

  return (
    <div
      ref={ref}
      className="relative h-full w-full select-none"
      onPointerDown={(e) => {
        const i = atX(e.clientX)
        onSelectLeg(traj[i].legIndex)
      }}
      onPointerMove={(e) => {
        setHover(atX(e.clientX))
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={w} height={h} className="block">
        {/* recessive grid + axes */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const alt = geom.lo + ((geom.hi - geom.lo) * i) / yTicks
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={PAD.left + iw}
                y1={y(alt)}
                y2={y(alt)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 5}
                y={y(alt) + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[12px] tabular-nums"
              >
                {alt.toFixed(0)}
              </text>
            </g>
          )
        })}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const s = (geom.maxS * i) / xTicks
          return (
            <text
              key={i}
              x={x(s)}
              y={h - 5}
              textAnchor={i === 0 ? 'start' : i === xTicks ? 'end' : 'middle'}
              className="fill-muted-foreground text-[12px] tabular-nums"
            >
              {(s / 1000).toFixed(2)} km
            </text>
          )
        })}

        {/* Minimum-clearance band, terrain surface up to the threshold. Neutral
            by design: red is reserved for an actual breach, and painting the
            band red makes a mission that clears by 94m look alarming. */}
        <path d={bandPath} fill="var(--muted-foreground)" opacity={0.16} />
        <path
          d={bandTop}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <path d={terrainPath} fill="var(--viz-terrain)" />

        {/* waypoint ticks */}
        {survey.demands.map((_, i) => {
          const p = traj.find((t) => t.legIndex === i)
          if (!p) return null
          return (
            <line
              key={i}
              x1={x(p.s!)}
              x2={x(p.s!)}
              y1={PAD.top}
              y2={PAD.top + ih}
              className="stroke-border"
              strokeDasharray="2 3"
            />
          )
        })}

        <path d={flightPath} fill="none" stroke="var(--viz-flight)" strokeWidth={2} />
        {bad.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--viz-critical)" strokeWidth={3} />
        ))}

        {legPath && (
          <path
            d={legPath}
            fill="none"
            stroke="var(--viz-selected)"
            strokeWidth={3}
            strokeDasharray="4 3"
          />
        )}

        {/* worst point: marker + label, never colour alone. The label itself is
            HTML below, so it can use the same icon as the rest of the app. */}
        {worst.clearance! < threshold && (
          <circle cx={x(worst.s!)} cy={y(worst.alt)} r={4} fill="var(--viz-critical)" />
        )}

        {/* direct labels instead of a legend box */}
        <text
          x={PAD.left + 4}
          y={PAD.top + 10}
          className="fill-muted-foreground text-[12px]"
        >
          flight path
        </text>
        <text
          x={PAD.left + 4}
          y={Math.min(PAD.top + ih - 4, y(pts[0].terrain!) + 12)}
          className="fill-muted-foreground text-[12px]"
        >
          terrain
        </text>
        <text
          x={PAD.left + iw - 4}
          y={y(pts[pts.length - 1].terrain! + threshold) - 4}
          textAnchor="end"
          className="fill-muted-foreground text-[12px] tabular-nums"
        >
          min {threshold} m
        </text>

        {hoverPt && (
          <line
            x1={x(hoverPt.s!)}
            x2={x(hoverPt.s!)}
            y1={PAD.top}
            y2={PAD.top + ih}
            className="stroke-muted-foreground"
            strokeWidth={1}
          />
        )}
        <line
          x1={x(cur.s ?? 0)}
          x2={x(cur.s ?? 0)}
          y1={0}
          y2={PAD.top + ih}
          className="stroke-foreground"
          strokeWidth={2}
        />
      </svg>

      {worst.clearance! < threshold && (
        <div
          className="text-foreground pointer-events-none absolute flex items-center gap-1 whitespace-nowrap text-[12px] font-medium tabular-nums"
          style={{
            left: x(worst.s!),
            top: y(worst.alt) - 20,
            transform:
              x(worst.s!) > PAD.left + iw * 0.7
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          <TriangleAlert className="text-destructive size-3" />
          {worst.clearance!.toFixed(0)} m on leg {worst.legIndex + 1}
        </div>
      )}

      {hoverPt && (
        <div
          className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-2 rounded-sm border px-2 py-1 text-[12px] whitespace-nowrap tabular-nums shadow-sm"
          style={{ left: Math.min(w - 150, Math.max(0, x(hoverPt.s!) + 8)) }}
        >
          <div>{(hoverPt.s! / 1000).toFixed(2)} km on leg {hoverPt.legIndex + 1}</div>
          <div className="text-muted-foreground">
            {hoverPt.alt.toFixed(0)} m AMSL, ground {hoverPt.terrain!.toFixed(0)} m
          </div>
          <div className={cn(hoverPt.clearance! < threshold && 'text-destructive')}>
            {hoverPt.clearance! < threshold && <TriangleAlert className="mr-1 inline size-3" />}
            {hoverPt.clearance!.toFixed(0)} m clearance
          </div>
        </div>
      )}
    </div>
  )
}

export function Timeline({
  survey,
  threshold,
  head,
  setHead,
  headRef,
  playing,
  setPlaying,
  speed,
  setSpeed,
  selection,
  onSelect,
}: {
  survey: Survey | null
  threshold: number
  head: number
  setHead: (i: number) => void
  headRef: React.RefObject<number>
  playing: boolean
  setPlaying: (v: boolean) => void
  speed: number
  setSpeed: (v: number) => void
  selection: Selection | null
  onSelect: (s: Selection) => void
}) {
  const scrub = useCallback(
    (i: number) => {
      headRef.current = i
      setHead(i)
    },
    [headRef, setHead],
  )

  const scrubDistance = useCallback(
    (distance: number) => {
      if (!survey) return
      let lo = 0
      let hi = survey.traj.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if ((survey.traj[mid].s ?? 0) < distance) lo = mid + 1
        else hi = mid
      }
      scrub(lo)
    },
    [survey, scrub],
  )

  if (!survey) {
    return (
      <div className="text-muted-foreground flex h-full items-center px-3 text-[12px]">
        Timeline
      </div>
    )
  }

  const cur = survey.traj[Math.min(head, survey.traj.length - 1)]
  const seekerMax = Math.max(1, survey.distanceM)
  const seekerPosition = Math.min(seekerMax, cur.s ?? 0)

  return (
    <div className="flex h-full flex-col">
      <div className="border-border/60 flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[12px]">
        <Button
          size="icon"
          variant="secondary"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (headRef.current >= survey.traj.length - 1) scrub(0)
            setPlaying(!playing)
          }}
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
          <SelectTrigger
            size="sm"
            aria-label="Playback speed"
            className="h-6 w-[84px] gap-1 px-2 text-[12px]"
          >
            <Gauge className="text-muted-foreground size-3.5 shrink-0" />
            <SelectValue>{(v: string) => `${v}×`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 4, 8, 16].map((s) => (
              <SelectItem key={s} value={String(s)} className="text-[12px]">
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground tabular-nums">
          t {cur.t.toFixed(3)}s / {survey.durationS.toFixed(3)}s
        </span>
        <span className="text-muted-foreground tabular-nums">
          {(cur.s! / 1000).toFixed(2)} km
        </span>
        <span className="ml-auto tabular-nums">{cur.alt.toFixed(0)} m AMSL</span>
        <span
          className={cn(
            'tabular-nums',
            cur.clearance! < threshold ? 'text-destructive' : 'text-emerald-500',
          )}
        >
          {cur.clearance!.toFixed(0)} m AGL
        </span>
      </div>
      <div
        className="flex h-8 shrink-0 items-center"
        style={{ paddingLeft: PAD.left, paddingRight: PAD.right }}
      >
        <div className="border-border relative h-full w-full border-b">
          {Array.from({ length: 21 }, (_, i) => {
            const major = i % 5 === 0
            const ratio = i / 20
            return (
              <span
                key={i}
                aria-hidden="true"
                className={cn(
                  'bg-muted-foreground/60 absolute bottom-0 w-px',
                  major ? 'h-2' : 'h-1',
                )}
                style={{ left: `${ratio * 100}%` }}
              >
                {major && (
                  <span
                    className="text-muted-foreground absolute bottom-2.5 text-[12px] tabular-nums"
                    style={{ transform: `translateX(${i === 0 ? '0' : i === 20 ? '-100%' : '-50%'})` }}
                  >
                    {(survey.durationS * ratio).toFixed(1)}s
                  </span>
                )}
              </span>
            )
          })}
          <input
            type="range"
            aria-label="Flight playback position"
            min={0}
            max={seekerMax}
            step={Math.max(1, seekerMax / (survey.traj.length - 1))}
            value={seekerPosition}
            onChange={(e) => scrubDistance(Number(e.target.value))}
            className="absolute inset-0 z-10 size-full cursor-ew-resize opacity-0"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 -bottom-0.5 w-2 -translate-x-1/2"
            style={{ left: `${(seekerPosition / seekerMax) * 100}%` }}
          >
            <span className="absolute top-0 left-1/2 size-0 -translate-x-1/2 border-x-4 border-t-7 border-x-transparent border-t-foreground" />
            <span className="bg-foreground absolute top-1.5 bottom-0 left-1/2 w-0.5 -translate-x-1/2" />
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ClearanceProfile
          survey={survey}
          threshold={threshold}
          head={head}
          selectedLeg={selection?.kind === 'leg' ? selection.index : -1}
          onSelectLeg={(i) => onSelect({ kind: 'leg', index: i })}
        />
      </div>
    </div>
  )
}
