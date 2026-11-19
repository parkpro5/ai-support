import { formatDateTime } from '../../utils/time';

/**
 * 작업 희망 기간: "착수일시 ~ 희망 완료일". 착수일시는 시각까지, 희망 완료일은 날짜만 보여준다.
 * 좁은 화면에서 날짜 한가운데(2026-12-10의 하이픈)에서 줄이 바뀌지 않도록 각 값은 한 덩어리로 둔다.
 * 착수일시가 없으면(오래된 데이터 등) 희망 완료일만 보여준다.
 */
export default function WorkPeriod({ interviewAt, desiredDate }) {
  const start = interviewAt ? formatDateTime(interviewAt) : '';
  const end = <span style={{ whiteSpace: 'nowrap' }}>{desiredDate}</span>;
  if (!start) return end;
  return (
    <>
      <span style={{ whiteSpace: 'nowrap' }}>{start}</span> ~ {end}
    </>
  );
}
