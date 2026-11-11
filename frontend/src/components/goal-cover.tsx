import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { goals as goalsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Goal } from '@/types'

interface GoalCoverProps {
  goal: Pick<Goal, 'id' | 'color' | 'has_image' | 'image_version'>
  icon: React.ElementType
  className?: string
  children?: React.ReactNode
}

/**
 * The top of a goal card: its photo when it has one (the trip, the car),
 * otherwise its color with the icon. Children sit on top, for badges.
 */
export function GoalCover({ goal, icon: Icon, className, children }: GoalCoverProps) {
  const { data: blob } = useQuery({
    queryKey: ['goal-image', goal.id, goal.image_version],
    queryFn: () => goalsApi.imageBlob(goal.id),
    enabled: !!goal.has_image,
    staleTime: Infinity,
  })
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  const color = goal.color ?? '#16A34A'
  const showPhoto = goal.has_image && url
  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={showPhoto ? undefined : { background: `linear-gradient(135deg, ${color}, ${color}99)` }}
    >
      {showPhoto ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/90">
          <Icon size={44} strokeWidth={1.6} />
        </div>
      )}
      {children}
    </div>
  )
}
