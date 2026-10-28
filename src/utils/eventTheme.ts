import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';

/**
 * 초 럭셔리 미니멀리즘 단일 색조 위계 (Project-First Chromatic Authority)
 * - 원색 네온 배경을 완전히 배제하고 다크 스모크드 옵시디언 베이스에 미세 색조 언더톤과 1px 헤어라인만 부여
 * - 호버(Hover) 시 과장된 색 변화 대신 약 2%의 표면 휘도 상승과 미세한 상단 스펙큘러 광택으로 절제된 깊이감 연출
 * - 클릭/선택(Active & Selected) 시 보더 투명도를 미세하게 밝혀 시각적 피로감 없이 우아한 포커스 표현
 */
export interface EventLuxuryTheme {
  /** 좌측 상단 단일 5px 주얼 도트 클래스 */
  dotClass: string;
  /** 월간 칩 및 종일 스트립용 스모크드 서피스 클래스 */
  chipSurfaceClass: string;
  /** 주간 · 일간 시간 블록용 스모크드 옵시디언 서피스 클래스 */
  blockSurfaceClass: string;
  /** 클릭·선택(Selected) 시 미세하게 밝아지는 1px 헤어라인 보더 & 내부 스펙큘러 광택 */
  selectedSurfaceClass: string;
  /** 에디토리얼 보조 코드/포인트 텍스트 클래스 */
  accentTextClass: string;
  /** 연결된 프로젝트 객체 (존재 시) */
  project?: ProjectItem;
}

