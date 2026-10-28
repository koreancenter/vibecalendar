import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Download,
  Calendar,
  CalendarDays,
  CalendarRange,
  LayoutGrid,
  Layers,
  Check,
  Loader2,
} from 'lucide-react';
import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';
import { getTodayDateString, getWeekDays } from '../shared/dateUtils';
import { generateIcsContent, downloadIcsFile } from '../utils/icsExport';
import {
  exportCalendarViewToPdf,
  PdfExportScope,
  PdfThemeMode,
} from '../utils/pdfExport';

const PDF_THEME_STORAGE_KEY = 'vibe_pdf_export_theme_v1';

interface ExportMenuDropdownProps {
  currentYear: number;
  currentMonth: number;
  selectedDate: string;
  viewMode: 'month' | 'week' | 'agenda';
  events: CalendarEventItem[];
  projects: ProjectItem[];
  selectedProjectIds: string[];
  selectedCategory: CalendarCategory | '전체';
  onExportDone?: (message: string) => void;
}

export const ExportMenuDropdown: React.FC<ExportMenuDropdownProps> = ({
  currentYear,
  currentMonth,
  selectedDate,
  viewMode,
  events,
  projects,
  selectedProjectIds,
  selectedCategory,
  onExportDone,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [exportingScope, setExportingScope] = useState<PdfExportScope | null>(null);
  const [hasExported, setHasExported] = useState(false);
  const [pdfTheme, setPdfTheme] = useState<PdfThemeMode>(() => {
    try {
      const saved = localStorage.getItem(PDF_THEME_STORAGE_KEY);
      if (saved === 'obsidian' || saved === 'editorial') return saved;
    } catch {
      // ignore storage errors
    }
    return 'obsidian';
  });

  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedDateEvents = useMemo(
    () => events.filter((e) => e.date === selectedDate),
    [events, selectedDate]
  );

  const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const monthEventsCount = useMemo(
    () => events.filter((e) => e.date.startsWith(monthPrefix)).length,
    [events, monthPrefix]
  );

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const weekEventsCount = useMemo(() => {
    const dateSet = new Set(weekDays.map((d) => d.date));
    return events.filter((e) => dateSet.has(e.date)).length;
  }, [events, weekDays]);

  const weekShortRange = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[6];
    return `${String(first.monthNumber).padStart(2, '0')}.${String(first.dayNumber).padStart(
      2,
      '0'
    )}–${String(last.monthNumber).padStart(2, '0')}.${String(last.dayNumber).padStart(2, '0')}`;
  }, [weekDays]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const handleSelectTheme = (mode: PdfThemeMode) => {
    setPdfTheme(mode);
    try {
      localStorage.setItem(PDF_THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  };

  const triggerSuccessFeedback = () => {
    setHasExported(true);
    setTimeout(() => setHasExported(false), 2400);
  };

  const handleExportPdf = async (scope: PdfExportScope) => {
    if (exportingScope) return;
    setExportingScope(scope);

    try {
      const result = await exportCalendarViewToPdf({
        scope,
        theme: pdfTheme,
        currentYear,
        currentMonth,
        selectedDate,
        events,
        projects,
        selectedProjectIds,
        selectedCategory,
      });

      triggerSuccessFeedback();
      setIsOpen(false);

      const label =
        scope === 'month'
          ? `${currentYear}년 ${currentMonth + 1}월 월간 일정표`
          : scope === 'week'
          ? `주간 타임라인 (${weekShortRange})`
          : '월간 · 주간 통합 브리프';

      onExportDone?.(
        `${label} PDF (${result.pageCount}p · ${result.eventCount}건)가 다운로드되었습니다.`
      );
    } catch {
      onExportDone?.('PDF 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setExportingScope(null);
    }
  };

  const handleExportSelectedDateIcs = () => {
    if (selectedDateEvents.length === 0) {
      onExportDone?.(`${selectedDate}에 등록된 일정이 없습니다.`);
      setIsOpen(false);
      return;
    }

    const icsString = generateIcsContent(selectedDateEvents, `${selectedDate} 일정`);
    downloadIcsFile(`calendar-${selectedDate}.ics`, icsString);

    triggerSuccessFeedback();
    setIsOpen(false);
    onExportDone?.(
      `${selectedDate} 일정 ${selectedDateEvents.length}건이 iCal(.ics) 파일로 다운로드되었습니다.`
    );
  };

  const handleExportAllIcs = () => {
    if (events.length === 0) {
      onExportDone?.('내보낼 일정이 없습니다.');
      setIsOpen(false);
      return;
    }

    const icsString = generateIcsContent(events, '바이브 행사 전체 일정');
    const todayStr = getTodayDateString();
    downloadIcsFile(`calendar-all-${todayStr}.ics`, icsString);

    triggerSuccessFeedback();
    setIsOpen(false);
    onExportDone?.(`전체 ${events.length}건의 일정이 iCal(.ics) 파일로 다운로드되었습니다.`);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={Boolean(exportingScope)}
        aria-label="내보내기"
        aria-expanded={isOpen}
        title="일정 내보내기 (PDF · ICS)"
        className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer disabled:opacity-60 ${
          isOpen
            ? 'bg-white/[0.08] text-white'
            : 'text-neutral-500 hover:text-white hover:bg-white/[0.05]'
        }`}
      >
        {exportingScope ? (
          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
        ) : hasExported ? (
          <Check className="w-3.5 h-3.5 text-emerald-300" />
        ) : (
          <Download className="w-3.5 h-3.5" strokeWidth={1.65} />
        )}
      </button>

      {isOpen && (
        <div className="luxury-glass-border absolute right-0 top-full mt-2 w-64 rounded-xl bg-gradient-to-b from-[#181c27]/88 via-[#11141d]/84 to-[#0c0e15]/92 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.82),0_8px_20px_-4px_rgba(0,0,0,0.52),inset_0_1px_0_0_rgba(255,255,255,0.05)] p-1.5 z-50 overflow-hidden">
          {/* 섹션 1: 일정 리포트 (PDF) */}
          <div className="px-2.5 pt-1.5 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium text-neutral-500 whitespace-nowrap">
              일정 리포트 · PDF
            </span>
            <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-white/[0.04]">
              <button
                type="button"
                onClick={() => handleSelectTheme('obsidian')}
                className={`px-1.5 h-4.5 rounded text-[10px] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  pdfTheme === 'obsidian'
                    ? 'bg-white/[0.12] text-white font-medium'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                다크
              </button>
              <button
                type="button"
                onClick={() => handleSelectTheme('editorial')}
                className={`px-1.5 h-4.5 rounded text-[10px] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  pdfTheme === 'editorial'
                    ? 'bg-white/[0.12] text-white font-medium'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                화이트
              </button>
            </div>
          </div>

          <div className="space-y-0.5 pb-1.5">
            <button
              type="button"
              onClick={() => handleExportPdf('month')}
              disabled={Boolean(exportingScope)}
              className="group w-full px-2.5 py-1.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <LayoutGrid className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition-colors shrink-0" />
                <span className="text-xs text-neutral-200 group-hover:text-white transition-colors whitespace-nowrap">
                  월간 일정표
                </span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-neutral-500 group-hover:text-neutral-300 shrink-0">
                {monthEventsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleExportPdf('week')}
              disabled={Boolean(exportingScope)}
              className="group w-full px-2.5 py-1.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <CalendarRange className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition-colors shrink-0" />
                <span className="text-xs text-neutral-200 group-hover:text-white transition-colors whitespace-nowrap">
                  주간 타임라인
                </span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-neutral-500 group-hover:text-neutral-300 shrink-0">
                {weekEventsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleExportPdf('both')}
              disabled={Boolean(exportingScope)}
              className="group w-full px-2.5 py-1.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition-colors shrink-0" />
                <span className="text-xs text-neutral-200 group-hover:text-white transition-colors whitespace-nowrap">
                  월간 · 주간 통합본
                </span>
              </div>
              <span className="text-[10px] font-mono text-neutral-500 group-hover:text-neutral-300 shrink-0">
                A4
              </span>
            </button>
          </div>

          {/* 섹션 2: 캘린더 파일 (.ics) */}
          <div className="pt-1.5 border-t border-white/[0.06]">
            <div className="px-2.5 pb-1">
              <span className="text-[10px] font-medium text-neutral-500 whitespace-nowrap">
                캘린더 파일 · ICS
              </span>
            </div>

            <div className="space-y-0.5">
              <button
                type="button"
                onClick={handleExportSelectedDateIcs}
                disabled={selectedDateEvents.length === 0}
                className="group w-full px-2.5 py-1.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition-colors shrink-0" />
                  <span className="text-xs text-neutral-200 group-hover:text-white transition-colors truncate">
                    선택 날짜 내보내기
                  </span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-500 shrink-0">
                  {selectedDateEvents.length}
                </span>
              </button>

              <button
                type="button"
                onClick={handleExportAllIcs}
                disabled={events.length === 0}
                className="group w-full px-2.5 py-1.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarDays className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition-colors shrink-0" />
                  <span className="text-xs text-neutral-200 group-hover:text-white transition-colors truncate">
                    전체 일정 내보내기
                  </span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-500 shrink-0">
                  {events.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
