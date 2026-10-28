import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';

/**
 * 초 럭셔리 미니멀리즘 색채·표면 공학 (Cool Obsidian Surface + Pure Jewel Inlay)
 * - 쿨 다크 캔버스(#0c0e14 ~ #12141a) 위에서 탁한 카키/진흙색 오염을 유발하는 유색 배경·테두리를 전면 배제
 * - 모든 일정 카드는 캔버스와 색온도를 일치시킨 무채색 쿨 옵시디언 글래스 표면 + 상단 1px 스펙큘러 광택으로 통일
 * - 프로젝트·카테고리 고유 색상은 좌측 내경에 세공된 2px 수직 주얼 인레이(inlayClass)와 마이크로 포인트에만 응축
 */
export interface EventLuxuryTheme {
  /** 카드 좌측 내경에 세공되는 2px 수직 주얼 인레이 바 클래스 */
  inlayClass: string;
  /** 요약 툴팁·헤더용 정제된 주얼 도트 클래스 */
  dotClass: string;
  /** 월간 칩 및 종일 스트립용 에디토리얼 고스트 옵시디언 서피스 클래스 */
  chipSurfaceClass: string;
  /** 주간 · 일간 시간 블록용 쿨 옵시디언 글래스 서피스 클래스 */
  blockSurfaceClass: string;
  /** 클릭·선택(Selected) 시 활성화되는 정밀 포커스 헤어라인 & 스펙큘러 서피스 */
  selectedSurfaceClass: string;
  /** 다중 프로젝트 비교 등 제한적 상황에서만 노출되는 포인트 텍스트 클래스 */
  accentTextClass: string;
  /** 연결된 프로젝트 객체 (존재 시) */
  project?: ProjectItem;
}

const COOL_OBSIDIAN_CHIP_SURFACE =
  'bg-white/[0.026] hover:bg-[#191d28]/95 border-white/[0.04] hover:border-white/[0.10] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:shadow-[0_6px_16px_-6px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.07)]';

const COOL_OBSIDIAN_BLOCK_SURFACE =
  'bg-gradient-to-b from-[#171b24]/96 to-[#12151d]/98 hover:from-[#1c202c]/98 hover:to-[#151923]/99 border-white/[0.075] hover:border-white/[0.14] shadow-[0_2px_10px_-3px_rgba(0,0,0,0.48),inset_0_1px_0_0_rgba(255,255,255,0.065)] hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.095)]';

const COOL_OBSIDIAN_SELECTED_SURFACE =
  '!from-[#1f2432]/99 !to-[#171b26]/99 !bg-[#1b202c]/98 !border-white/[0.22] shadow-[0_14px_30px_-10px_rgba(0,0,0,0.76),inset_0_1px_0_0_rgba(255,255,255,0.12)]';

function createLuxuryPalette(
  inlayClass: string,
  dotClass: string,
  accentTextClass: string
): Omit<EventLuxuryTheme, 'project'> {
  return {
    inlayClass,
    dotClass,
    chipSurfaceClass: COOL_OBSIDIAN_CHIP_SURFACE,
    blockSurfaceClass: COOL_OBSIDIAN_BLOCK_SURFACE,
    selectedSurfaceClass: COOL_OBSIDIAN_SELECTED_SURFACE,
    accentTextClass,
  };
}

function getThemeByProjectHex(hex?: string): Omit<EventLuxuryTheme, 'project'> | null {
  switch (hex?.toLowerCase()) {
    case '#d4af37': // 새틴 샴페인 골드 (고휘도·저탁도 세공 골드)
      return createLuxuryPalette(
        'bg-[#e6c875] shadow-[0_0_8px_rgba(230,200,117,0.22)]',
        'bg-[#e6c875]',
        'text-[#ebd494]'
      );
    case '#6366f1': // 임페리얼 인디고
      return createLuxuryPalette(
        'bg-[#8b96f8] shadow-[0_0_8px_rgba(139,150,248,0.22)]',
        'bg-[#8b96f8]',
        'text-[#b4bdfc]'
      );
    case '#10b981': // 세이지 에메랄드
      return createLuxuryPalette(
        'bg-[#56d4a8] shadow-[0_0_8px_rgba(86,212,168,0.20)]',
        'bg-[#56d4a8]',
        'text-[#8ce3c3]'
      );
    case '#3b82f6': // 미드나잇 사파이어
      return createLuxuryPalette(
        'bg-[#73b0fa] shadow-[0_0_8px_rgba(115,176,250,0.20)]',
        'bg-[#73b0fa]',
        'text-[#a3cbfc]'
      );
    case '#f43f5e': // 로즈 브론즈
      return createLuxuryPalette(
        'bg-[#f28799] shadow-[0_0_8px_rgba(242,135,153,0.20)]',
        'bg-[#f28799]',
        'text-[#f8b0bc]'
      );
    case '#a855f7': // 리걸 아메시스트
      return createLuxuryPalette(
        'bg-[#c596f8] shadow-[0_0_8px_rgba(197,150,248,0.20)]',
        'bg-[#c596f8]',
        'text-[#dcc0fc]'
      );
    case '#d97706': // 에스프레소 앰버
      return createLuxuryPalette(
        'bg-[#e3ab5b] shadow-[0_0_8px_rgba(227,171,91,0.20)]',
        'bg-[#e3ab5b]',
        'text-[#eec68c]'
      );
    case '#94a3b8': // 플래티넘 슬레이트
      return createLuxuryPalette(
        'bg-[#cbd5e1]',
        'bg-[#cbd5e1]',
        'text-neutral-300'
      );
    default:
      return null;
  }
}

const CATEGORY_FALLBACK_THEMES: Record<CalendarCategory, Omit<EventLuxuryTheme, 'project'>> = {
  '업무': createLuxuryPalette(
    'bg-[#7fa6f8] shadow-[0_0_8px_rgba(127,166,248,0.18)]',
    'bg-[#7fa6f8]',
    'text-[#adc6fb]'
  ),
  '방문·출장': createLuxuryPalette(
    'bg-[#58d1a8] shadow-[0_0_8px_rgba(88,209,168,0.18)]',
    'bg-[#58d1a8]',
    'text-[#8be0c3]'
  ),
  '식사·모임': createLuxuryPalette(
    'bg-[#dfb573] shadow-[0_0_8px_rgba(223,181,115,0.18)]',
    'bg-[#dfb573]',
    'text-[#ebd0a3]'
  ),
  '개인': createLuxuryPalette(
    'bg-[#b89cf6] shadow-[0_0_8px_rgba(184,156,246,0.18)]',
    'bg-[#b89cf6]',
    'text-[#d2c0fa]'
  ),
  '행사·세미나': createLuxuryPalette(
    'bg-[#e68fa0] shadow-[0_0_8px_rgba(230,143,160,0.18)]',
    'bg-[#e68fa0]',
    'text-[#f2b5c1]'
  ),
  '기타': createLuxuryPalette(
    'bg-[#94a3b8]',
    'bg-[#94a3b8]',
    'text-neutral-300'
  ),
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
