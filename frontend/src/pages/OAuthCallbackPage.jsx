import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { fetchMe } from '../api/auth.api';
import Spinner from '../components/common/Spinner';

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const token = new URLSearchParams(hash).get('token');

    if (!token) {
      navigate('/login?error=access_denied', { replace: true });
      return;
    }

    useAuthStore.getState().setToken(token);

    fetchMe()
      .then((user) => {
        useAuthStore.getState().setUser(user);
        navigate('/requests', { replace: true });
      })
      .catch(() => {
        useAuthStore.getState().logout();
        navigate('/login?error=access_denied', { replace: true });
      });
  }, [navigate]);

  return <Spinner />;
}
