'use client'

import { Fragment } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { cn } from '@/lib/utils'

export type ZoomCmd = 'in' | 'out' | 'fit' | 'stop'

export function ZoomButtons({
  onZoom,
  disabled,
  className,
  size = 'icon',
}: {
  onZoom: (what: ZoomCmd) => void
  disabled?: boolean
  className?: string
  size?: 'icon' | 'icon-sm' | 'icon-xs'
}) {
  return (
    <ButtonGroup
      orientation="vertical"
      className={cn('bg-card/80 border-border/60 rounded-md border p-0.5 backdrop-blur', className)}
    >
      {(
        [
          [ZoomIn, 'in', 'Zoom in'],
          [ZoomOut, 'out', 'Zoom out'],
          [Maximize2, 'fit', 'Frame'],
        ] as const
      ).map(([Icon, what, label], i) => (
        <Fragment key={what}>
          {i > 0 && <ButtonGroupSeparator />}
          <Button
            size={size}
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={() => onZoom(what)}
          >
            <Icon />
          </Button>
        </Fragment>
      ))}
    </ButtonGroup>
  )
}
