import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchRequest, parseApiError, submitWorkLog } from '../api/requests.api';
import { uploadAttachments } from '../api/attachments.api';
import AttachmentList from '../components/attachments/AttachmentList';
import FilePicker from '../components/attachments/FilePicker';
import { URGENCY_LABELS } from '../constants/requestLabels';
import StatusBadge from '../components/requests/StatusBadge';
import WorkLogForm from '../components/requests/WorkLogForm';
import WorkLogList from '../components/requests/WorkLogList';
import { formatDateTime } from '../utils/time';
import { latestRejection } from '../utils/history';
import Spinner from '../components/common/Spinner';

const LIST_PATH = '/requests?scope=mine';

const sectionStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-4)',
  marginBottom: 'var(--spacing-4)',
  maxWidth: 640,
};

/** 담당 지원자가 접수한 요청서의 작업내역을 입력하는 화면. */
export default function RequestWorkPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [files, setFiles] = useState([]); // 이번에 새로 올릴 파일(아직 업로드 전)
  const [pending, setPending] = useState([]); // 이미 올려 둔(제출 전) 파일

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchRequest(id)
      .then((data) => {
        if (!cancelled) {
          setItem(data);
          setPending(data.attachments.filter((file) => file.kind === 'pendingWork'));
        }
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

  async function handleSubmit(body) {
    // 파일을 먼저 올린다. 하나라도 실패하면 작업내역은 제출하지 않고 알려 준다(올라간 파일은 올려 둔 목록에 남는다).
    if (files.length > 0) {
      const { uploaded, failed } = await uploadAttachments(id, 'work', files);
      setPending((prev) => [...prev, ...uploaded]);
      setFiles(failed.map((entry) => entry.file));
      if (failed.length > 0) {
        const names = failed.map((entry) => `${entry.file.name}(${entry.message})`).join(', ');
        throw { message: `파일 ${failed.length}개를 올리지 못해 제출하지 않았습니다: ${names}`, details: {} };
      }
    }
    try {
      await submitWorkLog(id, body);
    } catch (err) {
      // 폼이 항목별 오류를 보여줄 수 있도록 { message, details } 로 바꿔 던진다.
      throw parseApiError(err);
    }
    navigate(LIST_PATH, {
      replace: true,
      state: {
        notice: {
          type: 'success',
          text:
            item.status === 'REWORK'
              ? `"${item.title}" 재작업한 작업내역을 다시 제출했습니다. 요청자의 1차 확인을 기다립니다.`
              : `"${item.title}" 작업내역을 제출했습니다. 요청자의 1차 확인을 기다립니다.`,
        },
      },
    });
  }

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <div role="alert">
        <p style={{ color: 'var(--color-danger)' }}>{loadError}</p>
        <Link className="tap-link" to={LIST_PATH}>내 담당 목록으로</Link>
      </div>
    );
  }

  if (!item.canSubmitWork) {
    return (
      <div>
        <p>이미 제출했거나 작업내역을 입력할 수 없는 요청서입니다.</p>
        <Link className="tap-link" to={LIST_PATH}>내 담당 목록으로</Link>
      </div>
    );
  }

  const reworking = item.status === 'REWORK';
  const rejection = reworking ? latestRejection(item.events) : null;
  const lastLog = item.workLogs.at(-1);

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginBottom: 'var(--spacing-3)' }}>{reworking ? '재작업 제출' : '작업내역 입력'}</h1>

      {rejection && (
        <section
          role="alert"
          aria-label="반려 사유"
          style={{ ...sectionStyle, borderColor: 'var(--color-danger)', background: 'var(--color-overdue-bg)' }}
        >
          <strong style={{ color: 'var(--color-overdue-text)' }}>
            {rejection.actor?.name ?? '-'}님이 {rejection.type === 'FINAL_REJECT' ? '최종 확인' : '1차 확인'}에서 반려했습니다
          </strong>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{formatDateTime(rejection.createdAt)}</div>
          <p style={{ margin: 'var(--spacing-2) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{rejection.reason}</p>
        </section>
      )}

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
            <strong style={{ fontSize: '0.9rem' }}>요청서 첨부파일</strong>
            <AttachmentList attachments={item.attachments.filter((file) => file.kind === 'request')} />
          </div>
        )}
      </section>

      {reworking && item.workLogs.length > 0 && (
        <section style={sectionStyle} aria-label="이전 작업내역">
          <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>이전에 제출한 작업내역</h2>
          <WorkLogList logs={item.workLogs} attachments={item.attachments} />
        </section>
      )}

      <section style={sectionStyle} aria-label="작업내역 첨부파일">
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>첨부파일 (선택)</h2>
        <AttachmentList
          attachments={pending}
          deletable
          onDeleted={(deletedId) => setPending((prev) => prev.filter((file) => file.id !== deletedId))}
        />
        <FilePicker files={files} onChange={setFiles} existingCount={pending.length} />
        <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          올려 둔 파일은 작업내역을 제출할 때 함께 제출됩니다. 제출 후에는 지울 수 없습니다.
        </p>
      </section>

      <WorkLogForm
        onSubmit={handleSubmit}
        cancelTo={LIST_PATH}
        submitLabel={reworking ? '다시 제출' : '작업내역 제출'}
        initialContent={reworking ? (lastLog?.content ?? '') : ''}
      />
    </div>
  );
}
