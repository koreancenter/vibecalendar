import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';

/**
 * 초 럭셔리 미니멀리즘 단일 색조 위계 (Project-First Chromatic Authority)
 * - 원색 네온 배경을 완전히 배제하고 #13161f 다크 스모크드 옵시디언 베이스에 6~9% 미세 색조 언더톤과 1px 헤어라인만 부여
 * - 프로젝트가 지정된 일정은 소속 프로젝트의 럭셔리 팔레트로 도트·표면·선택 테두리를 단일화하여 색조 충돌 원천 차단
 * - 프로젝트 미지정 일정만 절제된 카테고리 저채도 톤으로 폴백
 */
export interface EventLuxuryTheme {
  /** 좌측 상단 단일 5px 주얼 도트 클래스 */
  dotClass: string;
  /** 월간 칩 및 종일 스트립용 스모크드 서피스 클래스 */
  chipSurfaceClass: string;
  /** 주간 · 일간 시간 블록용 스모크드 옵시디언 서피스 클래스 */
  blockSurfaceClass: string;
  /** 선택(Active) 시 두꺼운 백색 링 대신 적용되는 1px 스펙큘러 헤어라인 & 심도 그림자 */
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
          'bg-[#181611]/92 hover:bg-[#201d15] border-[#d4af37]/24 hover:border-[#d4af37]/42',
        blockSurfaceClass:
          'bg-[#171510]/95 hover:bg-[#1e1b14]/97 border-[#d4af37]/25 hover:border-[#d4af37]/42 shadow-[inset_0_1px_0_0_rgba(241,215,121,0.06)]',
        selectedSurfaceClass:
          '!border-[#f1d779]/65 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(241,215,121,0.22)]',
        accentTextClass: 'text-[#e5cc78]',
      };
    case '#6366f1': // 임페리얼 인디고
      return {
        dotClass: 'bg-[#818cf8]',
        chipSurfaceClass:
          'bg-[#141624]/92 hover:bg-[#1a1d2f] border-[#818cf8]/24 hover:border-[#818cf8]/42',
        blockSurfaceClass:
          'bg-[#131522]/95 hover:bg-[#191c2d]/97 border-[#818cf8]/25 hover:border-[#818cf8]/42 shadow-[inset_0_1px_0_0_rgba(165,180,252,0.06)]',
        selectedSurfaceClass:
          '!border-[#a5b4fc]/65 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(165,180,252,0.22)]',
        accentTextClass: 'text-[#a5b4fc]',
      };
    case '#10b981': // 세이지 에메랄드
      return {
        dotClass: 'bg-[#34d399]',
        chipSurfaceClass:
          'bg-[#111917]/92 hover:bg-[#16211e] border-[#34d399]/24 hover:border-[#34d399]/42',
        blockSurfaceClass:
          'bg-[#111816]/95 hover:bg-[#15201d]/97 border-[#34d399]/25 hover:border-[#34d399]/42 shadow-[inset_0_1px_0_0_rgba(110,231,183,0.06)]',
        selectedSurfaceClass:
          '!border-[#6ee7b7]/60 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(110,231,183,0.2)]',
        accentTextClass: 'text-[#6ee7b7]',
      };
    case '#3b82f6': // 미드나잇 사파이어
      return {
        dotClass: 'bg-[#60a5fa]',
        chipSurfaceClass:
          'bg-[#121824]/92 hover:bg-[#171f2e] border-[#60a5fa]/24 hover:border-[#60a5fa]/42',
        blockSurfaceClass:
          'bg-[#111722]/95 hover:bg-[#161e2c]/97 border-[#60a5fa]/25 hover:border-[#60a5fa]/42 shadow-[inset_0_1px_0_0_rgba(147,197,253,0.06)]',
        selectedSurfaceClass:
          '!border-[#93c5fd]/60 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(147,197,253,0.2)]',
        accentTextClass: 'text-[#93c5fd]',
      };
    case '#f43f5e': // 로즈 브론즈
      return {
        dotClass: 'bg-[#fb7185]',
        chipSurfaceClass:
          'bg-[#1b1317]/92 hover:bg-[#23181e] border-[#fb7185]/24 hover:border-[#fb7185]/42',
        blockSurfaceClass:
          'bg-[#191216]/95 hover:bg-[#21171c]/97 border-[#fb7185]/25 hover:border-[#fb7185]/42 shadow-[inset_0_1px_0_0_rgba(253,164,175,0.06)]',
        selectedSurfaceClass:
          '!border-[#fda4af]/60 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(253,164,175,0.2)]',
        accentTextClass: 'text-[#fda4af]',
      };
    case '#a855f7': // 리걸 아메시스트
      return {
        dotClass: 'bg-[#c084fc]',
        chipSurfaceClass:
          'bg-[#181322]/92 hover:bg-[#20192d] border-[#c084fc]/24 hover:border-[#c084fc]/42',
        blockSurfaceClass:
          'bg-[#161220]/95 hover:bg-[#1e182b]/97 border-[#c084fc]/25 hover:border-[#c084fc]/42 shadow-[inset_0_1px_0_0_rgba(216,180,254,0.06)]',
        selectedSurfaceClass:
          '!border-[#d8b4fe]/60 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(216,180,254,0.2)]',
        accentTextClass: 'text-[#d8b4fe]',
      };
    case '#d97706': // 에스프레소 앰버
      return {
        dotClass: 'bg-[#e09f3e]',
        chipSurfaceClass:
          'bg-[#191511]/92 hover:bg-[#221c16] border-[#e09f3e]/24 hover:border-[#e09f3e]/42',
        blockSurfaceClass:
          'bg-[#181410]/95 hover:bg-[#201b14]/97 border-[#e09f3e]/25 hover:border-[#e09f3e]/42 shadow-[inset_0_1px_0_0_rgba(252,211,77,0.06)]',
        selectedSurfaceClass:
          '!border-[#fcd34d]/60 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(252,211,77,0.2)]',
        accentTextClass: 'text-[#ebd089]',
      };
    case '#94a3b8': // 플래티넘 슬레이트
      return {
        dotClass: 'bg-[#cbd5e1]',
        chipSurfaceClass:
          'bg-[#14171f]/92 hover:bg-[#1a1e28] border-white/[0.12] hover:border-white/[0.24]',
        blockSurfaceClass:
          'bg-[#14171f]/95 hover:bg-[#1a1e28]/97 border-white/[0.13] hover:border-white/[0.24] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]',
        selectedSurfaceClass:
          '!border-white/55 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(255,255,255,0.2)]',
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
      'bg-[#131722]/92 hover:bg-[#181d2b] border-[#7aa2f7]/20 hover:border-[#7aa2f7]/36',
    blockSurfaceClass:
      'bg-[#131721]/95 hover:bg-[#181d2a]/97 border-[#7aa2f7]/22 hover:border-[#7aa2f7]/38 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
    selectedSurfaceClass:
      '!border-[#93c5fd]/55 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(147,197,253,0.18)]',
    accentTextClass: 'text-[#9dbbf8]',
  },
  '방문·출장': {
    dotClass: 'bg-[#4fd1a5]',
    chipSurfaceClass:
      'bg-[#121917]/92 hover:bg-[#16201d] border-[#4fd1a5]/20 hover:border-[#4fd1a5]/36',
    blockSurfaceClass:
      'bg-[#111816]/95 hover:bg-[#161f1c]/97 border-[#4fd1a5]/22 hover:border-[#4fd1a5]/38 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
    selectedSurfaceClass:
      '!border-[#6ee7b7]/55 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(110,231,183,0.18)]',
    accentTextClass: 'text-[#7ce0be]',
  },
  '식사·모임': {
    dotClass: 'bg-[#d4a359]',
    chipSurfaceClass:
      'bg-[#181511]/92 hover:bg-[#201c16] border-[#d4a359]/22 hover:border-[#d4a359]/38',
    blockSurfaceClass:
      'bg-[#171410]/95 hover:bg-[#1f1b15]/97 border-[#d4a359]/24 hover:border-[#d4a359]/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
    selectedSurfaceClass:
      '!border-[#ebd089]/55 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(235,208,137,0.18)]',
    accentTextClass: 'text-[#e2be82]',
  },
  '개인': {
    dotClass: 'bg-[#b497f5]',
    chipSurfaceClass:
      'bg-[#161420]/92 hover:bg-[#1d1a2a] border-[#b497f5]/20 hover:border-[#b497f5]/36',
    blockSurfaceClass:
      'bg-[#15131f]/95 hover:bg-[#1c1929]/97 border-[#b497f5]/22 hover:border-[#b497f5]/38 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
    selectedSurfaceClass:
      '!border-[#d8b4fe]/55 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(216,180,254,0.18)]',
    accentTextClass: 'text-[#cbb5fa]',
  },
  '행사·세미나': {
    dotClass: 'bg-[#e58598]',
    chipSurfaceClass:
      'bg-[#1a1317]/92 hover:bg-[#22191e] border-[#e58598]/20 hover:border-[#e58598]/36',
    blockSurfaceClass:
      'bg-[#181216]/95 hover:bg-[#20171c]/97 border-[#e58598]/22 hover:border-[#e58598]/38 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
    selectedSurfaceClass:
      '!border-[#fda4af]/55 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(253,164,175,0.18)]',
    accentTextClass: 'text-[#f0a8b6]',
  },
  '기타': {
    dotClass: 'bg-[#94a3b8]',
    chipSurfaceClass:
      'bg-[#14171f]/92 hover:bg-[#191d27] border-white/[0.10] hover:border-white/[0.20]',
    blockSurfaceClass:
      'bg-[#14171e]/95 hover:bg-[#191d26]/97 border-white/[0.11] hover:border-white/[0.22] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
    selectedSurfaceClass:
      '!border-white/50 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.82),inset_0_1px_0_0_rgba(255,255,255,0.18)]',
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
