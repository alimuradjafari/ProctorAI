import type { ParticipantRiskSnapshot } from '../types/monitoring'

interface SessionSummaryCardsProps {
  riskSnapshots: ParticipantRiskSnapshot[]
  eventCount: number
}

/**
 * Compact summary row: Participants · High Risk · Critical Risk · Events.
 * Only shows when there's actual data to display.
 */
export function SessionSummaryCards({ riskSnapshots, eventCount }: SessionSummaryCardsProps) {
  const highCount = riskSnapshots.filter((r) => r.risk_level === 'high').length
  const criticalCount = riskSnapshots.filter((r) => r.risk_level === 'critical').length

  const cards = [
    {
      label: 'Participants',
      value: riskSnapshots.length,
      color: 'text-gray-900',
    },
    {
      label: 'High Risk',
      value: highCount,
      color: highCount > 0 ? 'text-orange-600' : 'text-gray-400',
    },
    {
      label: 'Critical Risk',
      value: criticalCount,
      color: criticalCount > 0 ? 'text-red-600' : 'text-gray-400',
    },
    {
      label: 'Events',
      value: eventCount,
      color: 'text-gray-900',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3"
        >
          <p className="text-xs text-gray-500 font-medium">{card.label}</p>
          <p className={`text-2xl font-bold tabular-nums mt-0.5 ${card.color}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  )
}
