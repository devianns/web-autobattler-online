export default function LoadingSpinner({ label = "불러오는 중" }: { label?: string }) {
  return <span className="loading-indicator" role="status" aria-live="polite">
    <span className="loading-spinner" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>;
}
