import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchRequest, parseApiError, reviewFinal, reviewFirst } from '../api/requests.api';
import { URGENCY_LABELS } from '../constants/requestLabels';
import StatusBadge from '../components/requests/StatusBadge';
import WorkLogList from '../components/requests/WorkLogList';
import AttachmentList from '../components/attachments/AttachmentList';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import FormField from '../components/common/FormField';
import Spinner from '../components/common/Spinner';

const LIST_PATH = '/requests';
const MAX_REASON_LENGTH = 2000;

/** 확인 단계별 차이: 어떤 API·권한 플래그를 쓰고 어떤 문구를 보여주는지. */
const STAGES = {
  first: {
    title: '1차 확인',
    canKey: 'canFirstReview',
    review: reviewFirst,
    unavailable: '이미 확인했거나 1차 확인을 할 수 없는 요청서입니다.',
    approveMessage: '작업내역을 승인할까요? 승인하면 관리자의 최종 확인으로 넘어가며 되돌릴 수 없습니다.',
    approvedNotice: (title) => `"${title}" 작업내역을 승인했습니다. 관리자의 최종 확인을 기다립니다.`,
    rejectedNotice: (title) => `"${title}" 작업내역을 반려했습니다. 담당 지원자가 다시 작업합니다.`,
  },
  final: {
    title: '최종 확인',
    canKey: 'canFinalReview',
    review: reviewFinal,
    unavailable: '이미 확인했거나 최종 확인을 할 수 없는 요청서입니다.',
    approveMessage: '최종 승인할까요? 승인하면 요청서가 완료 처리되며 되돌릴 수 없습니다.',
    approvedNotice: (title) => `"${title}" 요청서를 최종 승인했습니다. 완료 처리되었습니다.`,
    rejectedNotice: (title) => `"${title}" 작업내역을 반려했습니다. 담당 지원자가 다시 작업합니다.`,
  },
};

const sectionStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-4)',
  marginBottom: 'var(--spacing-4)',
  maxWidth: 640,
};

/**
 * 작업내역을 확인(승인·반려)하는 화면. stage가 first이면 요청서 작성자의 1차 확인, final이면 관리자의 최종 확인이다.
 * @param {{ stage: 'first'|'final' }} props
 */
export default function RequestReviewPage({ stage = 'first' }) {
  const config = STAGES[stage];
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [approving, setApproving] = useState(false); // 승인 확인창
  const [rejecting, setRejecting] = useState(false); // 반려 사유 입력 폼 표시
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchRequest(id)
      .then((data) => {
        if (!cancelled) setItem(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(parseApiError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function done(text) {
    navigate(LIST_PATH, { replace: true, state: { notice: { type: 'success', text } } });
  }

  async function handleApprove() {
    setActionError(null);
    try {
      await config.review(id, { decision: 'APPROVE' });
      done(config.approvedNotice(item.title));
    } catch (err) {
      setApproving(false);
      setActionError(parseApiError(err).message);
    }
  }

  async function handleReject(e) {
    e.preventDefault();
    setActionError(null);

    if (!reason.trim()) {
      setReasonError('반려 사유를 입력해 주세요');
      e.currentTarget.elements.reason?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await config.review(id, { decision: 'REJECT', reason: reason.trim() });
      done(config.rejectedNotice(item.title));
    } catch (err) {
      const { message, details } = parseApiError(err);
      if (details.reason) setReasonError(details.reason);
      else setActionError(message);
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <div role="alert">
        <p style={{ color: 'var(--color-danger)' }}>{loadError}</p>
        <Link className="tap-link" to={LIST_PATH}>목록으로</Link>
      </div>
    );
  }

  if (!item[config.canKey]) {
    return (
      <div>
        <p>{config.unavailable}</p>
        <Link className="tap-link" to={LIST_PATH}>목록으로</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginBottom: 'var(--spacing-3)' }}>{config.title}</h1>

      <section style={sectionStyle} aria-label="요청서 내용">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'flex-start' }}>
          <h2 style={{ fontSize: '1.05rem', margin: 0, wordBreak: 'break-word' }}>{item.title}</h2>
          <StatusBadge status={item.status} />
        </div>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '2px var(--spacing-3)',
            margin: 'var(--spacing-3) 0',
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
          <dt>담당 지원자</dt>
          <dd style={{ margin: 0 }}>{item.assignee?.name ?? '-'}</dd>
          <dt>희망 완료일</dt>
          <dd style={{ margin: 0 }}>
            {item.desiredDate} · 긴급도 {URGENCY_LABELS[item.urgency] ?? item.urgency}
          </dd>
        </dl>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</p>
        {item.attachments.some((file) => file.kind === 'request') && (
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <strong style={{ fontSize: '0.9rem' }}>첨부파일</strong>
            <AttachmentList attachments={item.attachments.filter((file) => file.kind === 'request')} />
          </div>
        )}
      </section>

      <section style={sectionStyle} aria-label="작업내역">
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>제출된 작업내역</h2>
        <WorkLogList logs={item.workLogs} attachments={item.attachments} />
      </section>

      {actionError && (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {actionError}
        </p>
      )}

      {!rejecting ? (
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
          <Button onClick={() => setApproving(true)}>승인</Button>
          <Button variant="danger" onClick={() => setRejecting(true)}>
            반려
          </Button>
          <Link className="tap-link" to={LIST_PATH} style={{ alignSelf: 'center' }}>
            나중에 확인
          </Link>
        </div>
      ) : (
        <form onSubmit={handleReject} noValidate style={{ maxWidth: 640 }}>
          <FormField
            label="반려 사유"
            required
            error={reasonError}
            hint="담당 지원자가 무엇을 고쳐야 하는지 알 수 있게 적어 주세요."
          >
            {(a11y) => (
              <textarea
                rows={5}
                maxLength={MAX_REASON_LENGTH}
                name="reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (reasonError) setReasonError(null);
                }}
                {...a11y}
                style={{ ...a11y.style, resize: 'vertical' }}
              />
            )}
          </FormField>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
            <Button type="submit" variant="danger" loading={submitting}>
              반려하기
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                setRejecting(false);
                setReason('');
                setReasonError(null);
              }}
            >
              취소
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={approving}
        title={`${config.title} 승인`}
        message={config.approveMessage}
        confirmLabel="승인"
        confirmVariant="primary"
        cancelLabel="닫기"
        onConfirm={handleApprove}
        onCancel={() => setApproving(false)}
      />
    </div>
  );
}
