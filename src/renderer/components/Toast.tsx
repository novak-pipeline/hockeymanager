import { useUiStore } from './store'

/** Global toast stack; click a toast to dismiss it early. */
export function ToastStack(): JSX.Element | null {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={t.kind === 'info' ? 'toast' : `toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
