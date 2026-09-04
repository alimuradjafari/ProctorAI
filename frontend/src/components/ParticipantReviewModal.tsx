import { useMemo } from 'react'
import type { ParticipantRiskSnapshot, MonitoringEvent } from '../types/monitoring'
import type { ScreenReviewStatus } from '../types/screenReview'
import { RiskBadge } from './RiskBadge'
import { LiveScreenViewer } from './LiveScreenViewer'
import { formatEventType, getSeverityStyle, getEventDescription } from '../utils/eventFormatters'

interface ParticipantReviewModalProps {
  snapshot: ParticipantRiskSnapshot
  events: MonitoringEvent[]
  onClose: () => void
  // Screen review props (Phase 10.1)
  screenReviewStatus: ScreenReviewStatus
  screenReviewStream: MediaStream | null
  screenReviewStatusMessage: string
  onStartScreenReview: () => void
  onEndScreenReview: () => void
  onResetScreenReview: () => void
  sessionIsLive: boolean
}

/**
 * Side-drawer style modal showing detailed participant risk information.
 * Filters the live event feed to show only this participant's events.
 */
export function ParticipantReviewModal({
  snapshot,
  events,
  onClose,
  screenReviewStatus,
  screenReviewStream,
  screenReviewStatusMessage,
  onStartScreenReview,
  onEndScreenReview,
  onResetScreenReview,
  sessionIsLive,
}: ParticipantReviewModalProps) {
  // Filter events for this participant
  const participantEvents = useMemo(
    () =>
      events
        .filter((e) => e.participant?.participant_session_id === snapshot.participant_session_id)
        .slice(0, 20),
    [events, snapshot.participant_session_id]
  )

  // Aggregate severity counts from available events (snapshot provides totals)
  const severityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const e of events) {
      if (e.participant?.participant_session_id !== snapshot.participant_session_id) continue
      if (e.severity in counts) counts[e.severity as keyof typeof counts]++
    }
    return counts
  }, [events, snapshot.participant_session_id])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-md z-50 flex">
        <div className="bg-white w-full shadow-2xl border-l border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{snapshot.student_name}</h2>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{snapshot.student_id}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close review panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Risk Summary */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
                Monitoring Risk
              </p>
              <div className="flex items-center gap-3">
                <RiskBadge level={snapshot.risk_level} showBar score={snapshot.risk_score} />
              </div>
            </div>

            {/* Live Screen Review (Phase 10.1) */}
            {sessionIsLive && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
                  Live Screen Review
                </p>

                {/* Active screen viewer */}
                {(screenReviewStatus === 'active' || screenReviewStatus === 'connecting') && (
                  <LiveScreenViewer
                    stream={screenReviewStream}
                    studentName={snapshot.student_name}
                    studentId={snapshot.student_id}
                    riskScore={snapshot.risk_score}
                    riskLevel={snapshot.risk_level}
                    onEndReview={onEndScreenReview}
                  />
                )}

                {/* Screen review button / status */}
                {screenReviewStatus !== 'active' && screenReviewStatus !== 'connecting' && (
                  <div className="space-y-2">
                    {/* Button for high/critical */}
                    {(snapshot.risk_level === 'high' || snapshot.risk_level === 'critical') ? (
                      <>
                        {screenReviewStatus === 'idle' ? (
                          <button
                            onClick={onStartScreenReview}
                            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            View Live Screen
                          </button>
                        ) : (
                          <div className="space-y-2">
                            {/* Status message */}
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                              {(screenReviewStatus === 'requesting' || screenReviewStatus === 'requested' || screenReviewStatus === 'accepted') && (
                                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                              )}
                              <span className="text-sm text-gray-600">{screenReviewStatusMessage}</span>
                            </div>

                            {/* Retry button for terminal states */}
                            {(screenReviewStatus === 'declined' || screenReviewStatus === 'expired' || screenReviewStatus === 'stopped' || screenReviewStatus === 'failed' || screenReviewStatus === 'error') && (
                              <button
                                onClick={() => {
                                  onResetScreenReview()
                                  onStartScreenReview()
                                }}
                                className="w-full px-4 py-2 border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400 py-2">
                        Live screen review available for High/Critical risk participants.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Event Counts */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
                Event Summary
              </p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Total', value: snapshot.total_events, color: 'text-gray-900' },
                  { label: 'High', value: severityCounts.high || snapshot.high_severity_events, color: 'text-red-600' },
                  { label: 'Medium', value: severityCounts.medium || snapshot.medium_severity_events, color: 'text-yellow-700' },
                  { label: 'Low', value: severityCounts.low || snapshot.low_severity_events, color: 'text-blue-600' },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="bg-gray-50 rounded-lg px-3 py-2 text-center"
                  >
                    <p className="text-xs text-gray-400">{item.label}</p>
                    <p className={`text-lg font-bold tabular-nums ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Primary Signals */}
            {snapshot.top_event_types.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
                  Primary Signals
                </p>
                <div className="space-y-1.5">
                  {snapshot.top_event_types.map((t) => (
                    <div
                      key={t.event_type}
                      className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
                      title={getEventDescription(t.event_type)}
                    >
                      <span className="text-sm text-gray-700">{formatEventType(t.event_type)}</span>
                      <span className="text-sm font-semibold text-gray-900 tabular-nums">×{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Activity */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
                Recent Activity
              </p>
              {participantEvents.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No recent events available for this participant.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {participantEvents.map((event) => {
                    const sev = getSeverityStyle(event.severity)
                    return (
                      <div
                        key={event.event_id}
                        className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"
                      >
                        <span className="text-xs text-gray-400 whitespace-nowrap tabular-nums">
                          {new Date(event.received_at).toLocaleTimeString()}
                        </span>
                        <span
                          className="text-sm text-gray-700 flex-1"
                          title={getEventDescription(event.event_type)}
                        >
                          {formatEventType(event.event_type)}
                        </span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${sev.className}`}>
                          {sev.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {events.length >= 200 && (
                <p className="text-[10px] text-gray-400 mt-2">
                  Showing events from live buffer (max 200). Earlier events are not included.
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
