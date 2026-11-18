import { useState } from 'react';
import { deleteAttachment, downloadAttachment } from '../../api/attachments.api';
import { parseApiError } from '../../api/requests.api';
import { formatFileSize } from '../../utils/attachmentRules';
import Button from '../common/Button';

/**
 * 올려 둔 첨부파일 목록. 이름을 눌러 내려받고, 삭제할 수 있는 경우에는 삭제 버튼도 보인다.
 * @param {{ attachments: Array<{ id: string, fileName: string, size: number, uploader?: { name: string } | null }>,
 *           onDeleted?: (id: string) => void, deletable?: boolean, emptyText?: string, showUploader?: boolean }} props
 */
export default function AttachmentList({ attachments, onDeleted, deletable = false, emptyText, showUploader = false }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  if (!attachments || attachments.length === 0) {
    return emptyText ? <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>{emptyText}</p> : null;
  }

  async function run(id, action) {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.response ? parseApiError(err).message : err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <ul style={{ margin: 0, padding: 0 }}>
        {attachments.map((file) => (
          <li
            key={file.id}
            style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' }}
          >
            <button
              type="button"
              onClick={() => run(file.id, () => downloadAttachment(file.id))}
              disabled={busyId === file.id}
              aria-label={`${file.fileName} 내려받기`}
              style={{ background: 'none', border: 'none', padding: 0, minHeight: 'auto', color: 'var(--color-primary)', textDecoration: 'underline', textAlign: 'left', wordBreak: 'break-all' }}
            >
              {file.fileName}
            </button>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              {formatFileSize(file.size)}
              {showUploader && file.uploader ? ` · ${file.uploader.name}` : ''}
            </span>
            {deletable && (
              <Button
                type="button"
                variant="ghost"
                loading={busyId === file.id}
                aria-label={`${file.fileName} 삭제`}
                onClick={() =>
                  run(file.id, async () => {
                    await deleteAttachment(file.id);
                    onDeleted?.(file.id);
                  })
                }
                style={{ padding: '4px 10px', minHeight: 36 }}
              >
                삭제
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" style={{ color: 'var(--color-danger)', margin: 'var(--spacing-2) 0 0', fontSize: '0.9rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
