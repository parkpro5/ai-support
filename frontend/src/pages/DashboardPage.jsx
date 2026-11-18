import { useEffect, useState } from 'react';
import { fetchDashboardSummary, fetchDashboardSupporters } from '../api/stats.api';
import { parseApiError } from '../api/requests.api';
import Spinner from '../components/common/Spinner';
import StatusBadge from '../components/requests/StatusBadge';
import { STATUS_OPTIONS } from '../constants/requestLabels';
import { formatElapsed, formatMinutes, formatMonth } from '../utils/time';

const PERIOD_OPTIONS = [3, 6, 12, 24];

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-3) var(--spacing-4)',
};

const mutedStyle = { color: 'var(--color-text-muted)', fontSize: '0.9rem' };
const headingStyle = { fontSize: '1.05rem', margin: '0 0 var(--spacing-2)' };
const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-1)' };

/** 값이 없으면(null) "-"로. 0과 "집계 대상 없음"을 구분해 보여준다. */
const orDash = (value, format) => (value === null || value === undefined ? '-' : format(value));

/** 평균 만족도: "4.5점" */
const formatRating = (score) => `${score}점`;

/** CSS 막대. 값은 옆의 글자로도 항상 보여주므로 막대는 보조 표시다. */
function Bar({ value, max }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <span
      aria-hidden="true"
      style={{ display: 'block', height: 10, borderRadius: 5, background: 'var(--color-bg)', overflow: 'hidden' }}
    >
      <span
        style={{
          display: 'block',
          height: '100%',
          width: `${percent}%`,
          minWidth: value > 0 ? 4 : 0,
          background: 'var(--color-primary)',
        }}
      />
    </span>
  );
}

