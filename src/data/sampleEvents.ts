import { CalendarEventItem, ProjectItem } from '../types';
import { addDays, getTodayDateString } from '../shared/dateUtils';

/**
 * 최초 앱 진입 시에는 빈 상태를 유지합니다.
 */
export const INITIAL_CALENDAR_EVENTS: CalendarEventItem[] = [];

/**
 * 구버전 실존 명칭 기반 시드 ID (로컬 스토리지·볼트 마이그레이션 시 자동 제외용)
 */
export const LEGACY_REAL_NAME_EVENT_IDS = new Set([
  'evt-korea-univ',
  'evt-uijeongbu-lunch',
  'evt-team-sync',
]);

export const LEGACY_REAL_NAME_PROJECT_IDS = new Set([
  'proj-korea-collab',
  'proj-vibe-ai',
  'proj-vip-networking',
]);

export const SAMPLE_PROJECT_ID_PREFIX = 'sample-proj-';
export const SAMPLE_EVENT_ID_PREFIX = 'sample-evt-';

export function isSampleProjectItem(proj: ProjectItem): boolean {
  return Boolean(proj.isSample || proj.id.startsWith(SAMPLE_PROJECT_ID_PREFIX));
}

export function isSampleEventItem(ev: CalendarEventItem): boolean {
  return Boolean(ev.isSample || ev.id.startsWith(SAMPLE_EVENT_ID_PREFIX));
}

/**
 * 명칭 사용 허가 및 간접 광고 오해 방지를 위해 100% 가상 기관·상호·도로명으로 설계된 학습용 샘플 데이터 생성기
 * 사용자가 현재 보고 있는 기준 날짜(anchorDate) 주간에 맞춰 일정을 배치하여 즉시 월·주·일 뷰에서 체험할 수 있습니다.
 */
