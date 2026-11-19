/** 전화번호를 눌러서 바로 전화를 걸 수 있는 링크. 숫자와 +만 남겨 tel: 주소를 만든다. */
export default function PhoneLink({ phone }) {
  if (!phone) return null;
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
