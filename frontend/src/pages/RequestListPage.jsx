import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { acceptRequest, assignRequest, cancelAcceptRequest, fetchRequests, parseApiError } from '../api/requests.api';
import { useAuth } from '../hooks/useAuth';
import { STATUS_LABELS, STATUS_OPTIONS, URGENCY_LABELS } from '../constants/requestLabels';
import AssignDialog from '../components/requests/AssignDialog';
import StatusBadge from '../components/requests/StatusBadge';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import LinkButton from '../components/common/LinkButton';
import Spinner from '../components/common/Spinner';

const PAGE_SIZE = 20;

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-4)',
};

const selectStyle = {
  padding: '8px 12px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  minHeight: 'var(--touch-target)',
};

function tabStyle(active) {
  return {
    padding: '8px 16px',
    borderRadius: 999,
    border: '1px solid var(--color-border)',
    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
    color: active ? '#fff' : 'var(--color-text)',
    fontWeight: 600,
  };
}

function RequestCard({ item, busy, onAccept, onCancelAccept, onAssign }) {
  return (
    <li style={{ ...cardStyle, listStyle: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'flex-start' }}>
        <h2 style={{ fontSize: '1.05rem', margin: 0, wordBreak: 'break-word' }}>
          <Link className="tap-link" to={`/requests/${item.id}`} style={{ color: 'inherit' }}>
            {item.title}
          </Link>
        </h2>
        <StatusBadge status={item.status} />
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '2px var(--spacing-3)',
          margin: 'var(--spacing-3) 0 0',
          fontSize: '0.9rem',
          color: 'var(--color-text-muted)',
        }}
      >
        <dt>지원 유형</dt>
        <dd style={{ margin: 0 }}>{item.supportType?.name ?? '-'}</dd>
        <dt>요청자</dt>
        <dd style={{ margin: 0 }}>
          {item.requester?.name ?? '-'} ({item.department})
        </dd>
        <dt>희망 완료일</dt>
        <dd style={{ margin: 0 }}>
          {item.desiredDate} · 긴급도 {URGENCY_LABELS[item.urgency] ?? item.urgency}
        </dd>
        <dt>담당 지원자</dt>
        <dd style={{ margin: 0 }}>{item.assignee?.name ?? '미접수'}</dd>
      </dl>
      {(item.canEdit || item.canAccept || item.canCancelAccept || item.canSubmitWork || item.canFirstReview || item.canFinalReview || item.canAssign) && (
        <div style={{ marginTop: 'var(--spacing-3)', display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          {item.canAccept && (
            <Button loading={busy} onClick={() => onAccept(item)}>
              접수
            </Button>
          )}
          {item.canSubmitWork && (
            <LinkButton to={`/requests/${item.id}/work`}>
              {item.status === 'REWORK' ? '재작업 제출' : '작업내역 입력'}
            </LinkButton>
          )}
          {item.canFirstReview && <LinkButton to={`/requests/${item.id}/review`}>1차 확인</LinkButton>}
          {item.canFinalReview && <LinkButton to={`/requests/${item.id}/final-review`}>최종 확인</LinkButton>}
          {item.canAssign && (
            <Button variant="ghost" onClick={() => onAssign(item)}>
              지원자 배정
            </Button>
          )}
          {item.canCancelAccept && (
            <Button variant="ghost" disabled={busy} onClick={() => onCancelAccept(item)}>
              접수 취소
            </Button>
          )}
          {item.canEdit && <Link className="tap-link" to={`/requests/${item.id}/edit`}>수정</Link>}
        </div>
      )}
    </li>
  );
}

