import { formatDateTime, formatMinutes } from '../../utils/time';
import AttachmentList from '../attachments/AttachmentList';

/**
 * 제출된 작업내역을 회차 순으로 보여준다. (1차 확인·최종 확인 화면에서 같이 쓴다.)
 * @param {{ logs: Array<{ id: string, round: number, content: string, minutes: number, submittedAt: string, author: { name: string } | null }>,
 *           attachments?: Array<{ id: string, workLogId: string | null }> }} props
 *   attachments: 요청서의 첨부파일 전체. 각 작업내역(workLogId)에 묶인 파일을 그 아래에 보여준다.
 */
export default function WorkLogList({ logs, attachments = [] }) {
  if (!logs || logs.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>제출된 작업내역이 없습니다.</p>;
  }

  return (
    <ol style={{ margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-3)' }}>
      {logs.map((log) => (
        <li
          key={log.id}
          style={{
            listStyle: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: 'var(--spacing-3)',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-2)' }}>
            <strong style={{ color: 'var(--color-text)' }}>{log.round}회차</strong>
            {' · '}
            {log.author?.name ?? '-'}
            {' · '}
            {formatDateTime(log.submittedAt)}
            {' · '}
            소요 {formatMinutes(log.minutes)}
          </div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{log.content}</p>
          {attachments.some((file) => file.workLogId === log.id) && (
            <div style={{ marginTop: 'var(--spacing-2)' }}>
              <AttachmentList attachments={attachments.filter((file) => file.workLogId === log.id)} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
