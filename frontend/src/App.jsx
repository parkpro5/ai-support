import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { fetchMe } from './api/auth.api';
import AppRouter from './routes/AppRouter';

export default function App() {
  useEffect(() => {
    const { token, setUser, logout } = useAuthStore.getState();
    if (!token) {
      useAuthStore.setState({ isLoading: false });
      return;
    }
    fetchMe()
      .then(setUser)
      .catch((error) => {
        if (error.response?.status === 401) {
          // 인증이 실제로 만료/무효일 때만 로그아웃.
          logout();
        } else {
          // 네트워크 단절(응답 없음)이나 서버 장애(502 등)에는 토큰을 유지 —
          // 지워버리면 서버 복구/재접속 후에도 재로그인해야 한다.
          // (오프라인 조회는 서비스워커가 캐시한 /api/auth/me 응답으로 동작하고,
          //  캐시조차 없는 최초 오프라인 방문만 이 경로로 로그인 화면에 머문다)
          useAuthStore.setState({ isLoading: false });
        }
      });
  }, []);

  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  );
}
