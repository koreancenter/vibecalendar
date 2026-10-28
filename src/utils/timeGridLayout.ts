import { CalendarEventItem } from '../types';
import { timeToMinutes } from '../shared/scheduleUtils';

export interface PositionedEvent {
  event: CalendarEventItem;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  topPx: number;
  heightPx: number;
  column: number;
  totalColumns: number;
  hasConflict: boolean;
}

/**
 * 특정 날짜의 일정 목록에 대해 시작 시간, 지속 시간 및 겹침(Collision) 컬럼 분할을 정밀 계산
 * (Google Calendar / FullCalendar 스타일 그리디 레인 패킹 알고리즘)
 * 
 * @param events 대상 일정 목록
 * @param startHour 그리드 시작 시간 (기본 7시)
 * @param pxPerHour 1시간당 픽셀 높이 (기본 64px)
 */
export function layoutTimeEvents(
  events: CalendarEventItem[],
  startHour = 7,
  pxPerHour = 64
): PositionedEvent[] {
  // 종일 일정이 아닌 시간제 일정만 필터링
  const timedEvents = events.filter((e) => !e.isAllDay);
  if (timedEvents.length === 0) return [];

  const parsed = timedEvents.map((ev) => {
    let startMin = timeToMinutes(ev.startTime);
    let endMin = timeToMinutes(ev.endTime);

    // 종료 시간이 시작 시간보다 빠르거나 같으면 1시간 추가
    if (endMin <= startMin) {
      endMin = startMin + 60;
    }

    const duration = Math.max(15, endMin - startMin); // 최소 15분 단위 보장

    return {
      event: ev,
      startMin,
      endMin,
      duration,
    };
  });

  // 1. 시작 시간 오름차순, 동일할 경우 긴 일정이 먼저 오도록 정렬
  parsed.sort((a, b) => a.startMin - b.startMin || b.duration - a.duration);

  // 2. 시간대가 겹치는 일정들을 클러스터(Connected Component) 단위로 묶기
  const clusters: (typeof parsed)[] = [];
  let currentCluster: typeof parsed = [];
  let clusterEnd = -1;

  for (const item of parsed) {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterEnd = item.endMin;
    } else {
      if (item.startMin < clusterEnd) {
        // 충돌 발생 -> 동일 클러스터 확장
        currentCluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMin);
      } else {
        // 충돌 없음 -> 이전 클러스터 확정 후 새 클러스터 시작
        clusters.push(currentCluster);
        currentCluster = [item];
        clusterEnd = item.endMin;
      }
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const results: PositionedEvent[] = [];

  // 3. 각 클러스터 내에서 그리디 방식으로 최소 컬럼(Lane) 번호 부여
  for (const cluster of clusters) {
    const hasClusterOverlap = cluster.length > 1;

    // 각 컬럼별 마지막 일정 종료 시각 추적
    const columnEnds: number[] = [];

    const assigned = cluster.map((item) => {
      let placedCol = -1;
      for (let c = 0; c < columnEnds.length; c++) {
        // 이전 일정 종료 시각 이후라면 같은 컬럼 재사용 가능
        if (item.startMin >= columnEnds[c]) {
          placedCol = c;
          columnEnds[c] = item.endMin;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = columnEnds.length;
        columnEnds.push(item.endMin);
      }

      return {
        item,
        column: placedCol,
      };
    });

    const totalColumns = columnEnds.length;

    for (const { item, column } of assigned) {
      const topMinutes = item.startMin - startHour * 60;
      const topPx = (topMinutes * pxPerHour) / 60;
      const heightPx = (item.duration * pxPerHour) / 60;

      // 해당 개별 일정이 클러스터 내 다른 일정과 겹치는지 체크
      const hasSpecificOverlap =
        hasClusterOverlap &&
        cluster.some(
          (other) =>
            other !== item &&
            item.startMin < other.endMin &&
            item.endMin > other.startMin
        );

      results.push({
        event: item.event,
        startMinutes: item.startMin,
        endMinutes: item.endMin,
        durationMinutes: item.duration,
        topPx,
        heightPx: Math.max(22, heightPx), // 최소 22px 보장
        column,
        totalColumns,
        hasConflict: hasSpecificOverlap,
      });
    }
  }

  return results;
}