function getThemeByProjectHex(hex?: string): Omit<EventLuxuryTheme, 'project'> | null {
  switch (hex?.toLowerCase()) {
    case '#d4af37': // 샴페인 골드
      return {
        dotClass: 'bg-[#d4af37]',
        chipSurfaceClass:
          'bg-[#171510]/90 hover:bg-[#1c1913]/96 border-[#d4af37]/16 hover:border-[#d4af37]/26 active:border-[#f1d779]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(241,215,121,0.065)]',
        blockSurfaceClass:
          'bg-[#161410]/94 hover:bg-[#1b1813]/97 border-[#d4af37]/17 hover:border-[#d4af37]/27 active:border-[#f1d779]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(241,215,121,0.08)]',
        selectedSurfaceClass:
          '!bg-[#1d1a14]/98 !border-[#f1d779]/38 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(241,215,121,0.13)]',
        accentTextClass: 'text-[#e5cc78]',
      };
    case '#6366f1': // 임페리얼 인디고
      return {
        dotClass: 'bg-[#818cf8]',
        chipSurfaceClass:
          'bg-[#131522]/90 hover:bg-[#171a29]/96 border-[#818cf8]/16 hover:border-[#818cf8]/26 active:border-[#a5b4fc]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(165,180,252,0.065)]',
        blockSurfaceClass:
          'bg-[#131521]/94 hover:bg-[#171928]/97 border-[#818cf8]/17 hover:border-[#818cf8]/27 active:border-[#a5b4fc]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(165,180,252,0.08)]',
        selectedSurfaceClass:
          '!bg-[#191c2c]/98 !border-[#a5b4fc]/38 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(165,180,252,0.13)]',
        accentTextClass: 'text-[#a5b4fc]',
      };
    case '#10b981': // 세이지 에메랄드
      return {
        dotClass: 'bg-[#34d399]',
        chipSurfaceClass:
          'bg-[#111816]/90 hover:bg-[#141d1b]/96 border-[#34d399]/16 hover:border-[#34d399]/26 active:border-[#6ee7b7]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(110,231,183,0.065)]',
        blockSurfaceClass:
          'bg-[#101715]/94 hover:bg-[#141c1a]/97 border-[#34d399]/17 hover:border-[#34d399]/27 active:border-[#6ee7b7]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(110,231,183,0.08)]',
        selectedSurfaceClass:
          '!bg-[#16201d]/98 !border-[#6ee7b7]/36 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(110,231,183,0.12)]',
        accentTextClass: 'text-[#6ee7b7]',
      };
    case '#3b82f6': // 미드나잇 사파이어
      return {
        dotClass: 'bg-[#60a5fa]',
        chipSurfaceClass:
          'bg-[#111722]/90 hover:bg-[#151c29]/96 border-[#60a5fa]/16 hover:border-[#60a5fa]/26 active:border-[#93c5fd]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(147,197,253,0.065)]',
        blockSurfaceClass:
          'bg-[#111621]/94 hover:bg-[#151b28]/97 border-[#60a5fa]/17 hover:border-[#60a5fa]/27 active:border-[#93c5fd]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(147,197,253,0.08)]',
        selectedSurfaceClass:
          '!bg-[#171e2c]/98 !border-[#93c5fd]/36 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(147,197,253,0.12)]',
        accentTextClass: 'text-[#93c5fd]',
      };
    case '#f43f5e': // 로즈 브론즈
      return {
        dotClass: 'bg-[#fb7185]',
        chipSurfaceClass:
          'bg-[#191216]/90 hover:bg-[#1f161b]/96 border-[#fb7185]/16 hover:border-[#fb7185]/26 active:border-[#fda4af]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(253,164,175,0.065)]',
        blockSurfaceClass:
          'bg-[#181215]/94 hover:bg-[#1e161a]/97 border-[#fb7185]/17 hover:border-[#fb7185]/27 active:border-[#fda4af]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(253,164,175,0.08)]',
        selectedSurfaceClass:
          '!bg-[#21181d]/98 !border-[#fda4af]/36 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(253,164,175,0.12)]',
        accentTextClass: 'text-[#fda4af]',
      };
    case '#a855f7': // 리걸 아메시스트
      return {
        dotClass: 'bg-[#c084fc]',
        chipSurfaceClass:
          'bg-[#171220]/90 hover:bg-[#1c1627]/96 border-[#c084fc]/16 hover:border-[#c084fc]/26 active:border-[#d8b4fe]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(216,180,254,0.065)]',
        blockSurfaceClass:
          'bg-[#16121f]/94 hover:bg-[#1b1626]/97 border-[#c084fc]/17 hover:border-[#c084fc]/27 active:border-[#d8b4fe]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(216,180,254,0.08)]',
        selectedSurfaceClass:
          '!bg-[#1e182a]/98 !border-[#d8b4fe]/36 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(216,180,254,0.12)]',
        accentTextClass: 'text-[#d8b4fe]',
      };
    case '#d97706': // 에스프레소 앰버
      return {
        dotClass: 'bg-[#e09f3e]',
        chipSurfaceClass:
          'bg-[#181410]/90 hover:bg-[#1d1813]/96 border-[#e09f3e]/16 hover:border-[#e09f3e]/26 active:border-[#fcd34d]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(252,211,77,0.065)]',
        blockSurfaceClass:
          'bg-[#171310]/94 hover:bg-[#1c1713]/97 border-[#e09f3e]/17 hover:border-[#e09f3e]/27 active:border-[#fcd34d]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(252,211,77,0.08)]',
        selectedSurfaceClass:
          '!bg-[#201a14]/98 !border-[#fcd34d]/36 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(252,211,77,0.12)]',
        accentTextClass: 'text-[#ebd089]',
      };
    case '#94a3b8': // 플래티넘 슬레이트
      return {
        dotClass: 'bg-[#cbd5e1]',
        chipSurfaceClass:
          'bg-[#14171f]/90 hover:bg-[#181c25]/96 border-white/[0.09] hover:border-white/[0.17] active:border-white/[0.26] hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.065)]',
        blockSurfaceClass:
          'bg-[#13161e]/94 hover:bg-[#171b24]/97 border-white/[0.10] hover:border-white/[0.18] active:border-white/[0.27] shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.035)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.075)]',
        selectedSurfaceClass:
          '!bg-[#1a1e28]/98 !border-white/[0.32] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(255,255,255,0.11)]',
        accentTextClass: 'text-neutral-300',
      };
    default:
      return null;
  }
}

