import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const links = [
  { to: '/requests', label: '요청서 목록' },
  { to: '/settings', label: '설정' },
];

// 역할에 따라 요청서 목록과 설정 사이에 들어가는 메뉴
const adminLinks = [
  { to: '/dashboard', label: '통계' },
  { to: '/hours', label: '근로시간 현황' },
  { to: '/admin', label: '관리' },
];
const supporterLinks = [{ to: '/hours', label: '내 근로시간' }];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, isAdmin, isSupporter, user, logout } = useAuth();
  const roleLinks = isAdmin ? adminLinks : isSupporter ? supporterLinks : [];
  const menu = [links[0], ...roleLinks, links[1]];
  const navigate = useNavigate();

  // 메뉴가 열려 있을 때 Esc로 닫는다.
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  function handleLogout() {
    logout();
    setOpen(false);
    navigate('/login');
  }

  return (
    <header
      style={{
        height: 'var(--header-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--spacing-4)',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div style={{ fontWeight: 700 }}>
        <Link className="tap-link" to="/" style={{ textDecoration: 'none', color: 'var(--color-text)' }}>
          AI 전환 지원요청
        </Link>
      </div>

      {isAuthenticated && (
        <>
          <button
            type="button"
            aria-label="메뉴 열기"
            aria-expanded={open}
            aria-controls="main-menu"
            onClick={() => setOpen((v) => !v)}
            style={{ background: 'none', border: 'none', fontSize: '1.5rem', padding: 0, width: 44 }}
          >
            <span aria-hidden="true">☰</span>
          </button>

          {open && (
            <nav
              id="main-menu"
              aria-label="주 메뉴"
              style={{
                position: 'absolute',
                top: 'var(--header-height)',
                right: 0,
                left: 0,
                background: 'var(--color-surface)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                padding: 'var(--spacing-2) 0',
              }}
            >
              {menu.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={() => setOpen(false)}
                  style={({ isActive }) => ({
                    padding: 'var(--spacing-3) var(--spacing-4)',
                    textDecoration: 'none',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                    fontWeight: isActive ? 700 : 400,
                    background: isActive ? 'var(--color-bg)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                  })}
                >
                  {link.label}
                </NavLink>
              ))}
              <div style={{ padding: 'var(--spacing-3) var(--spacing-4)', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                {user?.name}
                {isAdmin ? ' (관리자)' : ''}
              </div>
              <button
                onClick={handleLogout}
                style={{
                  margin: '0 var(--spacing-4)',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  color: 'var(--color-danger)',
                  padding: 'var(--spacing-2) 0',
                }}
              >
                로그아웃
              </button>
            </nav>
          )}
        </>
      )}
    </header>
  );
}