export function createSampleWorkspaceDataset(anchorDateStr?: string): {
  projects: ProjectItem[];
  events: CalendarEventItem[];
  focusDate: string;
} {
  const baseDate =
    anchorDateStr && /^\d{4}-\d{2}-\d{2}$/.test(anchorDateStr)
      ? anchorDateStr
      : getTodayDateString();

  const monthStart = `${baseDate.slice(0, 7)}-01`;
  const nextMonthEnd = addDays(baseDate, 35);
  const nowIso = new Date().toISOString();

  const projects: ProjectItem[] = [
    {
      id: 'sample-proj-lumiere',
      name: '노바 호라이즌 R&D 협약',
      code: 'NOVA-RD',
      description: '차세대 공간 인터페이스 공동 연구 및 기술 자문 프로그램 (학습용 가상 샘플)',
      color: '#d4af37', // 샴페인 골드
      status: 'active',
      startDate: monthStart,
      endDate: nextMonthEnd,
      clientOrOrg: '루미에르 미래기술원',
      createdAt: nowIso,
      isSample: true,
    },
    {
      id: 'sample-proj-salon',
      name: '프라이빗 파트너스 살롱',
      code: 'VIP-SLN',
      description: '전략 파트너사 초청 프라이빗 오찬 및 라운드테이블 (학습용 가상 샘플)',
      color: '#10b981', // 세이지 에메랄드
      status: 'planning',
      startDate: monthStart,
      endDate: nextMonthEnd,
      clientOrOrg: '오르비에 파트너스',
      createdAt: nowIso,
      isSample: true,
    },
    {
      id: 'sample-proj-velvet',
      name: '벨벳 아키텍처 쇼케이스',
      code: 'VLV-Q4',
      description: '연말 키노트 발표 및 디자인 시스템 프리뷰 행사 (학습용 가상 샘플)',
      color: '#6366f1', // 임페리얼 인디고
      status: 'active',
      startDate: monthStart,
      endDate: nextMonthEnd,
      clientOrOrg: '아스트라 스튜디오',
      createdAt: nowIso,
      isSample: true,
    },
  ];

  const dayMinus1 = addDays(baseDate, -1);
  const day0 = baseDate;
  const dayPlus1 = addDays(baseDate, 1);
  const dayPlus2 = addDays(baseDate, 2);

  const events: CalendarEventItem[] = [
    {
      id: 'sample-evt-rd-summit',
      title: '차세대 공간 컴퓨팅 공동 연구 협약식',
      date: day0,
      startTime: '10:00',
      endTime: '12:00',
      timeZone: 'Asia/Seoul',
      isAllDay: false,
      category: '방문·출장',
      projectId: 'sample-proj-lumiere',
      location: '루미에르 사이언스 캠퍼스 아트리움관 3층 302호',
      locationAddress: '서울특별시 성동구 에테르대로 142 (가상 예시 주소)',
      content:
        '공동 연구 범위 확정 및 아트리움 랩 투어 (가상 샘플 일정)\n- 현장 안내: 연구기획팀 한서준 수석\n- 주차 안내: 지하 2층 방문객 전용 구역 사전 등록 완료',
      isCompleted: false,
      checklist: [
        { id: 'sample-chk-1', text: '협약서 초안 및 발표 슬라이드 최종본 점검', done: true },
        { id: 'sample-chk-2', text: '방문 차량 번호 사전 등록 확인', done: false },
      ],
      isSample: true,
    },
    {
      id: 'sample-evt-vip-luncheon',
      title: '20인 파트너스 프라이빗 오찬 모임',
      date: dayPlus1,
      startTime: '12:00',
      endTime: '13:30',
      timeZone: 'Asia/Seoul',
      isAllDay: false,
      category: '식사·모임',
      projectId: 'sample-proj-salon',
      location: '메종 드 솔레이유 별관 2층 프라이빗 다이닝룸 B',
      locationAddress: '서울특별시 용산구 메르디앙길 28 (가상 예시 주소)',
      content:
        '글로벌 협력사 초청 단독 룸 오찬 (가상 샘플 일정)\n- 식단 구성: 비건·알레르기 사전 확인 반영 코스\n- 영접 안내: 11:45 별관 1층 전용 로비 리셉션 데스크',
      isCompleted: false,
      checklist: [
        { id: 'sample-chk-3', text: '20인 단독 다이닝룸 좌석 배치표 확정', done: false },
        { id: 'sample-chk-4', text: '초청 파트너사 식이 제한 사항 최종 전달', done: false },
      ],
      isSample: true,
    },
    {
      id: 'sample-evt-keynote-rehearsal',
      title: '쇼케이스 키노트 리허설 및 무대 동선 점검',
      date: day0,
      startTime: '14:30',
      endTime: '16:30',
      timeZone: 'Asia/Seoul',
      isAllDay: false,
      category: '행사·세미나',
      projectId: 'sample-proj-velvet',
      location: '그랑 오르비에 컨벤션홀 서관 1층 그랜드볼룸',
      locationAddress: '경기도 성남시 분당구 아스트라파크로 210 (가상 예시 주소)',
      content:
        '메인 스크린 해상도 캘리브레이션 및 발표자 음향 리허설 (가상 샘플 일정)',
      isCompleted: false,
      checklist: [
        { id: 'sample-chk-5', text: '메인 LED 월 화면 비율 및 음향 큐시트 테스트', done: true },
        { id: 'sample-chk-6', text: 'VIP 등록 데스크 QR 브리핑 패스 비치', done: false },
        { id: 'sample-chk-7', text: '비상 동선 및 스태프 무전 채널 배정', done: false },
      ],
      isSample: true,
    },
    {
      id: 'sample-evt-global-sync',
      title: '동남아 파트너십 현지 브리핑 콜',
      date: dayPlus2,
      startTime: '14:00',
      endTime: '15:00',
      timeZone: 'Asia/Jakarta',
      isAllDay: false,
      category: '업무',
      projectId: 'sample-proj-salon',
      location: '아스트라 타워 18층 보드룸 A',
      locationAddress: '서울특별시 중구 노바센트럴로 88 (가상 예시 주소)',
      content:
        '자카르타 시간(WIB) 오후 2시 기준 다중 시간대 자동 변환 테스트용 가상 샘플 일정입니다.',
      isCompleted: false,
      isSample: true,
    },
    {
      id: 'sample-evt-design-freeze',
      title: '4분기 마일스톤 아키텍처 리뷰',
      date: dayMinus1,
      startTime: '10:30',
      endTime: '11:30',
      timeZone: 'Asia/Seoul',
      isAllDay: false,
      category: '업무',
      projectId: 'sample-proj-velvet',
      location: '아스트라 스튜디오 본관 7층 전략회의실 1',
      locationAddress: '서울특별시 중구 노바센트럴로 88 (가상 예시 주소)',
      content: '핵심 공정 체크리스트 완료 처리 예시를 보여주는 가상 샘플 일정입니다.',
      isCompleted: true,
      isSample: true,
    },
  ];

  return {
    projects,
    events,
    focusDate: day0,
  };
}
