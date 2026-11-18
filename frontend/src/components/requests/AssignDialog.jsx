import { useEffect, useState } from 'react';
import { fetchUsers } from '../../api/admin.api';
import { parseApiError } from '../../api/requests.api';
import Button from '../common/Button';
import Modal from '../common/Modal';

/**
 * 관리자가 제출됨 요청서를 지원자에게 직접 배정하는 창.
 * @param {{ request: { id: string, title: string } | null, onAssign: (supporterId: string) => Promise<void>, onClose: () => void }} props
 *   request가 null이면 닫혀 있다. onAssign이 던진 오류의 메시지를 창 안에 보여준다.
 */
export default function AssignDialog({ request, onAssign, onClose }) {
  const [supporters, setSupporters] = useState(null);
  const [supporterId, setSupporterId] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // 창이 열릴 때마다 지원자 목록을 새로 읽고 선택을 비운다.
  useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    setSupporters(null);
    setSupporterId('');
    setLoadError(null);
    setError(null);
    fetchUsers({ role: 'SUPPORTER', pageSize: 100 })
      .then((data) => {
        if (!cancelled) setSupporters(data.items);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(parseApiError(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supporterId) {
      setError('배정할 지원자를 선택해 주세요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAssign(supporterId);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(request)} onClose={saving ? undefined : onClose} title="지원자 배정">
      <form onSubmit={handleSubmit} noValidate>
        <p style={{ marginTop: 0, color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>
          "{request?.title}" 요청서를 맡을 지원자를 선택해 주세요. 배정하면 바로 접수된 상태가 됩니다.
        </p>

        {loadError && (
          <p role="alert" style={{ color: 'var(--color-danger)' }}>
            {loadError}
          </p>
        )}

        {!loadError && supporters === null && <p>지원자 목록을 불러오는 중…</p>}

        {supporters && supporters.length === 0 && (
          <p role="status">
            지정된 지원자가 없습니다. 관리 화면의 사용자 목록에서 먼저 지원자로 지정해 주세요.
          </p>
        )}

        {supporters && supporters.length > 0 && (
          <>
            <label htmlFor="assign-supporter" style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--spacing-1)' }}>
              지원자
            </label>
            <select
              id="assign-supporter"
              value={supporterId}
              onChange={(e) => {
                setSupporterId(e.target.value);
                setError(null);
              }}
              aria-invalid={error && !supporterId ? true : undefined}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
                minHeight: 'var(--touch-target)',
              }}
            >
              <option value="">선택하세요</option>
              {supporters.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </>
        )}

        {error && (
          <p role="alert" style={{ color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end', marginTop: 'var(--spacing-4)' }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            닫기
          </Button>
          <Button type="submit" loading={saving} disabled={!supporters || supporters.length === 0}>
            배정
          </Button>
        </div>
      </form>
    </Modal>
  );
}
