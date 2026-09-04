import type { SessionStatus } from '../types/monitoring'

interface LifecycleActionsProps {
  status: SessionStatus
  actionLoading: boolean
  onAction: (action: 'prepare' | 'start' | 'end' | 'cancel') => void
  onDelete: () => void
}

/**
 * Session lifecycle controls: Prepare, Start, End, Cancel, Delete.
 * Visually groups safe actions separately from destructive ones.
 * ENDED sessions get a prominent "Delete Permanently" action.
 */
export function LifecycleActions({ status, actionLoading, onAction, onDelete }: LifecycleActionsProps) {
  const canPrepare  = status === 'draft'
  const canStart    = status === 'waiting'
  const canEnd      = status === 'live'
  const canCancel   = status === 'draft' || status === 'waiting'
  const canDelete   = status === 'draft' || status === 'cancelled' || status === 'ended'
  const isEnded     = status === 'ended'

  const hasAnyAction = canPrepare || canStart || canEnd || canCancel || canDelete

  if (!hasAnyAction) return null

  return (
    <div className="flex flex-wrap items-center gap-2 mt-6 pt-4 border-t border-gray-100">
      {canPrepare && (
        <button
          onClick={() => onAction('prepare')}
          disabled={actionLoading}
          className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          Prepare Session
        </button>
      )}
      {canStart && (
        <button
          onClick={() => onAction('start')}
          disabled={actionLoading}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          Go Live
        </button>
      )}
      {canEnd && (
        <button
          onClick={() => onAction('end')}
          disabled={actionLoading}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          End Session
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => onAction('cancel')}
          disabled={actionLoading}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          Cancel Session
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          disabled={actionLoading}
          className={`px-4 py-2 rounded-lg disabled:opacity-50 text-sm font-medium transition-colors ml-auto ${
            isEnded
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'border border-red-300 text-red-600 hover:bg-red-50'
          }`}
        >
          {isEnded ? 'Delete Permanently' : 'Delete'}
        </button>
      )}
    </div>
  )
}
