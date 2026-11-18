import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchRequest, parseApiError } from '../api/requests.api';
import { URGENCY_LABELS } from '../constants/requestLabels';
import StatusBadge from '../components/requests/StatusBadge';
import RatingSection from '../components/requests/RatingSection';
import RequestTimeline from '../components/requests/RequestTimeline';
import WorkLogList from '../components/requests/WorkLogList';
import AttachmentList from '../components/attachments/AttachmentList';
import LinkButton from '../components/common/LinkButton';
import Spinner from '../components/common/Spinner';

const sectionStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-4)',
  marginBottom: 'var(--spacing-4)',
  maxWidth: 720,
};

/** 요청서 상세: 요청 내용, 회차별 작업내역, 처리 이력 타임라인을 한 곳에서 본다. */
export default function RequestDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

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
  }, [id, reloadKey]);

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <div role="alert">
        <p style={{ color: 'var(--color-danger)' }}>{loadError}</p>
        <Link className="tap-link" to="/requests">목록으로</Link>
      </div>
    );
  }

  // 지금 이 사람이 할 수 있는 다음 동작(서버가 알려준 플래그를 그대로 따른다).
  const actions = [
    item.canSubmitWork && {
      to: `/requests/${item.id}/work`,
      label: item.status === 'REWORK' ? '재작업 제출' : '작업내역 입력',
    },
    item.canFirstReview && { to: `/requests/${item.id}/review`, label: '1차 확인' },
    item.canFinalReview && { to: `/requests/${item.id}/final-review`, label: '최종 확인' },
    item.canEdit && { to: `/requests/${item.id}/edit`, label: '수정', variant: 'ghost' },
  ].filter(Boolean);

  return (
    <div>
      <p style={{ margin: '0 0 var(--spacing-2)' }}>
        <Link className="tap-link" to="/requests">← 목록으로</Link>
      </p>

      <section style={sectionStyle} aria-label="요청서 내용">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'flex-start' }}>
          <h1 style={{ fontSize: '1.3rem', margin: 0, wordBreak: 'break-word' }}>{item.title}</h1>
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
          <dd style={{ margin: 0 }}>{item.assignee?.name ?? '미접수'}</dd>
          <dt>담당자</dt>
          <dd style={{ margin: 0 }}>
            {item.contactName}
            {item.contactPhone ? ` · ${item.contactPhone}` : ''}
          </dd>
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

      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', marginBottom: 'var(--spacing-4)' }}>
          {actions.map((action) => (
            <LinkButton key={action.to} to={action.to} variant={action.variant}>
              {action.label}
            </LinkButton>
          ))}
        </div>
      )}

      <RatingSection
        item={item}
        style={sectionStyle}
        // 갱신된 요청서가 오면 바로 쓰고, null(이미 평가함)이면 다시 불러온다.
        onRated={(updated) => (updated ? setItem(updated) : setReloadKey((key) => key + 1))}
      />

      <section style={sectionStyle} aria-label="작업내역">
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>작업내역</h2>
        <WorkLogList logs={item.workLogs} attachments={item.attachments} />
      </section>

      <section style={sectionStyle} aria-label="처리 이력">
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>처리 이력</h2>
        <RequestTimeline events={item.events} />
      </section>
    </div>
  );
}
