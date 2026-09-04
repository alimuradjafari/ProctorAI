import type { EventType, Severity } from '../types/monitoring'

/**
 * Human-friendly display labels for every known EventType.
 * Single source of truth — no scattered formatEventType calls.
 */
const EVENT_TYPE_LABELS: Record<EventType, string> = {
  phone_detected: 'Phone Detected',
  multiple_faces: 'Multiple Faces',
  suspicious_object: 'Suspicious Object',
  no_face: 'No Face',
  fullscreen_exit: 'Fullscreen Exit',
  tab_switch: 'Tab Switch',
  camera_obscured: 'Camera Obscured',
  looking_away: 'Looking Away',
  window_minimized: 'Window Minimized',
  window_maximized: 'Window Maximized',
  window_restored: 'Window Restored',
  browser_side_panel: 'Browser Side Panel',
  exam_window_focus_lost: 'Exam Window Focus Lost',
}

/**
 * Concise, neutral tooltip descriptions for event types.
 * Shown on hover in the event feed and review modal.
 */
const EVENT_TYPE_DESCRIPTIONS: Record<EventType, string> = {
  phone_detected: 'Phone detected by local camera analysis',
  multiple_faces: 'More than one face detected',
  suspicious_object: 'Suspicious object detected in camera view',
  no_face: 'No face detected for a sustained period',
  fullscreen_exit: 'Participant exited fullscreen mode',
  tab_switch: 'Participant switched away from monitored tab',
  camera_obscured: 'Camera view appears blocked or highly uniform',
  looking_away: 'Sustained head orientation away from screen',
  window_minimized: 'Monitored window was minimized',
  window_maximized: 'Monitored window was maximized',
  window_restored: 'Monitored window was restored',
  browser_side_panel: 'Browser side panel or docked tool detected',
  exam_window_focus_lost: 'Monitored exam browser window lost focus',
}

/**
 * Return the display label for an event type.
 * Falls back to title-cased snake_case for unknown future types.
 */
export function formatEventType(type: EventType | string): string {
  if (type in EVENT_TYPE_LABELS) {
    return EVENT_TYPE_LABELS[type as EventType]
  }
  // Graceful fallback for unknown types
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Return the tooltip description for an event type, or undefined if unknown.
 */
export function getEventDescription(type: EventType | string): string | undefined {
  return EVENT_TYPE_DESCRIPTIONS[type as EventType]
}

/**
 * All known event types as an array (for dropdown options).
 */
export function allEventTypes(): EventType[] {
  return Object.keys(EVENT_TYPE_LABELS) as EventType[]
}

/**
 * Severity display metadata: label + Tailwind classes.
 */
export interface SeverityStyle {
  label: string
  className: string
}

const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  high: { label: 'High', className: 'bg-red-100 text-red-800' },
  medium: { label: 'Medium', className: 'bg-yellow-100 text-yellow-800' },
  low: { label: 'Low', className: 'bg-blue-100 text-blue-800' },
}

export function getSeverityStyle(severity: Severity): SeverityStyle {
  return SEVERITY_STYLES[severity] ?? { label: severity, className: 'bg-gray-100 text-gray-800' }
}

/**
 * Risk level display metadata: label + Tailwind classes + progress bar color.
 */
export interface RiskLevelStyle {
  label: string
  badgeClassName: string
  barColor: string
}

const RISK_LEVEL_STYLES: Record<string, RiskLevelStyle> = {
  normal: {
    label: 'Normal',
    badgeClassName: 'bg-green-100 text-green-800',
    barColor: 'bg-green-500',
  },
  low: {
    label: 'Low',
    badgeClassName: 'bg-blue-100 text-blue-800',
    barColor: 'bg-blue-500',
  },
  medium: {
    label: 'Medium',
    badgeClassName: 'bg-yellow-100 text-yellow-800',
    barColor: 'bg-yellow-500',
  },
  high: {
    label: 'High',
    badgeClassName: 'bg-orange-100 text-orange-800',
    barColor: 'bg-orange-500',
  },
  critical: {
    label: 'Critical',
    badgeClassName: 'bg-red-100 text-red-800',
    barColor: 'bg-red-500',
  },
}

export function getRiskLevelStyle(level: string): RiskLevelStyle {
  return RISK_LEVEL_STYLES[level] ?? {
    label: level.charAt(0).toUpperCase() + level.slice(1),
    badgeClassName: 'bg-gray-100 text-gray-800',
    barColor: 'bg-gray-500',
  }
}

/**
 * Format the "Detection" column value for a monitoring event.
 *
 * - null or exactly 1.0 → "Rule-based" (deterministic / heuristic events)
 * - 0 < confidence < 1 → percentage (AI-sourced confidence)
 *
 * The extension sends confidence: 1.0 as a sentinel for rule-based
 * detectors (camera_obscured, looking_away). Real AI confidence
 * is always strictly between 0 and 1.
 */
export function formatConfidence(confidence: number | null): string {
  if (confidence === null || confidence === undefined) return 'Rule-based'
  if (confidence >= 1.0) return 'Rule-based'
  if (confidence <= 0) return 'Rule-based'
  return `${(confidence * 100).toFixed(0)}%`
}
