'use client'

import { Brain, Info as InfoIcon } from 'lucide-react'
import { Badge, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSearchParams } from 'next/navigation'
import { translateKey } from '@/lib/misalignment'

export function MisalignmentDetailIndicator() {
  const searchParams = useSearchParams()
  const showHint =
    searchParams.get('tab') === 'priority-misalignment' ||
    searchParams.get('callback') === 'priority-misalignment'

  if (!showHint) return null

  const handleNavigateToSettings = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'priority-misalignment')
    window.history.replaceState({}, '', url.toString())
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="default" className="cursor-pointer select-none bg-blue-500 text-white hover:bg-blue-600">
            <Brain className="-ml-1 mr-1 h-3.5 w-3.5" />
            {translateKey('misalignmentDetailIndicator-label')}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <div className="max-w-sm space-y-2">
            <p className="text-sm font-medium">{translateKey('misalignmentDetailIndicator-description')}</p>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={handleNavigateToSettings}
            >
              <InfoIcon className="-ml-1 mr-1 h-3.5 w-3.5" />
              {translateKey('misalignmentDetailIndicator-button')}
            </Button>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}