export default function RequestListPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const isSupporter = user?.role === 'SUPPORTER';
  const isAdmin = user?.role === 'ADMIN';
  const canCreate = user?.role === 'REQUESTER' || user?.role === 'ADMIN';

  const scope = isSupporter && params.get('scope') === 'mine' ? 'mine' : 'available';
  // 지원자의 "접수 가능" 목록은 항상 제출됨 상태뿐이라 상태 필터가 의미 없다.
  const showStatusFilter = !(isSupporter && scope === 'available');
  const status = showStatusFilter && STATUS_LABELS[params.get('status')] ? params.get('status') : '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [busyId, setBusyId] = useState(null);
  // 다른 화면(작업내역 제출 등)에서 넘어오면서 남긴 알림을 처음에 보여준다.
  const location = useLocation();
  const [notice, setNotice] = useState(location.state?.notice ?? null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);

  // silent: 접수 같은 동작 뒤에 목록을 조용히 새로 고친다(스피너로 화면이 깜빡이지 않게).
  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    return fetchRequests({
      page,
      pageSize: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(isSupporter ? { scope } : {}),
    })
      .then(setData)
      .catch((err) => setError(parseApiError(err).message))
      .finally(() => setLoading(false));
  }, [page, status, scope, isSupporter]);

  async function handleAccept(item) {
    setBusyId(item.id);
    setNotice(null);
    try {
      await acceptRequest(item.id);
      setNotice({ type: 'success', text: `"${item.title}" 요청서를 접수했습니다. "내 담당" 탭에서 작업을 이어가세요.` });
    } catch (err) {
      // 409는 다른 지원자가 먼저 접수한 경우다. 목록을 새로 고쳐 최신 상태를 보여준다.
      setNotice({ type: 'error', text: parseApiError(err).message });
    } finally {
      setBusyId(null);
      load({ silent: true });
    }
  }

  async function handleConfirmCancel() {
    const item = cancelTarget;
    setNotice(null);
    try {
      await cancelAcceptRequest(item.id);
      setNotice({ type: 'success', text: `"${item.title}" 접수를 취소했습니다. 다른 지원자가 접수할 수 있습니다.` });
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message });
    } finally {
      setCancelTarget(null);
      load({ silent: true });
    }
  }

  async function handleAssign(supporterId) {
    const item = assignTarget;
    // 실패하면 던진 오류를 배정 창이 보여준다(창은 열어 둔다). 성공하면 창을 닫고 목록을 새로 고친다.
    await assignRequest(item.id, supporterId);
    setAssignTarget(null);
    setNotice({ type: 'success', text: `"${item.title}" 요청서를 지원자에게 배정했습니다. 배정받은 지원자의 "내 담당"에 나타납니다.` });
    load({ silent: true });
  }

  useEffect(() => {
    load();
  }, [load]);

  function updateParams(changes) {
    // 탭·필터·페이지를 바꾸면 이전 동작의 알림은 더 이상 맞지 않으므로 지운다.
    // (효과로 지우면 개발 모드의 이중 실행 때문에 넘어온 알림까지 사라진다.)
    setNotice(null);
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--spacing-3)',
        }}
      >
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>요청서 목록</h1>
        {canCreate && (
          <LinkButton to="/requests/new">새 요청서</LinkButton>
        )}
      </div>

      {isSupporter && (
        <div role="group" aria-label="목록 범위" style={{ display: 'flex', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-3)' }}>
          <button
            type="button"
            aria-pressed={scope === 'available'}
            style={tabStyle(scope === 'available')}
            onClick={() => updateParams({ scope: '', status: '', page: '' })}
          >
            접수 가능
          </button>
          <button
            type="button"
            aria-pressed={scope === 'mine'}
            style={tabStyle(scope === 'mine')}
            onClick={() => updateParams({ scope: 'mine', status: '', page: '' })}
          >
            내 담당
          </button>
        </div>
      )}

      {isAdmin && (
        // 관리자는 최종 확인을 기다리는 요청서를 한 번에 모아 본다.
        <div role="group" aria-label="목록 바로가기" style={{ display: 'flex', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-3)' }}>
          <button
            type="button"
            aria-pressed={status === ''}
            style={tabStyle(status === '')}
            onClick={() => updateParams({ status: '', page: '' })}
          >
            전체
          </button>
          <button
            type="button"
            aria-pressed={status === 'FINAL_REVIEW'}
            style={tabStyle(status === 'FINAL_REVIEW')}
            onClick={() => updateParams({ status: 'FINAL_REVIEW', page: '' })}
          >
            최종 확인 대기
          </button>
        </div>
      )}

      {showStatusFilter && (
        <div style={{ marginBottom: 'var(--spacing-3)' }}>
          <label htmlFor="status-filter" style={{ marginRight: 'var(--spacing-2)' }}>
            상태
          </label>
          <select
            id="status-filter"
            value={status}
            style={selectStyle}
            onChange={(e) => updateParams({ status: e.target.value, page: '' })}
          >
            <option value="">전체</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      )}

      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          style={{
            ...cardStyle,
            marginBottom: 'var(--spacing-3)',
            borderColor: notice.type === 'error' ? 'var(--color-danger)' : '#16a34a',
            color: notice.type === 'error' ? 'var(--color-danger)' : '#166534',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--spacing-2)',
          }}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => setNotice(null)}
            style={{ background: 'none', border: 'none', fontSize: '1.2rem', minHeight: 'auto', color: 'inherit' }}
          >
            ×
          </button>
        </div>
      )}

      {loading && <Spinner />}

      {!loading && error && (
        <div role="alert" style={{ ...cardStyle, borderColor: 'var(--color-danger)' }}>
          <p style={{ marginTop: 0, color: 'var(--color-danger)' }}>{error}</p>
          <Button variant="ghost" onClick={() => load()}>
            다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && data && data.items.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {status || isSupporter ? '조건에 맞는 요청서가 없습니다.' : '아직 요청서가 없습니다.'}
          {canCreate && !status && (
            <div style={{ marginTop: 'var(--spacing-3)' }}>
              <Link className="tap-link" to="/requests/new">첫 요청서를 작성해보세요</Link>
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: '0 0 var(--spacing-2)' }}>
            총 {data.total}건
          </p>
          <ul style={{ margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-3)' }}>
            {data.items.map((item) => (
              <RequestCard
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onAccept={handleAccept}
                onCancelAccept={setCancelTarget}
                onAssign={setAssignTarget}
              />
            ))}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="페이지 이동"
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 'var(--spacing-3)',
                marginTop: 'var(--spacing-4)',
              }}
            >
              <Button variant="ghost" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
                이전
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
              >
                다음
              </Button>
            </nav>
          )}
        </>
      )}

      <AssignDialog request={assignTarget} onAssign={handleAssign} onClose={() => setAssignTarget(null)} />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="접수 취소"
        message={`"${cancelTarget?.title ?? ''}" 접수를 취소할까요? 요청서가 다시 접수 가능 목록으로 돌아갑니다.`}
        confirmLabel="접수 취소"
        cancelLabel="닫기"
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
