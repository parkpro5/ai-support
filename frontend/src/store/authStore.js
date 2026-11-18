import { create } from 'zustand';

const TOKEN_KEY = 'ai_support_token';

export const useAuthStore = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  isLoading: true,

  setToken: (token) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ token });
  },

  setUser: (user) => set({ user, isLoading: false }),

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    // 오프라인 조회용 API 캐시도 함께 폐기 — 로그아웃 후 다른 계정으로 쓰는
    // 기기에서 이전 사용자 데이터가 오프라인에 남지 않도록.
    if ('caches' in window) {
      caches.delete('api-read-cache').catch(() => {});
    }
    set({ token: null, user: null, isLoading: false });
  },
}));
