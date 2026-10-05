import { Download, LocateFixed, Radio, Unplug } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import type { Telemetry } from '@/lib/mavlink'
import { cn } from '@/lib/utils'

function TelemetryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-baseline gap-2 py-[3px] text-base">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="min-w-0 tabular-nums">{children}</span>
    </div>
  )
}

type MavlinkPanelProps = {
  enabled: boolean
  telemetry: Telemetry | null
  error: string | null
  notice: string | null
  busy: boolean
  onToggle: () => void
  onLocate: () => void
  onDownload: () => void
}

export function MavlinkActions({ enabled, telemetry, busy, onLocate }: MavlinkPanelProps) {
  const disabled = !enabled || !telemetry?.connected || !telemetry.position || busy
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Locate vehicle" disabled={disabled} focusableWhenDisabled className="data-disabled:opacity-50" onClick={onLocate} />}>
        <LocateFixed />
      </TooltipTrigger>
      <TooltipContent>Locate vehicle</TooltipContent>
    </Tooltip>
  )
}

export function MavlinkDownload({ enabled, telemetry, busy, onDownload }: MavlinkPanelProps) {
  const label = busy ? 'Loading mission…' : 'Download mission'
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label={label} disabled={!enabled || !telemetry?.connected || busy} focusableWhenDisabled className="data-disabled:opacity-50" onClick={onDownload} />}>
        <Download />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MavlinkConnect({ enabled, onToggle }: Pick<MavlinkPanelProps, 'enabled' | 'onToggle'>) {
  const label = enabled ? 'Disconnect MAVLink' : 'Connect MAVLink'
  const Icon = enabled ? Unplug : Radio
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label={label} onClick={onToggle} />}>
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MavlinkStatus({ enabled, telemetry, error }: Pick<MavlinkPanelProps, 'enabled' | 'telemetry' | 'error'>) {
  const live = telemetry?.connected ?? false
  return (
    <span role="status" className={cn('flex items-center gap-1.5 text-base font-normal', enabled && live ? 'text-teal-500' : 'text-muted-foreground')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', enabled && live ? 'bg-teal-500' : 'bg-muted-foreground')} />
      {!enabled ? 'Disconnected' : live ? `System ${telemetry?.vehicle?.systemId} connected` : error ? 'Bridge offline' : telemetry?.heartbeatAge != null ? 'Signal lost' : 'Waiting for vehicle…'}
    </span>
  )
}

export function MavlinkPanel({ enabled, telemetry, error, notice }: MavlinkPanelProps) {
  const live = telemetry?.connected ?? false
  const position = live ? telemetry?.position : null
  const vehicle = live ? telemetry?.vehicle : null
  const battery = live ? telemetry?.battery : null
  if (!enabled && !notice) return null
  return (
    <div aria-label="MAVLink vehicle" className="mt-1 text-base">
      {enabled && <>
        {vehicle && <>
          <TelemetryRow label="Flight mode">{vehicle.mode}</TelemetryRow>
          <TelemetryRow label="Arming">{vehicle.armed ? 'Armed' : 'Disarmed'}</TelemetryRow>
        </>}
        {position && <>
          <TelemetryRow label="Altitude AMSL">{position.altAmsl.toFixed(1)} m</TelemetryRow>
          <TelemetryRow label="Relative altitude">{position.relativeAlt.toFixed(1)} m</TelemetryRow>
          <TelemetryRow label="Ground speed">{position.groundSpeed.toFixed(1)} m/s</TelemetryRow>
          <TelemetryRow label="Heading">{position.heading == null ? '—' : `${position.heading.toFixed(0)}°`}</TelemetryRow>
        </>}
        {battery && <TelemetryRow label="Battery">
          {battery.remaining == null ? '—' : `${battery.remaining}%`}
          {battery.voltage != null && ` (${battery.voltage.toFixed(1)} V)`}
        </TelemetryRow>}
      </>}
      {enabled && error && <p role="alert" className="text-destructive mt-1.5 text-base">{error}</p>}
      {enabled && !error && live && !position && <p className="text-muted-foreground mt-1.5 text-base">Waiting for a valid vehicle position…</p>}
      {notice && <p role="status" className="text-muted-foreground mt-1.5 text-base">{notice}</p>}
    </div>
  )
}
