import { ProjectItem, ProjectStatus } from '../types';

export interface ProjectColorOption {
  id: string;
  name: string;
  hex: string;
  bgHex: string;
  borderHex: string;
  textHex: string;
}

/**
 * 럭셔리 미니멀리즘 톤앤매너를 위한 정제된 프로젝트 컬러 팔레트
 */
export const LUXURY_PROJECT_COLORS: ProjectColorOption[] = [
  {
    id: 'gold',
    name: '샴페인 골드',
    hex: '#d4af37',
    bgHex: 'rgba(212, 175, 55, 0.12)',
    borderHex: 'rgba(212, 175, 55, 0.35)',
    textHex: '#f1d779',
  },
  {
    id: 'indigo',
    name: '임페리얼 인디고',
    hex: '#6366f1',
    bgHex: 'rgba(99, 102, 241, 0.12)',
    borderHex: 'rgba(99, 102, 241, 0.35)',
    textHex: '#a5b4fc',
  },
  {
    id: 'emerald',
    name: '세이지 에메랄드',
    hex: '#10b981',
    bgHex: 'rgba(16, 185, 129, 0.12)',
    borderHex: 'rgba(16, 185, 129, 0.35)',
    textHex: '#6ee7b7',
  },
  {
    id: 'sapphire',
    name: '미드나잇 사파이어',
    hex: '#3b82f6',
    bgHex: 'rgba(59, 130, 246, 0.12)',
    borderHex: 'rgba(59, 130, 246, 0.35)',
    textHex: '#93c5fd',
  },
  {
    id: 'bronze',
    name: '로즈 브론즈',
    hex: '#f43f5e',
    bgHex: 'rgba(244, 63, 94, 0.12)',
    borderHex: 'rgba(244, 63, 94, 0.35)',
    textHex: '#fda4af',
  },
  {
    id: 'amethyst',
    name: '리걸 아메시스트',
    hex: '#a855f7',
    bgHex: 'rgba(168, 85, 247, 0.12)',
    borderHex: 'rgba(168, 85, 247, 0.35)',
    textHex: '#d8b4fe',
  },
  {
    id: 'amber',
    name: '에스프레소 앰버',
    hex: '#d97706',
    bgHex: 'rgba(217, 119, 6, 0.12)',
    borderHex: 'rgba(217, 119, 6, 0.35)',
    textHex: '#fcd34d',
  },
  {
    id: 'platinum',
    name: '플래티넘 슬레이트',
    hex: '#94a3b8',
    bgHex: 'rgba(148, 163, 184, 0.12)',
    borderHex: 'rgba(148, 163, 184, 0.35)',
    textHex: '#e2e8f0',
  },
];

export interface ProjectThemeClasses {
  dotClass: string;
  textClass: string;
  barClass: string;
  underlineClass: string;
  chipSurfaceClass: string;
  blockSurfaceClass: string;
}

/**
 * 인라인 스타일 없이 순수 Tailwind 클래스로 프로젝트별 럭셔리 컬러 테마를 반환
 */