function Kpi({ label, value, note }) {
  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={mutedStyle}>{label}</span>
      <strong style={{ fontSize: '1.5rem' }}>{value}</strong>
      {note && <span style={mutedStyle}>{note}</span>}
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div role="alert" style={{ ...cardStyle, color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
      {message}
    </div>
  );
}

function MonthlySection({ months }) {
  const max = Math.max(0, ...months.map((row) => row.completedCount));
  return (
    <section aria-label="달별 완료 건수">
      <h2 style={headingStyle}>달별 완료 건수</h2>
      <ul style={listStyle}>
        {months.map((row) => (
          <li key={row.month} style={{ ...cardStyle, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{formatMonth(row.month)}</span>
              <span>
                <strong>{row.completedCount}건</strong>
                <span style={{ ...mutedStyle, marginLeft: 8 }}>
                  평균 처리 {orDash(row.avgProcessingMinutes, formatElapsed)}
                </span>
              </span>
            </div>
            <Bar value={row.completedCount} max={max} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TypeSection({ byType }) {
  const max = Math.max(0, ...byType.map((row) => row.requested));
  return (
    <section aria-label="지원 유형별 건수">
      <h2 style={headingStyle}>지원 유형별 건수</h2>
      {byType.length === 0 ? (
        <p style={{ ...cardStyle, ...mutedStyle, margin: 0 }}>지원 유형이 없습니다.</p>
      ) : (
        <ul style={listStyle}>
          {byType.map((row) => (
            <li key={row.id} style={{ ...cardStyle, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{row.name}</span>
                <span>
                  <strong>요청 {row.requested}건</strong>
                  <span style={{ ...mutedStyle, marginLeft: 8 }}>완료 {row.completed}건</span>
                </span>
              </div>
              <Bar value={row.requested} max={max} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt style={mutedStyle}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
    </div>
  );
}

function SupporterSection({ supporters }) {
  return (
    <section aria-label="지원자별 현황">
      <h2 style={headingStyle}>지원자별 현황</h2>
      {supporters.length === 0 ? (
        <p style={{ ...cardStyle, ...mutedStyle, margin: 0 }}>지원자가 없습니다. 관리 화면에서 지원자를 지정해 주세요.</p>
      ) : (
        <ul style={listStyle}>
          {supporters.map((row) => (
            <li key={row.id} style={{ ...cardStyle, display: 'grid', gap: 'var(--spacing-2)' }}>
              <span style={{ fontWeight: 700, wordBreak: 'break-word' }}>{row.name}</span>
              <dl
                style={{
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 'var(--spacing-2)',
                }}
              >
                <Stat label="완료 건수" value={`${row.completedCount}건`} />
                <Stat label="평균 처리 시간" value={orDash(row.avgProcessingMinutes, formatElapsed)} />
                <Stat label="근로시간" value={`${formatMinutes(row.workMinutes) || '0분'} (${row.workLogCount}건)`} />
                <Stat
                  label="평균 만족도"
                  value={row.avgRating === null ? '-' : `${formatRating(row.avgRating)} (${row.ratingCount}건)`}
                />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 관리자 통계 대시보드: 기간별 처리 현황, 유형별 건수, 지원자별 현황을 표와 CSS 막대로 보여준다. */
export default function DashboardPage() {
  const [months, setMonths] = useState(6);
  const [summary, setSummary] = useState(null);
  const [supporters, setSupporters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchDashboardSummary({ months }), fetchDashboardSupporters({ months })])
      .then(([summaryData, supporterData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setSupporters(supporterData.supporters);
      })
      .catch((err) => {
        if (!cancelled) setError(parseApiError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginTop: 0 }}>통계 대시보드</h1>
      <p style={{ ...mutedStyle, marginTop: 0 }}>
        처리 건수와 평균 처리 시간은 최종 확인으로 <strong>완료된 시점</strong>(한국 시간)이 조회 기간에 든 요청서를 기준으로 합니다. 처리 시간은 요청서 제출부터
        완료까지이며 재작업으로 걸린 시간도 포함합니다.
      </p>

      <div style={{ marginBottom: 'var(--spacing-3)' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)', fontWeight: 600 }}>
          조회 기간
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              minHeight: 'var(--touch-target)',
            }}
          >
            {PERIOD_OPTIONS.map((value) => (
              <option key={value} value={value}>
                최근 {value}개월
              </option>
            ))}
          </select>
        </label>
        {summary && (
          <span style={{ ...mutedStyle, marginLeft: 'var(--spacing-2)' }}>
            {formatMonth(summary.from)} ~ {formatMonth(summary.to)}
          </span>
        )}
      </div>

      {error && <ErrorBox message={error} />}
      {!error && !summary && <Spinner />}

      {!error && summary && supporters && (
        <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1, display: 'grid', gap: 'var(--spacing-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--spacing-2)' }}>
            <Kpi label="완료 건수" value={`${summary.completedCount}건`} />
            <Kpi label="평균 처리 시간" value={orDash(summary.avgProcessingMinutes, formatElapsed)} note="제출 → 완료" />
            <Kpi
              label="평균 만족도"
              value={summary.avgRating === null ? '-' : formatRating(summary.avgRating)}
              note={`평가 ${summary.ratingCount}건`}
            />
            <Kpi label="요청 접수" value={`${summary.requestedCount}건`} note="기간 중 제출된 요청서" />
          </div>

          <section aria-label="현재 상태별 건수">
            <h2 style={headingStyle}>현재 상태별 건수</h2>
            <p style={{ ...mutedStyle, margin: '0 0 var(--spacing-2)' }}>조회 기간과 상관없이 지금 요청서가 어느 단계에 있는지 보여줍니다.</p>
            <ul style={{ ...listStyle, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              {STATUS_OPTIONS.map((status) => (
                <li key={status} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <StatusBadge status={status} />
                  <strong>{summary.currentStatus[status] ?? 0}건</strong>
                </li>
              ))}
            </ul>
          </section>

          <MonthlySection months={summary.months} />
          <TypeSection byType={summary.byType} />
          <SupporterSection supporters={supporters} />
        </div>
      )}
    </div>
  );
}
