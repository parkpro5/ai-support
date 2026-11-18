import { httpClient } from './httpClient';

/**
 * 지원자 본인의 근로시간. 월(YYYY-MM)을 생략하면 이번 달이다.
 * @param {{ month?: string }} params
 */
export async function fetchMyHours(params = {}) {
  const { data } = await httpClient.get('/stats/my-hours', { params });
  return data;
}

/**
 * 관리자용: 지원자별 월 근로시간 현황. 월(YYYY-MM)을 생략하면 이번 달이다.
 * @param {{ month?: string }} params
 */
export async function fetchHoursByMonth(params = {}) {
  const { data } = await httpClient.get('/stats/hours', { params });
  return data;
}

/**
 * 관리자 대시보드 요약(기간별 완료 건수·평균 처리 시간·유형별 건수·현재 상태별 건수).
 * @param {{ months?: number }} params 이번 달부터 거슬러 올라간 개월 수(1~24, 생략하면 6)
 */
export async function fetchDashboardSummary(params = {}) {
  const { data } = await httpClient.get('/stats/summary', { params });
  return data;
}

/** 관리자 대시보드: 지원자별 완료 건수·평균 처리 시간·근로시간·평균 만족도. */
export async function fetchDashboardSupporters(params = {}) {
  const { data } = await httpClient.get('/stats/supporters', { params });
  return data;
}
