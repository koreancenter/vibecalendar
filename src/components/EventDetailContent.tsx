import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Trash2,
  CheckCircle,
  Circle,
  CheckSquare,
  Square,
  Download,
  AlertTriangle,
  X,
  FileText,
  ListTodo,
  FolderKanban,
  Share2,
  Plus,
  Loader2,
  Search,
} from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import {
  detectBrowserTimeZone,
  GLOBAL_EVENT_TIMEZONES,
  isValidTimeZone,
  projectEventToViewerTimeZone,
  TimeZoneOption,
} from '../shared/timeZoneUtils';
import {
  hasValidCoordinates,
  normalizeCoordinates,
  parseCoordinatePairFromString,
} from '../shared/locationUtils';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';
import { generateIcsContent, downloadIcsFile } from '../utils/icsExport';
import { resolveLocationDetails } from '../services/agentApi';
import { LocationPinPreviewCard } from './LocationPinPreviewCard';

interface EventDetailContentProps {
  event: CalendarEventItem;
  viewerTimeZone?: string;
  hasConflict?: boolean;
  projects?: ProjectItem[];
  variant?: 'modal' | 'panel';
  onUpdateProject?: (eventId: string, projectId: string | undefined) => void;
  onUpdateTimeZone?: (eventId: string, timeZone: string | undefined) => void;
  onUpdateLocation?: (
    eventId: string,
    location?: string,
    locationAddress?: string,
    locationLat?: number,
    locationLng?: number
  ) => void;
  onToggleComplete: (id: string) => void;
  onToggleChecklistItem: (eventId: string, itemId: string) => void;
  onShare?: (event: CalendarEventItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const EventDetailContent: React.FC<EventDetailContentProps> = ({
  event,
  viewerTimeZone,
  hasConflict = false,
  projects = [],
  variant = 'modal',
  onUpdateProject,
  onUpdateTimeZone,
  onUpdateLocation,
  onToggleComplete,
  onToggleChecklistItem,
  onShare,
  onDelete,
  onClose,
}) => {
  const theme = resolveEventLuxuryTheme(event, projects);
  const currentProject = theme.project;
  const isPanel = variant === 'panel';

  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [locDraft, setLocDraft] = useState(event.location || '');
  const [addrDraft, setAddrDraft] = useState(event.locationAddress || '');
  const [latDraft, setLatDraft] = useState(
    hasValidCoordinates(event.locationLat, event.locationLng)
      ? event.locationLat!.toFixed(6)
      : ''
  );
  const [lngDraft, setLngDraft] = useState(
    hasValidCoordinates(event.locationLat, event.locationLng)
      ? event.locationLng!.toFixed(6)
      : ''
  );
  const [coordError, setCoordError] = useState<string | null>(null);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [resolveNotice, setResolveNotice] = useState<string | null>(null);

  useEffect(() => {
    setIsEditingLocation(false);
    setLocDraft(event.location || '');
    setAddrDraft(event.locationAddress || '');
    const valid = hasValidCoordinates(event.locationLat, event.locationLng);
    setLatDraft(valid ? event.locationLat!.toFixed(6) : '');
    setLngDraft(valid ? event.locationLng!.toFixed(6) : '');
    setCoordError(null);
    setIsResolvingLocation(false);
    setResolveNotice(null);
  }, [
    event.id,
    event.location,
    event.locationAddress,
    event.locationLat,
    event.locationLng,
  ]);

  const safeViewerZone = useMemo(
    () =>
      viewerTimeZone && isValidTimeZone(viewerTimeZone)
        ? viewerTimeZone
        : detectBrowserTimeZone(),
    [viewerTimeZone]
  );

  const timing = useMemo(
    () => projectEventToViewerTimeZone(event, safeViewerZone),
    [event, safeViewerZone]
  );

  const timeZoneOptions = useMemo(() => {
    const map = new Map<string, TimeZoneOption>();
    if (!GLOBAL_EVENT_TIMEZONES.some((tz) => tz.iana === timing.viewerMeta.iana)) {
      map.set(timing.viewerMeta.iana, timing.viewerMeta);
    }
    if (!GLOBAL_EVENT_TIMEZONES.some((tz) => tz.iana === timing.sourceMeta.iana)) {
      map.set(timing.sourceMeta.iana, timing.sourceMeta);
    }
    for (const tz of GLOBAL_EVENT_TIMEZONES) {
      map.set(tz.iana, tz);
    }
    return Array.from(map.values());
  }, [timing.viewerMeta, timing.sourceMeta]);

  const handleDownloadSingleIcs = () => {
    const ics = generateIcsContent([event], event.title);
    downloadIcsFile(`${event.title}.ics`, ics);
  };

  const handleCoordinateInputChange = (field: 'lat' | 'lng', rawVal: string) => {
    setCoordError(null);
    // "37.566535, 126.977969" 형태 붙여넣기 시 위도·경도 자동 분리
    const pair = parseCoordinatePairFromString(rawVal);
    if (pair) {
      setLatDraft(pair.lat.toFixed(6));
      setLngDraft(pair.lng.toFixed(6));
      return;
    }
    if (field === 'lat') {
      setLatDraft(rawVal);
    } else {
      setLngDraft(rawVal);
    }
  };

  const handleAutoResolveInView = async () => {
    if (!onUpdateLocation || isResolvingLocation) return;
    const queryLoc = event.location || event.title;
    setIsResolvingLocation(true);
    setResolveNotice(null);
    try {
      const res = await resolveLocationDetails({
        location: queryLoc,
        locationAddress: event.locationAddress,
      });
      if (res.found) {
        onUpdateLocation(
          event.id,
          res.location || event.location,
          res.locationAddress || event.locationAddress,
          res.locationLat ?? event.locationLat,
          res.locationLng ?? event.locationLng
        );
      } else {
        setResolveNotice('검색으로 확인되는 외부 도로명 주소·좌표가 없어 직접 편집에서 입력할 수 있습니다.');
      }
    } catch (err: unknown) {
      setResolveNotice(
        err instanceof Error && err.message
          ? err.message
          : '위치 정보를 조회하지 못했습니다. 편집에서 직접 입력해 주세요.'
      );
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const handleAutoResolveInEditor = async () => {
    if (isResolvingLocation) return;
    const queryLoc = locDraft.trim() || addrDraft.trim() || event.title;
    if (!queryLoc) {
      setCoordError('탐색할 장소명이나 주소를 먼저 입력해 주세요.');
      return;
    }
    setIsResolvingLocation(true);
    setCoordError(null);
    try {
      const res = await resolveLocationDetails({
        location: locDraft.trim() || queryLoc,
        locationAddress: addrDraft.trim() || undefined,
      });
      if (res.found) {
        if (res.location && !locDraft.trim()) {
          setLocDraft(res.location);
        }
        if (res.locationAddress) {
          setAddrDraft(res.locationAddress);
        }
        if (res.locationLat !== undefined && res.locationLng !== undefined) {
          setLatDraft(res.locationLat.toFixed(6));
          setLngDraft(res.locationLng.toFixed(6));
        }
      } else {
        setCoordError('외부 검색에서 정확한 주소·위경도를 찾지 못했습니다. 직접 입력해 주세요.');
      }
    } catch (err: unknown) {
      setCoordError(
        err instanceof Error && err.message
          ? err.message
          : '위치 탐색 중 오류가 발생했습니다.'
      );
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const handleSaveLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateLocation) return;

    const trimmedLat = latDraft.trim();
    const trimmedLng = lngDraft.trim();

    let nextLat: number | undefined;
    let nextLng: number | undefined;

    if (trimmedLat || trimmedLng) {
      if (!trimmedLat || !trimmedLng) {
        setCoordError('위도와 경도를 함께 입력하거나 모두 비워 주세요.');
        return;
      }
      const norm = normalizeCoordinates(trimmedLat, trimmedLng);
      if (norm.locationLat === undefined || norm.locationLng === undefined) {
        setCoordError('유효한 WGS84 위도(-90 ~ 90) 및 경도(-180 ~ 180) 숫자를 입력해 주세요.');
        return;
      }
      nextLat = norm.locationLat;
      nextLng = norm.locationLng;
    }

    onUpdateLocation(event.id, locDraft, addrDraft, nextLat, nextLng);
    setIsEditingLocation(false);
  };

  const hasAnyLocationData = Boolean(
    event.location ||
      event.locationAddress ||
      hasValidCoordinates(event.locationLat, event.locationLng)
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 상단 액션 헤더 (Smoked Obsidian + Zero-Pill 무박스 메타데이터) */}
      <div
        className={
          isPanel
            ? 'h-11 px-3.5 border-b border-white/[0.07] flex items-center justify-between gap-2 shrink-0 bg-[#12151e]'
            : 'px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-3 shrink-0 bg-[#13161f]'
        }
      >
        <div className="flex items-center gap-1.5 text-xs text-neutral-400 min-w-0 truncate">
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${theme.dotClass}`} />
          {currentProject && (
            <>
              <span
                className={`font-medium truncate max-w-[140px] ${theme.accentTextClass}`}
                title={currentProject.name}
              >
                {currentProject.code || currentProject.name}
              </span>
              <span aria-hidden="true" className="text-neutral-600 shrink-0">
                ·
              </span>
            </>
          )}
          <span className="text-neutral-300 shrink-0">{event.category}</span>

          {hasConflict && (
            <>
              <span aria-hidden="true" className="text-neutral-600 shrink-0">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>시간 겹침</span>
              </span>
            </>
          )}

          {event.isCompleted && (
            <>
              <span aria-hidden="true" className="text-neutral-600 shrink-0">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-300 shrink-0">
                <CheckCircle className="w-3 h-3 shrink-0" />
                <span>완료됨</span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(event)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              title="브리핑 패스 공유"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadSingleIcs}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="ICS 파일 다운로드"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(event.id)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            title="일정 삭제"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 본문 스크롤 영역 */}
      <div className="flex-1 p-5 overflow-y-auto space-y-5 select-text">
        {/* 제목 & 완료 토글 + 인라인 시간대 지정 */}
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggleComplete(event.id)}
            className="mt-1 text-neutral-400 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
            title={event.isCompleted ? '완료 취소' : '일정 완료'}
          >
            {event.isCompleted ? (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <h3
              className={`text-base sm:text-lg font-bold leading-snug break-words ${
                event.isCompleted ? 'line-through text-neutral-500' : 'text-neutral-100'
              }`}
            >
              {event.title}
            </h3>

            <div className="text-xs text-neutral-400 mt-1.5 flex items-center gap-1.5 flex-wrap font-mono tabular-nums">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="text-neutral-200">{event.date}</span>
              </span>
              <span className="text-neutral-600" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Clock className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="text-neutral-200">
                  {event.isAllDay ? '종일 일정' : `${event.startTime} – ${event.endTime}`}
                </span>
              </span>

              {!event.isAllDay &&
                (onUpdateTimeZone ? (
                  <select
                    value={timing.sourceTimeZone}
                    onChange={(e) => onUpdateTimeZone(event.id, e.target.value)}
                    aria-label="일정 기준 시간대"
                    title="일정 시간의 기준 시간대 선택"
                    className="ml-0.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.18] rounded-md px-1.5 py-0.5 text-[11px] font-mono text-neutral-200 outline-hidden cursor-pointer transition-colors whitespace-nowrap shrink-0"
                  >
                    {timeZoneOptions.map((tz) => (
                      <option
                        key={tz.iana}
                        value={tz.iana}
                        className="bg-[#12151e] text-neutral-100"
                      >
                        {tz.shortCode} · {tz.cityKo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] text-neutral-400 whitespace-nowrap">
                    {timing.sourceMeta.shortCode}
                  </span>
                ))}
            </div>

            {!event.isAllDay && timing.hasOffsetDiff && (
              <p className="mt-1 text-[11px] font-mono tabular-nums text-neutral-400">
                내 위치({timing.viewerMeta.cityKo}) 기준{' '}
                {timing.localDate !== event.date ? `${timing.localDate} ` : ''}
                <span className="text-neutral-200">
                  {timing.localStartTime} – {timing.localEndTime}
                </span>{' '}
                <span className="text-neutral-500">{timing.viewerMeta.shortCode}</span>
              </p>
            )}
          </div>
        </div>

        {/* 소속 프로젝트 */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#161a24] border border-white/[0.06] text-xs gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <FolderKanban className="w-4 h-4 text-neutral-400" />
            <span className="font-medium text-neutral-300">소속 프로젝트</span>
          </div>
          {onUpdateProject ? (
            <select
              value={event.projectId || ''}
              onChange={(e) => onUpdateProject(event.id, e.target.value || undefined)}
              className="bg-[#10131b] border border-white/[0.09] rounded-lg px-2.5 py-1 text-xs text-neutral-100 outline-hidden cursor-pointer hover:border-white/20 transition-colors max-w-[210px] truncate"
            >
              <option value="">(지정 안 됨 / 일반 일정)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-neutral-400">
              {currentProject ? (
                <span className="flex items-center gap-1.5 font-medium text-neutral-100">
                  <span className={`w-2 h-2 rounded-full ${theme.dotClass}`} />
                  {currentProject.name}
                </span>
              ) : (
                '지정 안 됨'
              )}
            </span>
          )}
        </div>

        {/* 핀 위치 미리보기 & 상세 주소 · 위경도 분리 섹션 및 인라인 편집 */}
        {isEditingLocation ? (
          <form
            onSubmit={handleSaveLocation}
            className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.12] space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>장소명 · 상세 주소 · 위경도 편집</span>
              </span>

              <button
                type="button"
                onClick={handleAutoResolveInEditor}
                disabled={isResolvingLocation}
                className="h-6 px-2.5 rounded-md bg-white/[0.05] hover:bg-white/[0.10] disabled:opacity-50 border border-white/[0.09] text-[10.5px] text-neutral-200 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="장소명 또는 주소로 도로명 주소와 WGS84 위경도를 자동 검색합니다"
              >
                {isResolvingLocation ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : (
                  <Search className="w-3 h-3 shrink-0" />
                )}
                <span>{isResolvingLocation ? '탐색 중...' : '주소·위경도 자동 탐색'}</span>
              </button>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  공식 장소명 · 건물 · 층 · 호실
                </label>
                <input
                  type="text"
                  value={locDraft}
                  onChange={(e) => setLocDraft(e.target.value)}
                  placeholder="예: 아스트라 타워 서관 3층 대회의실"
                  autoFocus
                  className="w-full h-9 px-3 rounded-lg bg-[#0e1118] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-600 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  상세 도로명 · 지번 주소
                </label>
                <input
                  type="text"
                  value={addrDraft}
                  onChange={(e) => setAddrDraft(e.target.value)}
                  placeholder="예: 서울특별시 중구 노바센트럴로 88"
                  className="w-full h-9 px-3 rounded-lg bg-[#0e1118] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-600 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1 font-mono">
                    위도 (Latitude)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={latDraft}
                    onChange={(e) => handleCoordinateInputChange('lat', e.target.value)}
                    placeholder="예: 37.566535"
                    className="w-full h-9 px-3 rounded-lg bg-[#0e1118] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-600 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1 font-mono">
                    경도 (Longitude)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={lngDraft}
                    onChange={(e) => handleCoordinateInputChange('lng', e.target.value)}
                    placeholder="예: 126.977969"
                    className="w-full h-9 px-3 rounded-lg bg-[#0e1118] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-600 outline-hidden"
                  />
                </div>
              </div>
            </div>

            {coordError ? (
              <p className="text-[11px] text-rose-300 leading-snug">{coordError}</p>
            ) : (
              <p className="text-[10.5px] text-neutral-500 leading-snug">
                &apos;37.566535, 126.977969&apos; 형식을 붙여넣으면 위도·경도가 자동 분리되며, &apos;~인근&apos; 수식어는 저장 시 정제됩니다.
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-0.5">
              {(latDraft || lngDraft) ? (
                <button
                  type="button"
                  onClick={() => {
                    setLatDraft('');
                    setLngDraft('');
                    setCoordError(null);
                  }}
                  className="text-[11px] text-neutral-400 hover:text-neutral-200 underline underline-offset-2 cursor-pointer whitespace-nowrap"
                >
                  좌표 비우기
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setLocDraft(event.location || '');
                    setAddrDraft(event.locationAddress || '');
                    const valid = hasValidCoordinates(event.locationLat, event.locationLng);
                    setLatDraft(valid ? event.locationLat!.toFixed(6) : '');
                    setLngDraft(valid ? event.locationLng!.toFixed(6) : '');
                    setCoordError(null);
                    setIsEditingLocation(false);
                  }}
                  className="h-8 px-3 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-xs text-neutral-300 transition-colors cursor-pointer whitespace-nowrap"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="h-8 px-3.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  저장
                </button>
              </div>
            </div>
          </form>
        ) : hasAnyLocationData ? (
          <LocationPinPreviewCard
            event={event}
            accentHex={currentProject?.color || '#60a5fa'}
            accentDotClass={theme.dotClass}
            compact={isPanel}
            isAutoResolving={isResolvingLocation}
            autoResolveNotice={resolveNotice}
            onEdit={onUpdateLocation ? () => setIsEditingLocation(true) : undefined}
            onAutoResolve={onUpdateLocation ? handleAutoResolveInView : undefined}
          />
        ) : onUpdateLocation ? (
          <button
            type="button"
            onClick={() => setIsEditingLocation(true)}
            className="w-full p-3.5 rounded-xl border border-dashed border-white/[0.09] hover:border-white/[0.18] bg-white/[0.015] hover:bg-white/[0.03] text-xs text-neutral-400 hover:text-neutral-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>정확한 장소명 · 상세 주소 · 위경도 핀 위치 등록</span>
          </button>
        ) : null}

        {/* 상세 설명 */}
        {event.content && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-neutral-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-neutral-400" />
              <span>상세 메모 및 파트너 정보</span>
            </span>
            <div className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.06] text-xs sm:text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">
              {event.content}
            </div>
          </div>
        )}

        {/* 체크리스트 */}
        {event.checklist && event.checklist.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-400 flex items-center gap-1.5">
                <ListTodo className="w-3.5 h-3.5 text-neutral-400" />
                <span>체크리스트</span>
              </span>
              <span className="text-xs font-mono text-neutral-400 tabular-nums">
                {event.checklist.filter((c) => c.done).length} / {event.checklist.length}
              </span>
            </div>
            <div className="space-y-1.5 bg-[#161a24] p-3 rounded-xl border border-white/[0.06]">
              {event.checklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onToggleChecklistItem(event.id, item.id)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer group select-none"
                >
                  {item.done ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-neutral-500 group-hover:text-neutral-300 shrink-0" />
                  )}
                  <span
                    className={`text-xs ${
                      item.done ? 'line-through text-neutral-500' : 'text-neutral-200'
                    }`}
                  >
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
