'use client'

import { useState } from 'react'
import {
  ChevronRight,
  Mountain,
  MapPin,
  Plane,
  Route,
  TriangleAlert,
  FolderOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Selection, Survey } from '@/lib/survey'

const same = (a: Selection | null, b: Selection) =>
  !!a &&
  a.kind === b.kind &&
  ('index' in a ? a.index : -1) === ('index' in b ? b.index : -1)

function Row({
  depth = 0,
  icon: Icon,
  label,
  detail,
  warn,
  active,
  onClick,
  expandable,
  open,
  onToggle,
}: {
  depth?: number
  icon?: React.ComponentType<{ className?: string }>
  label: string
  detail?: string
  warn?: boolean
  active?: boolean
  onClick?: () => void
  expandable?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  return (
    <div
      role="treeitem"
      aria-selected={active}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={cn(
        'group flex h-6 cursor-default items-center gap-1 rounded-sm pr-2 text-xs outline-none',
        'hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-2',
        active && 'bg-accent text-accent-foreground',
      )}
      style={{ paddingLeft: depth * 12 + 4 }}
    >
      {expandable ? (
        <button
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      {Icon && <Icon className="text-muted-foreground size-3 shrink-0" />}
      <span className="truncate">{label}</span>
      {warn && <TriangleAlert className="text-destructive size-3 shrink-0" />}
      <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">{detail}</span>
    </div>
  )
}

export function MissionTree({
  survey,
  fileName,
  selection,
  onSelect,
  threshold,
}: {
  survey: Survey | null
  fileName: string | null
  selection: Selection | null
  onSelect: (s: Selection) => void
  threshold: number
}) {
  const [openWps, setOpenWps] = useState(true)
  const [openLegs, setOpenLegs] = useState(false)

  if (!survey) {
    return (
      <div className="text-muted-foreground p-3 text-xs">No mission loaded</div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div role="tree" className="p-1">
        <Row
          icon={FolderOpen}
          label={fileName ?? 'mission'}
          detail={survey.verdict}
          warn={survey.verdict === 'NO-GO'}
          active={same(selection, { kind: 'mission' })}
          onClick={() => onSelect({ kind: 'mission' })}
        />
        <Row
          depth={1}
          icon={Plane}
          label="Vehicle"
          active={same(selection, { kind: 'vehicle' })}
          onClick={() => onSelect({ kind: 'vehicle' })}
        />
        <Row
          depth={1}
          icon={Mountain}
          label="Terrain"
          detail={`${survey.highestTerrain.toFixed(0)} m`}
          warn={!!survey.grid.suspect}
          active={same(selection, { kind: 'terrain' })}
          onClick={() => onSelect({ kind: 'terrain' })}
        />

        <Row
          depth={1}
          icon={MapPin}
          label="Waypoints"
          detail={String(survey.waypoints.length)}
          expandable
          open={openWps}
          onToggle={() => setOpenWps((v) => !v)}
        />
        {openWps &&
          survey.waypoints.map((w, i) => (
            <Row
              key={i}
              depth={2}
              label={`${i + 1}`}
              detail={`${survey.waypointClearance[i].toFixed(0)} m AGL`}
              warn={survey.waypointClearance[i] < threshold}
              active={same(selection, { kind: 'waypoint', index: i })}
              onClick={() => onSelect({ kind: 'waypoint', index: i })}
            />
          ))}

        <Row
          depth={1}
          icon={Route}
          label="Legs"
          detail={String(survey.demands.length)}
          expandable
          open={openLegs}
          onToggle={() => setOpenLegs((v) => !v)}
        />
        {openLegs &&
          survey.demands.map((d, i) => (
            <Row
              key={i}
              depth={2}
              label={`${i + 1} → ${i + 2}`}
              detail={`${survey.legMinClearance[i].toFixed(0)} m`}
              warn={d.exceeded || survey.legMinClearance[i] < threshold}
              active={same(selection, { kind: 'leg', index: i })}
              onClick={() => onSelect({ kind: 'leg', index: i })}
            />
          ))}
      </div>
    </ScrollArea>
  )
}
