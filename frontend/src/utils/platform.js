/**
 * iPhone·iPad의 브라우저(Safari)에서는 웹 푸시가 "홈 화면에 추가한 앱"에서만 동작한다.
 * 그래서 iOS이면서 아직 홈 화면 앱으로 열지 않았다면 설치 안내를 보여줘야 한다.
 *
 * @param {{ userAgent: string, platform: string, maxTouchPoints: number, standalone: boolean }} env
 * @returns {boolean} 홈 화면에 추가해야 알림을 켤 수 있는 환경이면 true
 */
export function needsHomeScreenInstall({ userAgent, platform, maxTouchPoints, standalone }) {
  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS의 "데스크톱 사이트 요청" 모드는 Mac처럼 보이지만 터치가 된다.
    (platform === 'MacIntel' && maxTouchPoints > 1);
  return isIos && !standalone;
}

/** 지금 이 브라우저의 환경으로 needsHomeScreenInstall을 계산한다. */
export function currentNeedsHomeScreenInstall() {
  const standalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  return needsHomeScreenInstall({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
  });
}
