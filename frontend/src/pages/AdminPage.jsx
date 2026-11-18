import { useCallback, useEffect, useState } from 'react';
import {
  createSupportType,
  fetchAllSupportTypes,
  fetchUsers,
  setUserRole,
  updateSupportType,
} from '../api/admin.api';
import { parseApiError } from '../api/requests.api';
import Button from '../components/common/Button';
import Spinner from '../components/common/Spinner';

const PAGE_SIZE = 20;

const ROLE_LABELS = { REQUESTER: '요청자', SUPPORTER: '지원자', ADMIN: '관리자' };

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--spacing-3) var(--spacing-4)',
};

const inputStyle = {
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

function Notice({ notice, onClose }) {
  if (!notice) return null;
  const isError = notice.type === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{
        ...cardStyle,
        marginBottom: 'var(--spacing-3)',
        borderColor: isError ? 'var(--color-danger)' : '#16a34a',
        color: isError ? 'var(--color-danger)' : '#166534',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--spacing-2)',
      }}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        aria-label="알림 닫기"
        onClick={onClose}
        style={{ background: 'none', border: 'none', fontSize: '1.2rem', minHeight: 'auto', color: 'inherit' }}
      >
        ×
      </button>
    </div>
  );
}

function RoleBadge({ role }) {
  const colors = {
    REQUESTER: { color: '#374151', background: '#e5e7eb' },
    SUPPORTER: { color: '#1d4ed8', background: '#dbeafe' },
    ADMIN: { color: '#6d28d9', background: '#ede9fe' },
  };
  return (
    <span
      style={{
        ...colors[role],
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: '0.8rem',
        fontWeight: 700,
      }}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ── 사용자 ─────────────────────────────────────────────────

function UsersTab() {
  const [role, setRole] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(''); // 검색 버튼을 눌렀을 때 적용되는 값
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError(null);
      return fetchUsers({ page, pageSize: PAGE_SIZE, ...(role ? { role } : {}), ...(search ? { q: search } : {}) })
        .then(setData)
        .catch((err) => setError(parseApiError(err).message))
        .finally(() => setLoading(false));
    },
    [page, role, search]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function handleRoleChange(user, nextRole) {
    setBusyId(user.id);
    setNotice(null);
    try {
      await setUserRole(user.id, nextRole);
      setNotice({
        type: 'success',
        text: `${user.name}님을 ${ROLE_LABELS[nextRole]}(으)로 바꿨습니다. 다음 요청부터 바로 적용됩니다.`,
      });
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message });
    } finally {
      setBusyId(null);
      load({ silent: true });
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', marginBottom: 'var(--spacing-3)' }}>
        <label htmlFor="user-role-filter" className="sr-only">
          역할
        </label>
        <select
          id="user-role-filter"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          style={inputStyle}
        >
          <option value="">모든 역할</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="user-search" className="sr-only">
          이름 또는 이메일 검색
        </label>
        <input
          id="user-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 또는 이메일"
          maxLength={100}
          style={{ ...inputStyle, flex: '1 1 180px' }}
        />
        <Button type="submit" variant="ghost">
          검색
        </Button>
      </form>

      <Notice notice={notice} onClose={() => setNotice(null)} />

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
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>조건에 맞는 사용자가 없습니다.</div>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: '0 0 var(--spacing-2)' }}>총 {data.total}명</p>
          <ul style={{ margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-2)' }}>
            {data.items.map((user) => (
              <li
                key={user.id}
                style={{ ...cardStyle, listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-3)', alignItems: 'center', flexWrap: 'wrap' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                    {user.name} <RoleBadge role={user.role} />
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>{user.email}</div>
                </div>
                {user.role === 'REQUESTER' && (
                  <Button loading={busyId === user.id} onClick={() => handleRoleChange(user, 'SUPPORTER')}>
                    지원자로 지정
                  </Button>
                )}
                {user.role === 'SUPPORTER' && (
                  <Button variant="ghost" loading={busyId === user.id} onClick={() => handleRoleChange(user, 'REQUESTER')}>
                    지원자 해제
                  </Button>
                )}
                {user.role === 'ADMIN' && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>변경할 수 없음</span>}
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav aria-label="페이지 이동" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}>
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                이전
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                다음
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

// ── 지원 유형 ───────────────────────────────────────────────

function SupportTypeRow({ type, busy, onRename, onToggle }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);

  async function handleSave(e) {
    e.preventDefault();
    const ok = await onRename(type, name);
    if (ok) setEditing(false);
  }

  return (
    <li
      style={{
        ...cardStyle,
        listStyle: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--spacing-3)',
        alignItems: 'center',
        flexWrap: 'wrap',
        opacity: type.active ? 1 : 0.75,
      }}
    >
      {editing ? (
        <form onSubmit={handleSave} style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', flex: '1 1 220px' }}>
          <label htmlFor={`type-name-${type.id}`} className="sr-only">
            지원 유형 이름
          </label>
          <input
            id={`type-name-${type.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            autoFocus
            style={{ ...inputStyle, flex: '1 1 160px' }}
          />
          <Button type="submit" loading={busy}>
            저장
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setName(type.name);
            }}
          >
            취소
          </Button>
        </form>
      ) : (
        <>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
              {type.name}{' '}
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: type.active ? '#166534' : '#6b7280',
                  background: type.active ? '#dcfce7' : '#e5e7eb',
                }}
              >
                {type.active ? '사용 중' : '사용 안 함'}
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>요청서 {type.requestCount}건에서 사용</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
              이름 변경
            </Button>
            <Button variant={type.active ? 'ghost' : 'primary'} loading={busy} onClick={() => onToggle(type)}>
              {type.active ? '사용 중지' : '다시 사용'}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

function SupportTypesTab() {
  const [types, setTypes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    return fetchAllSupportTypes()
      .then(setTypes)
      .catch((err) => setError(parseApiError(err).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) {
      setNotice({ type: 'error', text: '이름을 입력해 주세요' });
      return;
    }
    setAdding(true);
    setNotice(null);
    try {
      await createSupportType(newName.trim());
      setNewName('');
      setNotice({ type: 'success', text: '지원 유형을 추가했습니다.' });
      await load({ silent: true });
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message });
    } finally {
      setAdding(false);
    }
  }

  /** @returns {Promise<boolean>} 성공 여부 */
  async function update(type, body, successText) {
    setBusyId(type.id);
    setNotice(null);
    try {
      await updateSupportType(type.id, body);
      setNotice({ type: 'success', text: successText });
      await load({ silent: true });
      return true;
    } catch (err) {
      setNotice({ type: 'error', text: parseApiError(err).message });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const handleRename = (type, name) => update(type, { name: name.trim() }, '이름을 바꿨습니다.');
  const handleToggle = (type) =>
    update(
      type,
      { active: !type.active },
      type.active ? `"${type.name}"을(를) 사용 중지했습니다. 새 요청서에서는 선택할 수 없습니다.` : `"${type.name}"을(를) 다시 사용합니다.`
    );

  return (
    <div>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', marginBottom: 'var(--spacing-3)' }}>
        <label htmlFor="new-type-name" className="sr-only">
          새 지원 유형 이름
        </label>
        <input
          id="new-type-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="새 지원 유형 이름"
          maxLength={50}
          style={{ ...inputStyle, flex: '1 1 200px' }}
        />
        <Button type="submit" loading={adding}>
          추가
        </Button>
      </form>

      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
        유형은 삭제하지 않고 "사용 중지"만 할 수 있습니다. 이미 작성된 요청서에는 그대로 남습니다.
      </p>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loading && <Spinner />}

      {!loading && error && (
        <div role="alert" style={{ ...cardStyle, borderColor: 'var(--color-danger)' }}>
          <p style={{ marginTop: 0, color: 'var(--color-danger)' }}>{error}</p>
          <Button variant="ghost" onClick={() => load()}>
            다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && types && types.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>등록된 지원 유형이 없습니다.</div>
      )}

      {!loading && !error && types && types.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: 'grid', gap: 'var(--spacing-2)' }}>
          {types.map((type) => (
            <SupportTypeRow key={type.id} type={type} busy={busyId === type.id} onRename={handleRename} onToggle={handleToggle} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 관리자 전용 화면: 사용자의 지원자 지정과 지원 유형 관리. */
export default function AdminPage() {
  const [tab, setTab] = useState('users');

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginBottom: 'var(--spacing-3)' }}>관리</h1>

      <div role="group" aria-label="관리 메뉴" style={{ display: 'flex', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-4)' }}>
        <button type="button" aria-pressed={tab === 'users'} style={tabStyle(tab === 'users')} onClick={() => setTab('users')}>
          사용자
        </button>
        <button type="button" aria-pressed={tab === 'types'} style={tabStyle(tab === 'types')} onClick={() => setTab('types')}>
          지원 유형
        </button>
      </div>

      {tab === 'users' ? <UsersTab /> : <SupportTypesTab />}
    </div>
  );
}
