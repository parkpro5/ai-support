import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const { token, user, isLoading, logout } = useAuthStore();
  return {
    token,
    user,
    isLoading,
    isAuthenticated: Boolean(token && user),
    isAdmin: user?.role === 'ADMIN',
    isSupporter: user?.role === 'SUPPORTER',
    logout,
  };
}
