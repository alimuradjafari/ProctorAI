import { useState, useMemo, useRef, useEffect } from 'react'
import type { MonitoringEvent, Severity, EventType } from '../types/monitoring'
import {
  formatEventType,
  getSeverityStyle,
  getEventDescription,
  allEventTypes,
  formatConfidence,
} from '../utils/eventFormatters'

interface LiveEventFeedProps {
  events: MonitoringEvent[]
  sessionStatus: string
}

const SEVERITY_FILTERS: Array<{ value: Severity | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const COLLAPSED_COUNT = 3

/**
 * Real-time monitoring event stream with severity + event-type filters.
 * Newest events first. Collapsed by default (3 events); expandable with
 * an internal scroll container to keep the page height manageable.
 */
export function LiveEventFeed({ events, sessionStatus }: LiveEventFeedProps) {
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all')
  const [expanded, setExpanded] = useState(false)
  const prevLengthRef = useRef(events.length)
  const [newestId, setNewestId] = useState<string | null>(null)

  // Detect a new event arrival and briefly highlight it
  useEffect(() => {
    if (events.length > prevLengthRef.current && events.length > 0) {
      setNewestId(events[0].event_id)
      const timer = setTimeout(() => setNewestId(null), 2000)
      prevLengthRef.current = events.length
      return () => clearTimeout(timer)
    }
    prevLengthRef.current = events.length
  }, [events])

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false
      if (typeFilter !== 'all' && e.event_type !== typeFilter) return false
      return true
    })
  }, [events, severityFilter, typeFilter])

  // When collapsed, show only the latest N filtered events
  const visible = expanded ? filtered : filtered.slice(0, COLLAPSED_COUNT)
  const hasMore = filtered.length > COLLAPSED_COUNT

  const eventTypes = allEventTypes()

  const filtersActive = severityFilter !== 'all' || typeFilter !== 'all'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      <div className="px-6 pt-5 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Live Monitoring Events
              <span className="ml-2 text-xs font-normal text-gray-400 tabular-nums">
                {filtered.length}{filtered.length !== events.length ? ` / ${events.length}` : ''}
                {filtered.length === 1 ? ' event' : ' events'}
              </span>
            </h2>
          </div>

          {/* Severity filter pills */}
          <div className="flex gap-1">
            {SEVERITY_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setSeverityFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  severityFilter === f.value
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Event type dropdown */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as EventType | 'all')}
          className="w-full sm:w-auto px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        >
          <option value="all">All Event Types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{formatEventType(t)}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 px-6">
          {events.length === 0
            ? sessionStatus === 'live'
              ? 'No monitoring events yet. Events will appear here in real-time.'
              : 'No monitoring events yet.'
            : 'No events match the selected filters.'}
        </p>
      ) : (
        <>
          <div className={`overflow-x-auto ${expanded ? 'max-h-[450px] overflow-y-auto' : ''}`}>
            <table className="w-full text-sm">
              <thead className={expanded ? 'sticky top-0 z-10' : ''}>
                <tr className="border-y border-gray-100 bg-gray-50">
                  <th className="text-left py-2 px-6 font-medium text-gray-500 text-xs uppercase tracking-wide w-24">Time</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Student</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Event</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Severity</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Detection</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => {
                  const sev = getSeverityStyle(event.severity)
                  const desc = getEventDescription(event.event_type)
                  const isNew = event.event_id === newestId

                  return (
                    <tr
                      key={event.event_id}
                      className={`border-b border-gray-50 transition-colors duration-1000 ${
                        isNew ? 'bg-primary-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-2.5 px-6 text-xs text-gray-400 tabular-nums whitespace-nowrap">
                        {new Date(event.received_at).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="text-gray-900 text-sm">
                          {event.participant?.student_name ?? 'Unknown student'}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">
                          {event.participant?.student_id ?? '—'}
                        </p>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          title={desc}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                        >
                          {formatEventType(event.event_type)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sev.className}`}>
                          {sev.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums">
                        {formatConfidence(event.confidence) === 'Rule-based' ? (
                          <span className="text-gray-400">Rule-based</span>
                        ) : (
                          <span className="text-gray-600 font-medium">{formatConfidence(event.confidence)}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Expand / collapse controls */}
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            {expanded ? (
              <button
                onClick={() => setExpanded(false)}
                className="text-xs font-medium text-primary-600 hover:text-primary-800 transition-colors"
              >
                Show less
              </button>
            ) : hasMore ? (
              <button
                onClick={() => setExpanded(true)}
                className="text-xs font-medium text-primary-600 hover:text-primary-800 transition-colors"
              >
                View all {filtered.length} events{filtersActive ? ' (filtered)' : ''}
              </button>
            ) : (
              <span />
            )}
            {!expanded && !hasMore && <span />}
            {expanded && (
              <span className="text-xs text-gray-400">
                Showing {filtered.length} events
                {events.length >= 200 ? ' (live buffer max 200)' : ''}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
