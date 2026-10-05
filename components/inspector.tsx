import { lazy, Suspense, useState } from 'react'
import { Check, X, Minus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { cn } from '@/lib/utils'
import { turnRadiusFor, type VehicleProfile } from '@/lib/trajectory'
import type { Selection, Survey } from '@/lib/survey'

const ModelPreview = lazy(() => import('@/components/model-preview'))

const m = (v: number) => `${v.toFixed(0)} m`

// One property row shape everywhere: muted label in a fixed column, value
// left-aligned in the next, so values line up down the whole panel.
const ROW = 'grid grid-cols-[minmax(0,9.5rem)_1fr] gap-2 py-[3px] text-base'

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="border-border/60 border-b py-2">
      <div className="flex items-center gap-2 px-3 pb-1.5 text-base font-medium">
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </div>
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
  className,
  result,
}: {
  result?: React.ReactNode
  className?: string
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
}) {
  // Holds what is typed, so "-" and "" survive long enough to become "-90".
  // A plain controlled number input snapped an emptied field straight back to 0.
  const [draft, setDraft] = useState<string | null>(null)

  const Control = result ? InputGroupInput : Input
  const input = (
    <Control
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? String(Math.round(value * 10) / 10)}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        const n = Number(v)
        if (v.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => setDraft(null)}
      className={cn('h-6 px-1.5 text-base tabular-nums', !result && 'w-20')}
    />
  )

  return (
    <div className={cn(ROW, 'items-center', result && 'grid-cols-[minmax(0,1fr)_auto]', className)}>
      <span className="text-muted-foreground truncate">
        {label} <span className="opacity-60">{unit}</span>
      </span>
      {result ? (
        <InputGroup className="h-6 w-24">
          {input}
          <InputGroupAddon align="inline-end" className="py-0 pr-1.5">
            {result}
          </InputGroupAddon>
        </InputGroup>
      ) : input}
    </div>
  )
}

export function CheckControls({ threshold, setThreshold, onRerun, busy, survey, profile, setProfile }: {
  threshold: number
  setThreshold: (value: number) => void
  onRerun: () => void
  busy: boolean
  survey: Survey | null
  profile: VehicleProfile
  setProfile: (profile: VehicleProfile) => void
}) {
  const checked = survey !== null && survey.verdict !== null
  const stale = checked && (threshold !== survey.checkSettings.threshold ||
    JSON.stringify(profile) !== JSON.stringify(survey.checkSettings.profile))
  const pending = busy ? 'Checking…' : !checked ? 'Not checked' : stale ? 'Needs recheck' : null
  const terrainUnavailable = survey?.grid.synthetic || survey?.grid.suspect
  const climb = Math.max(0, ...(survey?.demands.map((d) => d.climbRateRequired) ?? []))
  const descent = Math.max(0, ...(survey?.demands.map((d) => -d.climbRateRequired) ?? []))
  const results = [
    { name: 'Min clearance', unit: 'm', value: threshold, onChange: setThreshold, pass: !terrainUnavailable && (survey?.minClearance ?? 0) >= threshold,
      pending: pending ?? (terrainUnavailable ? 'Terrain unavailable' : null) },
    { name: 'Max climb rate', unit: 'm/s', value: profile.maxClimbMs, onChange: (value: number) => setProfile({ ...profile, maxClimbMs: value }), pass: climb <= profile.maxClimbMs, pending },
    { name: 'Max descent rate', unit: 'm/s', value: profile.maxDescentMs, onChange: (value: number) => setProfile({ ...profile, maxDescentMs: value }), pass: descent <= profile.maxDescentMs, pending },
  ]
  const failed = results.some((r) => !r.pending && !r.pass)
  const incomplete = results.some((r) => r.pending)
  return (
    <Section title="Checks" action={
      <Tooltip>
        <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Re-run checks" disabled={busy || !survey?.waypoints.length} focusableWhenDisabled className="data-disabled:opacity-50" onClick={onRerun} />}>
          <RefreshCw className={cn(busy && 'animate-spin')} />
        </TooltipTrigger>
        <TooltipContent>{busy ? 'Checking…' : 'Re-run checks'}</TooltipContent>
      </Tooltip>
    }>
      <p role="status" className={cn('mb-2 text-base', !pending && failed && 'text-destructive', !pending && !failed && !incomplete && 'text-emerald-500')}>
        {pending ?? (failed ? 'Checks failed' : incomplete ? 'Checks incomplete' : 'Checks passed')}
      </p>
      <div>
        {results.map((result) => {
          const Icon = result.pending ? Minus : result.pass ? Check : X
          const state = result.pending ?? (result.pass ? 'Pass' : 'Fail')
          return (
            <div key={result.name}>
              <NumberField
                label={result.name}
                unit={result.unit}
                value={result.value}
                onChange={result.onChange}
                result={<Icon role="img" aria-label={state} className={cn('size-4 shrink-0', result.pending ? 'text-muted-foreground' : result.pass ? 'text-emerald-500' : 'text-destructive')} />}
              />
            </div>
          )
        })}
      </div>
      {survey?.mission.warnings.map((warning, index) => <p key={index} className="mt-1 text-base text-amber-600">{warning}</p>)}
    </Section>
  )
}

export function Inspector({
  vehicleConnection,
  connectionActions,
  vehicleActions,
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
}: {
  vehicleConnection: React.ReactNode
  connectionActions: React.ReactNode
  vehicleActions: React.ReactNode
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
}) {
  const sel = selection ?? { kind: 'mission' as const }

  const vehicle = (
    <>
      <Section title="Vehicle" action={vehicleActions}>
        <div className={cn(ROW, 'items-center')}>
          <span className="text-muted-foreground truncate">Type</span>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as 'fixedwing' | 'multirotor')}
          >
            <SelectTrigger size="sm" className="h-6 w-full px-2 text-base">
              <SelectValue>
                {(v: string) => (v === 'fixedwing' ? 'Fixed-wing' : 'Multirotor')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixedwing" className="text-base">
                Fixed-wing
              </SelectItem>
              <SelectItem value="multirotor" className="text-base">
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
                  size="icon"
                  variant="secondary"
                  aria-label="Replace model"
                  onClick={onPickModel}
                >
                  <RefreshCw />
                </Button>
                <ButtonGroupSeparator />
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Remove model"
                  onClick={onClearModel}
                >
                  <Trash2 />
                </Button>
              </ButtonGroup>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={onPickModel} className="justify-start">
              <Upload />
              Import .glb
            </Button>
          )}
        </div>
        {modelUrl && (
          <div className="bg-muted/40 border-border/60 mt-1 overflow-hidden rounded-md border">
            <Suspense><ModelPreview url={modelUrl} yawDeg={modelYaw} /></Suspense>
          </div>
        )}
      </Section>
      <Section title="MAVLink Connection" action={connectionActions}>
        {vehicleConnection}
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
              <p className="text-muted-foreground pb-1 text-base">
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
                value={`${m(survey.minClearance)} on leg ${survey.minClearanceLeg + 1}`}
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
              <p className="text-destructive pb-1 text-base">{survey.grid.suspect}</p>
            )}
            {survey.grid.synthetic && (
              <p className="pb-1 text-base text-amber-500">
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
            <Field label="Tiles" value={`z${survey.grid.z}, ${survey.grid.width}×${survey.grid.height} px`} />
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
              className="mt-1.5 h-6 w-full text-base"
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