export function getProjectThemeClasses(hex?: string): ProjectThemeClasses {
  switch (hex?.toLowerCase()) {
    case '#d4af37':
      return {
        dotClass: 'bg-[#d4af37]',
        textClass: 'text-[#e5cc78]',
        barClass: 'bg-[#d4af37]',
        underlineClass: 'after:bg-[#d4af37]',
        chipSurfaceClass: 'bg-[#181611]/92 border-[#d4af37]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#171510]/95 border-[#d4af37]/25 text-neutral-100 hover:bg-[#1e1b14]',
      };
    case '#6366f1':
      return {
        dotClass: 'bg-[#818cf8]',
        textClass: 'text-[#a5b4fc]',
        barClass: 'bg-[#818cf8]',
        underlineClass: 'after:bg-[#818cf8]',
        chipSurfaceClass: 'bg-[#141624]/92 border-[#818cf8]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#131522]/95 border-[#818cf8]/25 text-neutral-100 hover:bg-[#191c2d]',
      };
    case '#10b981':
      return {
        dotClass: 'bg-[#34d399]',
        textClass: 'text-[#6ee7b7]',
        barClass: 'bg-[#34d399]',
        underlineClass: 'after:bg-[#34d399]',
        chipSurfaceClass: 'bg-[#111917]/92 border-[#34d399]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#111816]/95 border-[#34d399]/25 text-neutral-100 hover:bg-[#15201d]',
      };
    case '#3b82f6':
      return {
        dotClass: 'bg-[#60a5fa]',
        textClass: 'text-[#93c5fd]',
        barClass: 'bg-[#60a5fa]',
        underlineClass: 'after:bg-[#60a5fa]',
        chipSurfaceClass: 'bg-[#121824]/92 border-[#60a5fa]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#111722]/95 border-[#60a5fa]/25 text-neutral-100 hover:bg-[#161e2c]',
      };
    case '#f43f5e':
      return {
        dotClass: 'bg-[#fb7185]',
        textClass: 'text-[#fda4af]',
        barClass: 'bg-[#fb7185]',
        underlineClass: 'after:bg-[#fb7185]',
        chipSurfaceClass: 'bg-[#1b1317]/92 border-[#fb7185]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#191216]/95 border-[#fb7185]/25 text-neutral-100 hover:bg-[#21171c]',
      };
    case '#a855f7':
      return {
        dotClass: 'bg-[#c084fc]',
        textClass: 'text-[#d8b4fe]',
        barClass: 'bg-[#c084fc]',
        underlineClass: 'after:bg-[#c084fc]',
        chipSurfaceClass: 'bg-[#181322]/92 border-[#c084fc]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#161220]/95 border-[#c084fc]/25 text-neutral-100 hover:bg-[#1e182b]',
      };
    case '#d97706':
      return {
        dotClass: 'bg-[#e09f3e]',
        textClass: 'text-[#ebd089]',
        barClass: 'bg-[#e09f3e]',
        underlineClass: 'after:bg-[#e09f3e]',
        chipSurfaceClass: 'bg-[#191511]/92 border-[#e09f3e]/24 text-neutral-100',
        blockSurfaceClass:
          'bg-[#181410]/95 border-[#e09f3e]/25 text-neutral-100 hover:bg-[#201b14]',
      };
    case '#94a3b8':
      return {
        dotClass: 'bg-[#cbd5e1]',
        textClass: 'text-[#e2e8f0]',
        barClass: 'bg-[#cbd5e1]',
        underlineClass: 'after:bg-[#cbd5e1]',
        chipSurfaceClass: 'bg-[#14171f]/92 border-white/[0.12] text-neutral-100',
        blockSurfaceClass:
          'bg-[#14171f]/95 border-white/[0.13] text-neutral-100 hover:bg-[#1a1e28]',
      };
    default:
      return {
        dotClass: 'bg-neutral-300',
        textClass: 'text-neutral-200',
        barClass: 'bg-neutral-300',
        underlineClass: 'after:bg-white/95',
        chipSurfaceClass: 'bg-[#14171f]/92 border-white/[0.11] text-neutral-100',
        blockSurfaceClass: 'bg-[#14171e]/95 border-white/[0.12] text-neutral-100 hover:bg-[#191d26]',
      };
  }
}

export const PROJECT_STATUS_MAP: Record<
  ProjectStatus,
  { label: string; textClass: string; bgClass: string; dotClass: string }
> = {
  active: {
    label: '진행 중',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    dotClass: 'bg-emerald-400',
  },
  planning: {
    label: '기획 중',
    textClass: 'text-indigo-300',
    bgClass: 'bg-indigo-500/10',
    dotClass: 'bg-indigo-400',
  },
  on_hold: {
    label: '보류·대기',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    dotClass: 'bg-amber-400',
  },
  completed: {
    label: '완료',
    textClass: 'text-neutral-400',
    bgClass: 'bg-white/5',
    dotClass: 'bg-neutral-400',
  },
};

/**
 * 최초 앱 진입 시에는 빈 상태를 유지하며, 샘플 데이터는 사용자가 명시적으로 불러올 때만 주입됩니다.
 */
export const INITIAL_PROJECTS: ProjectItem[] = [];
