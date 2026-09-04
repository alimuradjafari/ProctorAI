import { getRiskLevelStyle } from '../utils/eventFormatters'

interface RiskBadgeProps {
  level: string
  /** When true, also render the compact progress bar. */
  showBar?: boolean
  /** Score out of 100 for the progress bar. */
  score?: number
}

/**
 * Consistent risk-level badge used across the dashboard.
 * Always shows the textual label; never relies on color alone.
 */
export function RiskBadge({ level, showBar, score }: RiskBadgeProps) {
  const style = getRiskLevelStyle(level)

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style.badgeClassName}`}
      >
        {style.label}
      </span>
      {showBar && score !== undefined && (
        <div className="flex items-center gap-2 flex-1 min-w-[80px]">
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${style.barColor}`}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
            {score}<span className="text-gray-400">/100</span>
          </span>
        </div>
      )}
    </div>
  )
}
