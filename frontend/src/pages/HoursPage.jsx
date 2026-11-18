import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { fetchHoursByMonth, fetchMyHours } from '../api/stats.api';
import { parseApiError } from '../api/requests.api';
import Spinner from '../components/common/Spinner';
import StatusBadge from '../components/requests/StatusBadge';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime, formatMinutes, formatMonth } from '../utils/time';

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-3) var(--spacing-4)',
};

const mutedStyle = { color: 'var(--color-text-muted)', fontSize: '0.9rem' };

/** 분(minute) 값을 "1시간 30분"으로. 0분은 "0분". */
const duration = (minutes) => formatMinutes(minutes) || '0분';

/** 화면이 서버에서 데이터를 받아 오는 공통 흐름. month가 바뀌면 다시 받는다. */
function useHours(fetcher, month) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(month ? { month } : {})
      .then((result) => {
        if (!cancelled) setData(result);
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
  }, [fetcher, month]);

  return { data, loading, error };
}

function MonthSelect({ value, options, onChange }) {
  // 선택한 달이 최근 12개월 밖이어도 선택지에 보이게 한다.
  const list = options.includes(value) ? options : [value, ...options];
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)', fontWeight: 600 }}>
      조회할 달
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '8px 12px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          minHeight: 'var(--touch-target)',
        }}
      >
        {list.map((month) => (
          <option key={month} value={month}>
            {formatMonth(month)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Total({ minutes, logs, label }) {
  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={mutedStyle}>{label}</span>
      <strong style={{ fontSize: '1.6rem' }}>{duration(minutes)}</strong>
      <span style={mutedStyle}>작업내역 {logs}건</span>
    </div>
  );
}

// ── 지원자: 내 근로시간 ────────────────────────────────────

function MyHours() {
  const [month, setMonth] = useState(null); // null이면 서버가 이번 달로 정한다
  const { data, loading, error } = useHours(fetchMyHours, month);

  if (error) {
    return (
      <div role="alert" style={{ ...cardStyle, color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
        {error}
      </div>
    );
  }
  if (!data) return <Spinner />;

  return (
    <>
      <div style={{ marginBottom: 'var(--spacing-3)' }}>
        <MonthSelect value={data.month} options={data.monthOptions} onChange={setMonth} />
      </div>

      <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1, display: 'grid', gap: 'var(--spacing-4)' }}>
        <Total label={`${formatMonth(data.month)} 근로시간`} minutes={data.totalMinutes} logs={data.totalLogs} />

        <section>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 var(--spacing-2)' }}>{formatMonth(data.month)} 작업 내역</h2>
          {data.entries.length === 0 ? (
            <p style={{ ...cardStyle, ...mutedStyle, margin: 0 }}>이 달에 제출한 작업내역이 없습니다.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-2)' }}>
              {data.entries.map((entry) => (
                <li key={entry.id} style={{ ...cardStyle, display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'baseline' }}>
                    <Link className="tap-link" to={`/requests/${entry.requestId}`} style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                      {entry.title}
                    </Link>
                    <strong style={{ whiteSpace: 'nowrap' }}>{duration(entry.minutes)}</strong>
                  </div>
                  <div style={{ ...mutedStyle, display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)', alignItems: 'center' }}>
                    <span>{entry.round}회차 제출</span>
                    <span>{formatDateTime(entry.submittedAt)}</span>
                    <StatusBadge status={entry.requestStatus} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 var(--spacing-2)' }}>월별 누적 (최근 12개월)</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-1)' }}>
            {data.months.map((row) => {
              const selected = row.month === data.month;
              return (
                <li key={row.month}>
                  <button
                    type="button"
                    onClick={() => setMonth(row.month)}
                    aria-pressed={selected}
                    style={{
                      ...cardStyle,
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      minHeight: 'var(--touch-target)',
                      textAlign: 'left',
                      borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                      fontWeight: selected ? 700 : 400,
                    }}
                  >
                    <span>{formatMonth(row.month)}</span>
                    <span>
                      {duration(row.minutes)}
                      <span style={{ ...mutedStyle, marginLeft: 8 }}>{row.logCount}건</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

// ── 관리자: 지원자별 현황 ──────────────────────────────────

function AdminHours() {
  const [month, setMonth] = useState(null);
  const { data, loading, error } = useHours(fetchHoursByMonth, month);

  if (error) {
    return (
      <div role="alert" style={{ ...cardStyle, color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
        {error}
      </div>
    );
  }
  if (!data) return <Spinner />;

  return (
    <>
      <div style={{ marginBottom: 'var(--spacing-3)' }}>
        <MonthSelect value={data.month} options={data.monthOptions} onChange={setMonth} />
      </div>

      <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1, display: 'grid', gap: 'var(--spacing-4)' }}>
        <Total label={`${formatMonth(data.month)} 전체 근로시간`} minutes={data.totalMinutes} logs={data.totalLogs} />

        <section>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 var(--spacing-2)' }}>지원자별</h2>
          {data.supporters.length === 0 ? (
            <p style={{ ...cardStyle, ...mutedStyle, margin: 0 }}>지원자가 없습니다. 관리 화면에서 지원자를 지정해 주세요.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-1)' }}>
              {data.supporters.map((row) => (
                <li
                  key={row.id}
                  style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'baseline' }}
                >
                  <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{row.name}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <strong>{duration(row.minutes)}</strong>
                    <span style={{ ...mutedStyle, marginLeft: 8 }}>{row.logCount}건</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function HoursPage() {
  const { isAdmin, isSupporter } = useAuth();

  // 근로시간은 지원자(본인)와 관리자(현황)만 본다. 요청자는 요청서 목록으로 보낸다.
  if (!isAdmin && !isSupporter) return <Navigate to="/requests" replace />;

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginTop: 0 }}>{isAdmin ? '근로시간 현황' : '내 근로시간'}</h1>
      <p style={{ ...mutedStyle, marginTop: 0 }}>
        제출한 작업내역의 소요 시간을 한국 시간 기준 월별로 더한 값입니다. 재작업으로 다시 제출한 회차도 각각 포함하며, 금액은 계산하지 않습니다.
      </p>
      {isAdmin ? <AdminHours /> : <MyHours />}
    </div>
  );
}
