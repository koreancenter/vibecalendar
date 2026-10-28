import { CalendarCategory } from '../types';

export interface CategoryColorStyle {
  bg: string;
  text: string;
  dot: string;
  border: string;
  blockBg: string;
  blockBorder: string;
  blockText: string;
  blockHover: string;
}

/**
 * 초 럭셔리 미니멀리즘 스모크드 옵시디언 카테고리 스타일 (프로젝트 미지정 시 폴백용)
 */
export const CATEGORY_COLORS: Record<CalendarCategory, CategoryColorStyle> = {
  '업무': {
    bg: 'bg-[#131722]/92',
    text: 'text-neutral-200',
    dot: 'bg-[#7aa2f7]',
    border: 'border-[#7aa2f7]/22',
    blockBg: 'bg-[#131721]/95',
    blockBorder: 'border-[#7aa2f7]/24',
    blockText: 'text-neutral-100',
    blockHover: 'hover:bg-[#181d2a]',
  },
  '방문·출장': {
    bg: 'bg-[#121917]/92',
    text: 'text-neutral-200',
    dot: 'bg-[#4fd1a5]',
    border: 'border-[#4fd1a5]/22',
    blockBg: 'bg-[#111816]/95',
    blockBorder: 'border-[#4fd1a5]/24',
    blockText: 'text-neutral-100',
    blockHover: 'hover:bg-[#161f1c]',
  },
  '식사·모임': {
    bg: 'bg-[#181511]/92',
    text: 'text-neutral-200',
    dot: 'bg-[#d4a359]',
    border: 'border-[#d4a359]/24',
    blockBg: 'bg-[#171410]/95',
    blockBorder: 'border-[#d4a359]/25',
    blockText: 'text-neutral-100',
    blockHover: 'hover:bg-[#1f1b15]',
  },
  '개인': {
    bg: 'bg-[#161420]/92',
    text: 'text-neutral-200',
    dot: 'bg-[#b497f5]',
    border: 'border-[#b497f5]/22',
    blockBg: 'bg-[#15131f]/95',
    blockBorder: 'border-[#b497f5]/24',
    blockText: 'text-neutral-100',
    blockHover: 'hover:bg-[#1c1929]',
  },
  '행사·세미나': {
    bg: 'bg-[#1a1317]/92',
    text: 'text-neutral-200',
    dot: 'bg-[#e58598]',
    border: 'border-[#e58598]/22',
    blockBg: 'bg-[#181216]/95',
    blockBorder: 'border-[#e58598]/24',
    blockText: 'text-neutral-100',
    blockHover: 'hover:bg-[#20171c]',
  },
  '기타': {
    bg: 'bg-[#14171f]/92',
    text: 'text-neutral-200',
    dot: 'bg-[#94a3b8]',
    border: 'border-white/[0.11]',
    blockBg: 'bg-[#14171e]/95',
    blockBorder: 'border-white/[0.12]',
    blockText: 'text-neutral-100',
    blockHover: 'hover:bg-[#191d26]',
  },
};

export const CALENDAR_CATEGORIES: CalendarCategory[] = [
  '업무',
  '방문·출장',
  '식사·모임',
  '개인',
  '행사·세미나',
  '기타',
];
