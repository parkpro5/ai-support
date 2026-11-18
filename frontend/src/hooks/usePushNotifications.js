import { useCallback, useEffect, useState } from 'react';
import { subscribePush, unsubscribePush } from '../api/push.api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
// 푸시 구독에는 서버의 VAPID 공개키가 필요하다. 배포 환경변수에 없으면 구독할 수 없다.
const isConfigured = Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY);

export function usePushNotifications() {
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(isSupported);

  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .finally(() => setLoading(false));
  }, []);

  const subscribe = useCallback(async () => {
    if (!isConfigured) return false;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    });
    await subscribePush(subscription.toJSON());
    setSubscribed(true);
    return true;
  }, []);

  const unsubscribe = useCallback(async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await unsubscribePush(subscription.endpoint);
      await subscription.unsubscribe();
    }
    setSubscribed(false);
  }, []);

  return { isSupported, isConfigured, subscribed, loading, subscribe, unsubscribe };
}
