import { useSyncExternalStore } from 'react';

// 손가락으로 쓰는 기기(휴대폰·태블릿)인지. 마우스를 쓰는 PC에는 전화 걸기 앱이 없는 경우가 많다.
const TOUCH_QUERY = '(pointer: coarse)';

function subscribe(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(TOUCH_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(TOUCH_QUERY).matches;
}

/**
 * 전화번호 표시. 휴대폰·태블릿에서는 눌러서 바로 전화를 걸 수 있는 링크(숫자와 +만 남겨 tel: 주소를 만든다)로,
 * PC에서는 그냥 글자로 보여준다. PC에서 tel: 링크를 누르면 브라우저가 "앱 선택을 열려고 합니다"
 * 같은 확인 창을 띄우고, 전화 앱이 없으면 아무 일도 일어나지 않기 때문이다.
 */
export default function PhoneLink({ phone }) {
  const canDial = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (!phone) return null;
  if (!canDial) return <span>{phone}</span>;
  const dialable = phone.replace(/[^\d+]/g, '');
  return (
    // 글줄 안에 들어가는 링크라 줄 높이는 그대로 두고, 안쪽 여백과 같은 크기의 음수 바깥 여백으로 누르는 영역만 44px 가까이 넓힌다.
    <a
      href={`tel:${dialable}`}
      aria-label={`${phone}로 전화 걸기`}
      style={{ display: 'inline-block', padding: '11px 4px', margin: '-11px -4px' }}
    >
      {phone}
    </a>
  );
}
