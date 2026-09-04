import { useState, useMemo } from 'react'
import type { ParticipantRiskSnapshot } from '../types/monitoring'
import { RiskBadge } from './RiskBadge'
import { formatEventType } from '../utils/eventFormatters'

interface RiskTableProps {
  snapshots: ParticipantRiskSnapshot[]
  onReview: (snapshot: ParticipantRiskSnapshot) => void
}

/**
 * Primary risk leaderboard — participants sorted by risk (desc).
 * Includes client-side search by student name or ID.
 */
export function RiskTable({ snapshots, onReview }: RiskTableProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return snapshots
    const q = search.trim().toLowerCase()
    return snapshots.filter(
      (s) =>
        s.student_name.toLowerCase().includes(q) ||
        s.student_id.toLowerCase().includes(q)
    )
  }, [snapshots, search])

  if (snapshots.length === 0) {
    return null // Summary cards handle the empty state
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      <div className="px-6 pt-5 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Monitoring Risk</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Participants with higher monitoring risk are shown first.
            </p>
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-64">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search student name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-gray-50"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 px-6">
          {search.trim()
            ? 'No participants match your search.'
            : 'No participants currently require high-risk review.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50">
                <th className="text-left py-2.5 px-6 font-medium text-gray-500 text-xs uppercase tracking-wide">Student</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Student ID</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide w-48">Risk Score</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Events</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">High</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Top Signal</th>
                <th className="text-right py-2.5 px-6 font-medium text-gray-500 text-xs uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((snap) => {
                const needsReview = snap.risk_level === 'critical' || snap.risk_level === 'high'

                return (
                  <tr
                    key={snap.participant_session_id}
                    className={`border-b border-gray-50 transition-colors ${
                      snap.risk_level === 'critical'
                        ? 'bg-red-50/40'
                        : snap.risk_level === 'high'
                          ? 'bg-orange-50/40'
                          : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Student */}
                    <td className="py-3 px-6">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900 font-medium">{snap.student_name}</span>
                        {needsReview && (
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                              snap.risk_level === 'critical'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                          >
                            {snap.risk_level === 'critical' ? 'Needs Review' : 'Review'}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Student ID */}
                    <td className="py-3 px-3 font-mono text-xs text-gray-500">{snap.student_id}</td>

                    {/* Risk Score with bar */}
                    <td className="py-3 px-3">
                      <RiskBadge level={snap.risk_level} showBar score={snap.risk_score} />
                    </td>

                    {/* Total Events */}
                    <td className="py-3 px-3 text-gray-700 tabular-nums">{snap.total_events}</td>

                    {/* High severity count */}
                    <td className="py-3 px-3">
                      {snap.high_severity_events > 0 ? (
                        <span className="text-red-600 font-medium tabular-nums">{snap.high_severity_events}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Top Signal */}
                    <td className="py-3 px-3 text-xs text-gray-500">
                      {snap.top_event_types.length > 0
                        ? `${formatEventType(snap.top_event_types[0].event_type)} ×${snap.top_event_types[0].count}`
                        : '—'}
                    </td>

                    {/* Review action */}
                    <td className="py-3 px-6 text-right">
                      <button
                        onClick={() => onReview(snap)}
                        className="px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-50">
        Risk is an assistive signal derived from monitoring events. Instructor review remains the decision maker.
      </p>
    </div>
  )
}