const CATEGORY_FALLBACK_THEMES: Record<CalendarCategory, Omit<EventLuxuryTheme, 'project'>> = {
  '업무': {
    dotClass: 'bg-[#7aa2f7]',
    chipSurfaceClass:
      'bg-[#131620]/90 hover:bg-[#161a26]/96 border-[#7aa2f7]/15 hover:border-[#7aa2f7]/25 active:border-[#93c5fd]/33 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    blockSurfaceClass:
      'bg-[#12161f]/94 hover:bg-[#161a25]/97 border-[#7aa2f7]/16 hover:border-[#7aa2f7]/26 active:border-[#93c5fd]/34 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    selectedSurfaceClass:
      '!bg-[#181d29]/98 !border-[#93c5fd]/35 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(147,197,253,0.11)]',
    accentTextClass: 'text-[#9dbbf8]',
  },
  '방문·출장': {
    dotClass: 'bg-[#4fd1a5]',
    chipSurfaceClass:
      'bg-[#111816]/90 hover:bg-[#151d1a]/96 border-[#4fd1a5]/15 hover:border-[#4fd1a5]/25 active:border-[#6ee7b7]/33 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    blockSurfaceClass:
      'bg-[#111715]/94 hover:bg-[#141c19]/97 border-[#4fd1a5]/16 hover:border-[#4fd1a5]/26 active:border-[#6ee7b7]/34 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    selectedSurfaceClass:
      '!bg-[#161f1c]/98 !border-[#6ee7b7]/35 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(110,231,183,0.11)]',
    accentTextClass: 'text-[#7ce0be]',
  },
  '식사·모임': {
    dotClass: 'bg-[#d4a359]',
    chipSurfaceClass:
      'bg-[#171410]/90 hover:bg-[#1c1813]/96 border-[#d4a359]/16 hover:border-[#d4a359]/26 active:border-[#ebd089]/34 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    blockSurfaceClass:
      'bg-[#161310]/94 hover:bg-[#1b1713]/97 border-[#d4a359]/17 hover:border-[#d4a359]/27 active:border-[#ebd089]/35 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    selectedSurfaceClass:
      '!bg-[#1e1a14]/98 !border-[#ebd089]/36 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(235,208,137,0.11)]',
    accentTextClass: 'text-[#e2be82]',
  },
  '개인': {
    dotClass: 'bg-[#b497f5]',
    chipSurfaceClass:
      'bg-[#15131f]/90 hover:bg-[#191725]/96 border-[#b497f5]/15 hover:border-[#b497f5]/25 active:border-[#d8b4fe]/33 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    blockSurfaceClass:
      'bg-[#14121e]/94 hover:bg-[#191624]/97 border-[#b497f5]/16 hover:border-[#b497f5]/26 active:border-[#d8b4fe]/34 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    selectedSurfaceClass:
      '!bg-[#1c1928]/98 !border-[#d8b4fe]/35 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(216,180,254,0.11)]',
    accentTextClass: 'text-[#cbb5fa]',
  },
  '행사·세미나': {
    dotClass: 'bg-[#e58598]',
    chipSurfaceClass:
      'bg-[#181216]/90 hover:bg-[#1e161b]/96 border-[#e58598]/15 hover:border-[#e58598]/25 active:border-[#fda4af]/33 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    blockSurfaceClass:
      'bg-[#171215]/94 hover:bg-[#1d161a]/97 border-[#e58598]/16 hover:border-[#e58598]/26 active:border-[#fda4af]/34 shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    selectedSurfaceClass:
      '!bg-[#20181c]/98 !border-[#fda4af]/35 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(253,164,175,0.11)]',
    accentTextClass: 'text-[#f0a8b6]',
  },
  '기타': {
    dotClass: 'bg-[#94a3b8]',
    chipSurfaceClass:
      'bg-[#14171f]/90 hover:bg-[#181b24]/96 border-white/[0.08] hover:border-white/[0.16] active:border-white/[0.24] hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.46),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    blockSurfaceClass:
      'bg-[#13161d]/94 hover:bg-[#171b23]/97 border-white/[0.09] hover:border-white/[0.17] active:border-white/[0.25] shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    selectedSurfaceClass:
      '!bg-[#191d26]/98 !border-white/[0.30] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72),inset_0_1px_0_0_rgba(255,255,255,0.10)]',
    accentTextClass: 'text-neutral-300',
  },
};

export function resolveEventLuxuryTheme(
  event: Pick<CalendarEventItem, 'projectId' | 'category'>,
  projects: ProjectItem[] = []
): EventLuxuryTheme {
  const project = event.projectId
    ? projects.find((p) => p.id === event.projectId)
    : undefined;

  if (project) {
    const projTheme = getThemeByProjectHex(project.color);
    if (projTheme) {
      return {
        ...projTheme,
        project,
      };
    }
    return {
      ...CATEGORY_FALLBACK_THEMES['기타'],
      project,
    };
  }

  const fallback =
    CATEGORY_FALLBACK_THEMES[event.category] || CATEGORY_FALLBACK_THEMES['기타'];
  return { ...fallback };
}
