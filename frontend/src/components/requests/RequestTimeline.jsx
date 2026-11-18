import { EVENT_LABELS, isRejection } from '../../utils/history';
import { formatDateTime } from '../../utils/time';

/**
 * 요청서 처리 이력을 시간순으로 보여준다. 반려는 사유를 함께, 작업내역 제출은 몇 회차인지 함께 보여준다.
 * @param {{ events: Array<{ id: string, type: string, reason: string | null, createdAt: string, round?: number, actor: { name: string } | null }> }} props
 */
export default function RequestTimeline({ events }) {
  if (!events || events.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>표시할 처리 이력이 없습니다.</p>;
  }

  return (
    <ol style={{ margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-3)' }}>
      {events.map((event) => {
        const rejected = isRejection(event);
        return (
          <li
            key={event.id}
            style={{
              listStyle: 'none',
              paddingLeft: 'var(--spacing-3)',
              borderLeft: `3px solid ${rejected ? 'var(--color-danger)' : 'var(--color-border)'}`,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {event.actor?.name ?? '-'}님이 {EVENT_LABELS[event.type] ?? event.type}
              {event.round ? ` (${event.round}회차)` : ''}
            </div>
            <time dateTime={event.createdAt} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              {formatDateTime(event.createdAt)}
            </time>
            {event.reason && (
              <p
                style={{
                  margin: 'var(--spacing-2) 0 0',
                  padding: 'var(--spacing-2) var(--spacing-3)',
                  background: 'var(--color-overdue-bg)',
                  color: 'var(--color-overdue-text)',
                  borderRadius: 'var(--radius)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <strong>반려 사유</strong> {event.reason}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
