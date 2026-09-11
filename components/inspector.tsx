'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { turnRadiusFor, type VehicleProfile } from '@/lib/trajectory'
import type { Selection, Survey } from '@/lib/survey'

const m = (v: number) => `${v.toFixed(0)} m`

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-border/60 border-b py-2">
      <div className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
        {title}
      </div>
      <div className="space-y-0.5 px-3">{children}</div>
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
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={cn(
          'truncate text-right tabular-nums',
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
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        {label} <span className="opacity-60">{unit}</span>
      </span>
      <Input
        type="number"
        value={Math.round(value * 10) / 10}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-20 px-1.5 text-right text-xs tabular-nums"
      />
    </div>
  )
}

export function Inspector({
  survey,
  selection,
  profile,
  setProfile,
  threshold,
  setThreshold,
  onRerun,
  busy,
}: {
  survey: Survey | null
  selection: Selection | null
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
        {sel.kind === 'mission' && (
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
                value={`${Math.floor(survey.durationS / 60)}m ${Math.round(survey.durationS % 60)}s`}
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
            <Field label="Planned as" value={`${survey.waypoints[sel.index].planned} (${survey.waypoints[sel.index].frame})`} />
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
