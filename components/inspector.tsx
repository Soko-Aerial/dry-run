'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { RefreshCw, Trash2, Upload } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { turnRadiusFor, type VehicleProfile } from '@/lib/trajectory'
import type { Selection, Survey } from '@/lib/survey'

const ModelPreview = dynamic(() => import('@/components/model-preview'), { ssr: false })

const m = (v: number) => `${v.toFixed(0)} m`

// One property row shape everywhere: muted label in a fixed column, value
// left-aligned in the next, so values line up down the whole panel.
const ROW = 'grid grid-cols-[minmax(0,9.5rem)_1fr] gap-2 py-[3px] text-xs'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-border/60 border-b py-2">
      <div className="px-3 pb-1.5 text-[11px] font-medium">{title}</div>
      <div className="px-3">{children}</div>
    </div>
  )
}

function Field({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: 'bad' | 'good'
}) {
  return (
    <div className={cn(ROW, 'items-baseline')}>
      <span className="text-muted-foreground truncate">{label}</span>
      <span
        className={cn(
          'truncate tabular-nums',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-emerald-500',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
}) {
  // Holds what is typed, so "-" and "" survive long enough to become "-90".
  // A plain controlled number input snapped an emptied field straight back to 0.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div className={cn(ROW, 'items-center')}>
      <span className="text-muted-foreground truncate">
        {label} <span className="opacity-60">{unit}</span>
      </span>
      <Input
        type="text"
        inputMode="numeric"
        value={draft ?? String(Math.round(value * 10) / 10)}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          const n = Number(v)
          if (v.trim() !== '' && Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setDraft(null)}
        className="h-6 w-20 px-1.5 text-xs tabular-nums"
      />
    </div>
  )
}

export function Inspector({
  kind,
  setKind,
  modelName,
  modelUrl,
  modelYaw,
  onPickModel,
  onClearModel,
  survey,
  selection,
  onRemoveWaypoint,
  onSetWaypointAlt,
  profile,
  setProfile,
  threshold,
  setThreshold,
  onRerun,
  busy,
}: {
  kind: 'fixedwing' | 'multirotor'
  setKind: (k: 'fixedwing' | 'multirotor') => void
  modelName: string | null
  modelUrl: string | null
  modelYaw: number
  onPickModel: () => void
  onClearModel: () => void
  survey: Survey | null
  selection: Selection | null
  onRemoveWaypoint: (i: number) => void
  onSetWaypointAlt: (i: number, alt: number) => void
  profile: VehicleProfile
  setProfile: (p: VehicleProfile) => void
  threshold: number
  setThreshold: (v: number) => void
  onRerun: () => void
  busy: boolean
}) {
  const sel = selection ?? { kind: 'mission' as const }

  const vehicle = (
    <>
      <Section title="Vehicle">
        <div className={cn(ROW, 'items-center')}>
          <span className="text-muted-foreground truncate">Type</span>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as 'fixedwing' | 'multirotor')}
          >
            <SelectTrigger size="sm" className="h-6 w-full px-2 text-xs">
              <SelectValue>
                {(v: string) => (v === 'fixedwing' ? 'Fixed-wing' : 'Multirotor')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixedwing" className="text-xs">
                Fixed-wing
              </SelectItem>
              <SelectItem value="multirotor" className="text-xs">
                Multirotor
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(
          [
            ['cruiseMs', 'Cruise speed', 'm/s'],
            ['maxBankDeg', 'Max bank', '°'],
            ['turnRadiusM', 'Turn radius', 'm'],
            ['maxClimbMs', 'Max climb', 'm/s'],
            ['maxDescentMs', 'Max descent', 'm/s'],
          ] as const
        ).map(([key, label, unit]) => (
          <NumberField
            key={key}
            label={label}
            unit={unit}
            value={profile[key]}
            onChange={(v) => {
              const next = { ...profile, [key]: v }
              // radius follows speed and bank unless overridden directly
              if (key === 'cruiseMs' || key === 'maxBankDeg') {
                next.turnRadiusM = turnRadiusFor(next.cruiseMs, next.maxBankDeg)
              }
              setProfile(next)
            }}
          />
        ))}
        <div className={cn(ROW, 'items-center')}>
          <span className="text-muted-foreground truncate">Model</span>
          {modelName ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate" title={modelName}>
                {modelName}
              </span>
              <ButtonGroup className="ml-auto shrink-0">
                <Button
                  size="icon-sm"
                  variant="secondary"
                  aria-label="Replace model"
                  onClick={onPickModel}
                >
                  <RefreshCw />
                </Button>
                <ButtonGroupSeparator />
                <Button
                  size="icon-sm"
                  variant="secondary"
                  aria-label="Remove model"
                  onClick={onClearModel}
                >
                  <Trash2 />
                </Button>
              </ButtonGroup>
            </div>
          ) : (
            <Button size="xs" variant="secondary" onClick={onPickModel} className="justify-start">
              <Upload />
              Import .glb
            </Button>
          )}
        </div>
        {modelUrl && (
          <div className="bg-muted/40 border-border/60 mt-1 overflow-hidden rounded-md border">
            <ModelPreview url={modelUrl} yawDeg={modelYaw} />
          </div>
        )}
      </Section>
      <Section title="Check">
        <NumberField
          label="Min clearance"
          unit="m"
          value={threshold}
          onChange={setThreshold}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={onRerun}
          className="mt-1 h-6 w-full text-xs"
        >
          {busy ? 'Sampling terrain…' : 'Re-run survey'}
        </Button>
      </Section>
    </>
  )

  if (!survey) {
    return (
      <ScrollArea className="h-full">
        <div className="py-1">{vehicle}</div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {sel.kind === 'mission' && survey.verdict === null && (
          <>
            <Section title="Site">
              <p className="text-muted-foreground pb-1 text-xs">
                Terrain loaded, no path yet. Drop two waypoints to get a verdict.
              </p>
              <Field label="Waypoints" value={survey.waypoints.length} />
              <Field label="Launch elevation" value={m(survey.launchAmsl)} />
            </Section>
            {vehicle}
          </>
        )}

        {sel.kind === 'mission' && survey.verdict !== null && (
          <>
            <Section title="Verdict">
              <div className="flex items-center gap-2 pb-1">
                <Badge
                  variant={survey.verdict === 'GO' ? 'secondary' : 'destructive'}
                  className="rounded-sm px-1.5 text-[11px]"
                >
                  {survey.verdict}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {survey.verdict === 'GO'
                    ? 'no terrain conflict'
                    : `${survey.issues.length} issue(s)`}
                </span>
              </div>
              <ul className="text-destructive space-y-1 text-xs">
                {survey.issues.map((i, n) => (
                  <li key={n}>• {i}</li>
                ))}
              </ul>
            </Section>
            <Section title="Mission">
              <Field label="Source" value={survey.mission.source} />
              <Field label="Waypoints" value={survey.waypoints.length} />
              <Field label="Distance" value={`${(survey.distanceM / 1000).toFixed(2)} km`} />
              <Field
                label="Flight time"
                value={`${Math.floor(survey.durationS / 60)}m ${(survey.durationS % 60).toFixed(3)}s`}
              />
              <Field
                label="Min clearance"
                value={`${m(survey.minClearance)} · leg ${survey.minClearanceLeg + 1}`}
                tone={survey.minClearance < threshold ? 'bad' : 'good'}
              />
            </Section>
            {vehicle}
          </>
        )}

        {sel.kind === 'vehicle' && vehicle}

        {sel.kind === 'terrain' && (
          <Section title="Terrain">
            {survey.grid.suspect && (
              <p className="text-destructive pb-1 text-xs">{survey.grid.suspect}</p>
            )}
            {survey.grid.synthetic && (
              <p className="pb-1 text-xs text-amber-500">
                Synthetic terrain — no Mapbox token. Heights are fake.
              </p>
            )}
            <Field
              label="Highest"
              value={`${m(survey.highestTerrain)} (${m(survey.highestTerrain - survey.launchAmsl)} above launch)`}
            />
            <Field label="Lowest" value={m(survey.lowestTerrain)} />
            <Field label="Launch elevation" value={m(survey.launchAmsl)} />
            <Field label="Area" value="route ±550 m" />
            <Field label="Tiles" value={`z${survey.grid.z} · ${survey.grid.width}×${survey.grid.height} px`} />
          </Section>
        )}

        {sel.kind === 'waypoint' && (
          <Section title={`Waypoint ${sel.index + 1}`}>
            <Field label="Latitude" value={survey.waypoints[sel.index].lat.toFixed(7)} />
            <Field label="Longitude" value={survey.waypoints[sel.index].lon.toFixed(7)} />
            {/* edits the number as planned, in the waypoint's own frame — the
                AMSL below is what that becomes once terrain is applied */}
            <NumberField
              key={sel.index}
              label={`Altitude (${survey.waypoints[sel.index].frame})`}
              unit="m"
              value={survey.waypoints[sel.index].planned}
              onChange={(v) => onSetWaypointAlt(sel.index, v)}
            />
            <Field label="Altitude AMSL" value={m(survey.waypoints[sel.index].alt)} />
            <Field
              label="Above launch"
              value={m(survey.waypoints[sel.index].alt - survey.launchAmsl)}
            />
            <Field
              label="Above ground"
              value={m(survey.waypointClearance[sel.index])}
              tone={survey.waypointClearance[sel.index] < threshold ? 'bad' : 'good'}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={survey.waypoints.length <= 2}
              onClick={() => onRemoveWaypoint(sel.index)}
              className="mt-1.5 h-6 w-full text-xs"
            >
              <Trash2 />
              Remove waypoint
            </Button>
          </Section>
        )}

        {sel.kind === 'leg' && (
          <Section title={`Leg ${sel.index + 1} → ${sel.index + 2}`}>
            <Field label="Length" value={m(survey.demands[sel.index].lengthM)} />
            <Field
              label="Climb demanded"
              value={`${survey.demands[sel.index].climbRateRequired.toFixed(1)} m/s`}
              tone={survey.demands[sel.index].exceeded ? 'bad' : undefined}
            />
            <Field label="Aircraft limit" value={`${survey.demands[sel.index].limit} m/s`} />
            <Field
              label="Min clearance"
              value={m(survey.legMinClearance[sel.index])}
              tone={survey.legMinClearance[sel.index] < threshold ? 'bad' : 'good'}
            />
          </Section>
        )}
      </div>
    </ScrollArea>
  )
}
