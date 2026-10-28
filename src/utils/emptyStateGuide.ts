import { CalendarCategory } from '../types';

export interface EmptyGuideContext {
  scope: 'month' | 'week' | 'day';
  selectedProjectId: string | 'all';
  comparedProjectCount: number;
  selectedCategory: CalendarCategory | '전체';
  totalFilteredCount: number;
}

/**
 * 데이터가 없는 프로젝트 또는 날짜·주간·월간 선택 시 화면 중앙에 표시할 미니멀 가이드 문구 생성
 */
export function getEmptyCalendarGuideText(ctx: EmptyGuideContext): string {
  const {
    scope,
    selectedProjectId,
    comparedProjectCount,
    selectedCategory,
    totalFilteredCount,
  } = ctx;

  const isSingleProject = comparedProjectCount < 2 && selectedProjectId !== 'all';
  const isCompareMode = comparedProjectCount >= 2;
  const isCategoryFiltered = selectedCategory !== '전체';

  if (isSingleProject) {
    if (totalFilteredCount === 0) {
      return '현재 선택한 프로젝트의 일정이 없습니다';
    }
    if (scope === 'month') {
      return '현재 선택한 프로젝트는 이 달에 일정이 없습니다';
    }
    if (scope === 'week') {
      return '현재 선택한 프로젝트는 선택한 주간에 일정이 없습니다';
    }
    return '현재 선택한 프로젝트는 선택한 날짜에 일정이 없습니다';
  }

  if (isCompareMode) {
    if (totalFilteredCount === 0) {
      return '현재 선택한 비교 프로젝트의 일정이 없습니다';
    }
    if (scope === 'month') {
      return '선택한 달에는 비교 대상 프로젝트의 일정이 없습니다';
    }
    if (scope === 'week') {
      return '선택한 주간에는 비교 대상 프로젝트의 일정이 없습니다';
    }
    return '선택한 날짜에는 비교 대상 프로젝트의 일정이 없습니다';
  }

  if (isCategoryFiltered) {
    if (scope === 'day') {
      return `선택한 날짜에 '${selectedCategory}' 일정이 없습니다`;
    }
    if (scope === 'week') {
      return `선택한 주간에 '${selectedCategory}' 일정이 없습니다`;
    }
    return `현재 선택한 분류('${selectedCategory}')의 일정이 없습니다`;
  }

  if (scope === 'day') {
    return '현재 선택한 날짜의 일정이 없습니다';
  }
  if (scope === 'week') {
    return '현재 선택한 주간의 일정이 없습니다';
  }
  return '현재 선택한 달의 일정이 없습니다';
}
