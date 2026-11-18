import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { currentNeedsHomeScreenInstall } from '../utils/platform';
import Button from '../components/common/Button';

// 역할별로 어떤 알림이 오는지(서버의 알림 대상 규칙과 같아야 한다).
const NOTIFICATION_GUIDE = {
  REQUESTER: '작업내역 확인 요청(1차 확인)이 오거나 요청서가 완료되면 알려드립니다.',
  SUPPORTER: '새 지원요청이 올라오거나, 요청서가 배정·반려·완료되면 알려드립니다.',
  ADMIN: '1차 확인이 끝나 최종 확인이 필요한 요청서가 생기면 알려드립니다.',
};

export default function SettingsPage() {
  const { user } = useAuth();
  const push = usePushNotifications();
  // iPhone·iPad는 홈 화면에 추가한 앱에서만 알림을 켤 수 있다.
  const needsInstall = currentNeedsHomeScreenInstall();
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(false);

  async function handlePushSubscribe() {
    setPushBusy(true);
    setPushError(false);
    try {
      const granted = await push.subscribe();
      if (!granted) setPushError(true);
    } catch {
      setPushError(true);
    } finally {
      setPushBusy(false);
    }
  }

  async function handlePushUnsubscribe() {
    setPushBusy(true);
    try {
      await push.unsubscribe();
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginBottom: 'var(--spacing-3)' }}>설정</h1>

      <section
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: 'var(--spacing-4)',
        }}
      >
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>알림</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {NOTIFICATION_GUIDE[user?.role] ?? '요청서 상태가 바뀌면 이 기기로 알림을 받습니다.'} 알림은 켠 기기마다 따로 설정합니다.
        </p>

        {needsInstall && (
          <div
            role="note"
            style={{
              padding: 'var(--spacing-3)',
              borderRadius: 'var(--radius)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              marginBottom: 'var(--spacing-3)',
            }}
          >
            <strong>iPhone·iPad는 홈 화면에 추가해야 알림을 받을 수 있습니다.</strong>
            <ol style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: '1.2em' }}>
              <li>Safari로 이 사이트를 엽니다.</li>
              <li>아래(또는 위)의 공유 버튼을 누르고 "홈 화면에 추가"를 선택합니다.</li>
              <li>홈 화면에 생긴 앱 아이콘으로 다시 열어 이 화면에서 알림을 켭니다.</li>
            </ol>
          </div>
        )}

        {!needsInstall && !push.isSupported && (
          <p style={{ color: 'var(--color-text-muted)' }}>이 브라우저는 알림을 지원하지 않습니다.</p>
        )}
        {push.isSupported && !push.isConfigured && (
          <p style={{ color: 'var(--color-danger)' }}>
            알림 서버 설정이 되어 있지 않아 알림을 켤 수 없습니다. 관리자에게 문의해 주세요.
          </p>
        )}
        {pushError && (
          <p style={{ color: 'var(--color-danger)' }}>
            알림 권한이 거부되었거나 등록에 실패했습니다. 브라우저 설정에서 알림 권한을 확인해주세요.
          </p>
        )}

        {push.isSupported && !push.loading && (
          <p>
            상태:{' '}
            <strong style={{ color: push.subscribed ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
              {push.subscribed ? '알림 켜짐' : '알림 꺼짐'}
            </strong>
          </p>
        )}

        {push.isSupported &&
          push.isConfigured &&
          (push.subscribed ? (
            <Button variant="danger" loading={pushBusy} onClick={handlePushUnsubscribe}>
              알림 끄기
            </Button>
          ) : (
            <Button disabled={push.loading} loading={pushBusy} onClick={handlePushSubscribe}>
              알림 받기
            </Button>
          ))}
      </section>
    </div>
  );
}
