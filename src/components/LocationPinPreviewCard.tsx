import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Crosshair,
  ExternalLink,
  Loader2,
  MapPin,
  Minus,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { CalendarEventItem } from '../types';
import {
  buildGoogleMapsPinUrl,
  formatCombinedLocation,
  formatCoordinateDMS,
  formatCoordinatePairPlain,
  formatLatitudeDecimal,
  formatLongitudeDecimal,
  hasValidCoordinates,
  inferRegionalMapAnchor,
  isInternalOrVirtualLocation,
} from '../shared/locationUtils';

interface LocationPinPreviewCardProps {
  event: CalendarEventItem;
  accentHex?: string;
  accentDotClass: string;
  compact?: boolean;
  isAutoResolving?: boolean;
  autoResolveNotice?: string | null;
  onEdit?: () => void;
  onAutoResolve?: () => void;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededUnit(seed: number, step: number): number {
  let x = (seed + Math.imul(step + 1, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

const ZOOM_SCALE_METERS: Record<number, string> = {
  14: '400m',
  15: '200m',
  16: '100m',
  17: '50m',
  18: '25m',
};

export const LocationPinPreviewCard: React.FC<LocationPinPreviewCardProps> = ({
  event,
  accentHex = '#60a5fa',
  accentDotClass,
  compact = false,
  isAutoResolving = false,
  autoResolveNotice = null,
  onEdit,
  onAutoResolve,
}) => {
  const exactCoords = hasValidCoordinates(event.locationLat, event.locationLng);
  const regionalAnchor = useMemo(
    () => inferRegionalMapAnchor(event.location, event.locationAddress),
    [event.location, event.locationAddress]
  );

  const displayLat = exactCoords ? event.locationLat! : regionalAnchor.lat;
  const displayLng = exactCoords ? event.locationLng! : regionalAnchor.lng;

  const [zoom, setZoom] = useState<number>(16);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  const [copiedTarget, setCopiedTarget] = useState<'address' | 'coords' | null>(null);

  useEffect(() => {
    setZoom(16);
    setPan({ x: 0, y: 0 });
    setCopiedTarget(null);
  }, [event.id, event.location, event.locationAddress, event.locationLat, event.locationLng]);

  const mapGeometry = useMemo(() => {
    const seedStr = `${displayLat.toFixed(5)}:${displayLng.toFixed(5)}:${event.location || ''}:${event.locationAddress || ''}`;
    const seed = hashSeed(seedStr);

    const mainAngleDeg = (seededUnit(seed, 1) - 0.5) * 28;
    const crossAngleDeg = mainAngleDeg + 90 + (seededUnit(seed, 2) - 0.5) * 10;
    const hasWaterway = seededUnit(seed, 3) > 0.42;
    const waterOffsetY = seededUnit(seed, 4) > 0.5 ? -96 : 102;
    const waterCurve = (seededUnit(seed, 5) - 0.5) * 44;

    const blocks: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      isPark?: boolean;
      isAnchorBlock?: boolean;
    }> = [
      // 핀 직하단 메인 건축 블록
      { x: 294, y: 138, w: 52, h: 42, isAnchorBlock: true },
    ];

    const gridOffsetsX = [-210, -135, -66, 66, 138, 212];
    const gridOffsetsY = [-102, -52, 54, 104];

    let idx = 10;
    for (const gx of gridOffsetsX) {
      for (const gy of gridOffsetsY) {
        idx += 1;
        const w = 42 + Math.round(seededUnit(seed, idx) * 28);
        const h = 26 + Math.round(seededUnit(seed, idx + 30) * 18);
        const jitterX = Math.round((seededUnit(seed, idx + 60) - 0.5) * 12);
        const jitterY = Math.round((seededUnit(seed, idx + 90) - 0.5) * 10);
        const isPark = seededUnit(seed, idx + 120) > 0.83;
        blocks.push({
          x: 320 + gx - w / 2 + jitterX,
          y: 160 + gy - h / 2 + jitterY,
          w,
          h,
          isPark,
        });
      }
    }

    return {
      mainAngleDeg,
      crossAngleDeg,
      hasWaterway,
      waterOffsetY,
      waterCurve,
      blocks,
    };
  }, [displayLat, displayLng, event.location, event.locationAddress]);

  const zoomScaleFactor = useMemo(() => Math.pow(1.24, zoom - 16), [zoom]);
  const isOffsetFromCenter = zoom !== 16 || Math.abs(pan.x) > 2 || Math.abs(pan.y) > 2;

  const googleMapsUrl = useMemo(
    () =>
      buildGoogleMapsPinUrl({
        location: event.location,
        locationAddress: event.locationAddress,
        locationLat: event.locationLat,
        locationLng: event.locationLng,
        isSample: event.isSample,
      }),
    [event.location, event.locationAddress, event.locationLat, event.locationLng, event.isSample]
  );

  const canSuggestAutoResolve =
    Boolean(onAutoResolve) &&
    !event.isSample &&
    Boolean(event.location || event.locationAddress) &&
    !isInternalOrVirtualLocation(event.location || event.locationAddress) &&
    (!event.locationAddress || !exactCoords);

  const handleCopyAddress = async () => {
    const targetText =
      event.locationAddress?.trim() ||
      formatCombinedLocation(event.location, event.locationAddress, ' — ');
    if (!targetText) return;
    try {
      await navigator.clipboard.writeText(targetText);
      setCopiedTarget('address');
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === 'address' ? null : prev));
      }, 1600);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleCopyCoordinates = async () => {
    if (!exactCoords) return;
    const coordStr = formatCoordinatePairPlain(event.locationLat!, event.locationLng!);
    try {
      await navigator.clipboard.writeText(coordStr);
      setCopiedTarget('coords');
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === 'coords' ? null : prev));
      }, 1600);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    const nextX = Math.max(-110, Math.min(110, dragStartRef.current.origX + dx));
    const nextY = Math.max(-75, Math.min(75, dragStartRef.current.origY + dy));
    setPan({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current) {
      dragStartRef.current = null;
      setIsDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handleResetView = () => {
    setZoom(16);
    setPan({ x: 0, y: 0 });
  };

  return (
    <section
      aria-label="장소 위치 미리보기 및 좌표 정보"
      className="rounded-xl bg-[#151923] border border-white/[0.08] overflow-hidden"
    >
      {/* 상단 섹션 타이틀 & 편집/자동보완 액션 바 */}
      <div className="px-3.5 py-2.5 border-b border-white/[0.06] bg-[#121620] flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          <span className="text-xs font-medium text-neutral-200 truncate">
            장소 위치 및 상세 명세
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canSuggestAutoResolve && (
            <button
              type="button"
              onClick={onAutoResolve}
              disabled={isAutoResolving}
              className="h-6 px-2 rounded-md bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-50 border border-white/[0.08] text-[10.5px] text-neutral-200 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="검색을 통해 정확한 도로명 주소와 WGS84 위경도를 자동 보완합니다"
            >
              {isAutoResolving ? (
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              ) : (
                <Search className="w-3 h-3 shrink-0" />
              )}
              <span>{isAutoResolving ? '탐색 중' : '주소·좌표 탐색'}</span>
            </button>
          )}

          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="h-6 px-2 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[10.5px] text-neutral-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="장소명 · 상세 주소 · 위경도 직접 편집"
            >
              <Pencil className="w-2.5 h-2.5 shrink-0" />
              <span>편집</span>
            </button>
          )}
        </div>
      </div>

      {/* 구글 지도 스타일 다크 카토그래피 핀 미리보기 뷰포트 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative w-full ${
          compact ? 'h-40' : 'h-48 sm:h-52'
        } bg-[#0b0f17] overflow-hidden select-none border-b border-white/[0.07] ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        {/* 패닝 · 줌 변환 레이어 (compositor transform 전용) */}
        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoomScaleFactor})`,
            transformOrigin: '50% 50%',
          }}
          className={`w-full h-full ${
            isDragging ? '' : 'transition-transform duration-150 ease-out'
          }`}
        >
          <svg
            viewBox="0 0 640 320"
            preserveAspectRatio="xMidYMid slice"
            className="w-full h-full block"
            aria-hidden="true"
          >
            {/* 베이스 지형 */}
            <rect x="-120" y="-120" width="880" height="560" fill="#0c1018" />

            {/* 수변 / 하천 지형 (시드 기반) */}
            {mapGeometry.hasWaterway && (
              <path
                d={`M -100 ${160 + mapGeometry.waterOffsetY} Q 210 ${
                  160 + mapGeometry.waterOffsetY + mapGeometry.waterCurve
                } 740 ${160 + mapGeometry.waterOffsetY - mapGeometry.waterCurve * 0.7}`}
                fill="none"
                stroke="#0a1929"
                strokeWidth="34"
                strokeLinecap="round"
              />
            )}

            {/* 도시 블록 · 녹지 · 간선/보조 도로망 그룹 */}
            <g transform={`rotate(${mapGeometry.mainAngleDeg} 320 160)`}>
              {/* 미세 경위도 격자 */}
              {[-240, -160, -80, 0, 80, 160, 240].map((offset) => (
                <line
                  key={`gx-${offset}`}
                  x1={320 + offset}
                  y1={-120}
                  x2={320 + offset}
                  y2={440}
                  stroke="rgba(148, 163, 184, 0.045)"
                  strokeWidth="1"
                />
              ))}
              {[-140, -70, 0, 70, 140].map((offset) => (
                <line
                  key={`gy-${offset}`}
                  x1={-120}
                  y1={160 + offset}
                  x2={760}
                  y2={160 + offset}
                  stroke="rgba(148, 163, 184, 0.045)"
                  strokeWidth="1"
                />
              ))}

              {/* 건축 필지 & 공원 블록 */}
              {mapGeometry.blocks.map((b, i) => (
                <rect
                  key={`blk-${i}`}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={b.isAnchorBlock ? 5 : 3}
                  fill={
                    b.isPark
                      ? '#0f1d19'
                      : b.isAnchorBlock
                      ? '#192131'
                      : '#121824'
                  }
                  stroke={
                    b.isPark
                      ? 'rgba(52, 211, 153, 0.10)'
                      : b.isAnchorBlock
                      ? accentHex
                      : 'rgba(255, 255, 255, 0.035)'
                  }
                  strokeOpacity={b.isAnchorBlock ? 0.45 : 1}
                  strokeWidth={b.isAnchorBlock ? 1.2 : 0.8}
                />
              ))}

              {/* 로컬 이면도로 */}
              {[-172, -100, -34, 34, 102, 174].map((xOff) => (
                <line
                  key={`rd-v-${xOff}`}
                  x1={320 + xOff}
                  y1={-120}
                  x2={320 + xOff}
                  y2={440}
                  stroke="#1a2232"
                  strokeWidth="4.5"
                />
              ))}
              {[-78, 78].map((yOff) => (
                <line
                  key={`rd-h-${yOff}`}
                  x1={-120}
                  y1={160 + yOff}
                  x2={760}
                  y2={160 + yOff}
                  stroke="#1c2536"
                  strokeWidth="5.5"
                />
              ))}

              {/* 주간선 도로 (수평 & 수직 교차) */}
              <line
                x1={-120}
                y1={160 - 24}
                x2={760}
                y2={160 - 24}
                stroke="#29354d"
                strokeWidth="9.5"
              />
              <line
                x1={-120}
                y1={160 - 24}
                x2={760}
                y2={160 - 24}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="0.9"
                strokeDasharray="6 6"
              />

              <line
                x1={320 - 34}
                y1={-120}
                x2={320 - 34}
                y2={440}
                stroke="#253047"
                strokeWidth="8"
              />
            </g>

            {/* 대각 보조 간선도로 */}
            <g transform={`rotate(${mapGeometry.crossAngleDeg} 320 160)`}>
              <line
                x1={-120}
                y1={232}
                x2={760}
                y2={232}
                stroke="#222c40"
                strokeWidth="6.5"
              />
            </g>

            {/* 중심 핀 반경 가이드 서클 */}
            <circle
              cx="320"
              cy="160"
              r="38"
              fill={accentHex}
              fillOpacity="0.06"
              stroke={accentHex}
              strokeOpacity="0.24"
              strokeWidth="1"
            />
            <circle
              cx="320"
              cy="160"
              r="14"
              fill={accentHex}
              fillOpacity="0.11"
            />

            {/* 핀 접지 그림자 */}
            <ellipse cx="320" cy="163" rx="8.5" ry="3.2" fill="rgba(0, 0, 0, 0.62)" />

            {/* 구글 지도 스타일 조각 티어드롭 핀 마커 */}
            <g transform="translate(320, 160)">
              <path
                d="M 0 0 C -2 -7 -13 -16.5 -13 -25.5 C -13 -32.9 -7.2 -38.8 0 -38.8 C 7.2 -38.8 13 -32.9 13 -25.5 C 13 -16.5 2 -7 0 0 Z"
                fill="#e5484d"
                stroke="#ffffff"
                strokeOpacity="0.88"
                strokeWidth="1.4"
              />
              <circle cx="0" cy="-25.8" r="4.8" fill="#4c0d11" />
              <circle cx="0" cy="-25.8" r="2.3" fill="#ffffff" fillOpacity="0.92" />
            </g>
          </svg>
        </div>

        {/* 상단 비네팅 스크림 (오버레이 가독성 확보) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/55 to-transparent"
        />

        {/* 좌측 상단: 핀 장소명 플로팅 콜아웃 */}
        <div className="pointer-events-none absolute top-2.5 left-2.5 right-28 flex items-start">
          <div className="px-2.5 py-1.5 rounded-lg bg-[#0e121b]/90 backdrop-blur-xs border border-white/[0.10] shadow-lg min-w-0 max-w-full">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${accentDotClass}`} />
              <span className="text-[11px] font-semibold text-neutral-100 truncate">
                {event.location || event.locationAddress || '지정 위치'}
              </span>
            </div>
            <p className="text-[10px] font-mono tabular-nums text-neutral-400 truncate mt-0.5">
              {exactCoords
                ? event.isSample
                  ? `${formatCoordinatePairPlain(displayLat, displayLng)} · 샘플 가상 좌표`
                  : `${formatCoordinatePairPlain(displayLat, displayLng)} · WGS84`
                : `${regionalAnchor.regionLabel} · 정밀 좌표 미입력`}
            </p>
          </div>
        </div>

        {/* 우측 상단: 외부 Google 지도 실행 링크 */}
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2.5 right-2.5 h-7 px-2.5 rounded-lg bg-[#111520]/92 hover:bg-[#192030] border border-white/[0.12] hover:border-white/[0.24] text-[11px] font-medium text-neutral-100 inline-flex items-center gap-1 shadow-lg transition-colors whitespace-nowrap shrink-0"
          title="Google 지도에서 해당 위치 열기"
        >
          <span>Google 지도</span>
          <ExternalLink className="w-3 h-3 text-neutral-300 shrink-0" />
        </a>

        {/* 좌측 하단: 축척(Scale) 표시 바 */}
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 px-2 py-1 rounded-md bg-[#0e121b]/85 border border-white/[0.08] flex items-center gap-2">
          <span className="text-[10px] font-mono tabular-nums text-neutral-300">
            {ZOOM_SCALE_METERS[zoom] || '100m'}
          </span>
          <div className="w-10 h-1.5 border-b border-l border-r border-neutral-300/80" />
          <span className="text-[9.5px] font-mono tabular-nums text-neutral-500">
            Z{zoom}
          </span>
        </div>

        {/* 우측 하단: 구글 지도 스타일 줌(+/-) & 중심 복귀 컨트롤 */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
          {isOffsetFromCenter && (
            <button
              type="button"
              onClick={handleResetView}
              className="w-7 h-7 rounded-lg bg-[#111520]/92 hover:bg-[#1a2030] border border-white/[0.12] text-neutral-200 hover:text-white flex items-center justify-center shadow-lg transition-colors cursor-pointer"
              title="핀 중심으로 화면 정렬"
              aria-label="핀 중심으로 화면 정렬"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="flex flex-col rounded-lg bg-[#111520]/92 border border-white/[0.12] divide-y divide-white/[0.09] shadow-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(18, z + 1))}
              disabled={zoom >= 18}
              className="w-7 h-6 hover:bg-white/[0.08] disabled:opacity-35 text-neutral-200 flex items-center justify-center transition-colors cursor-pointer"
              title="지도 확대"
              aria-label="지도 확대"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(14, z - 1))}
              disabled={zoom <= 14}
              className="w-7 h-6 hover:bg-white/[0.08] disabled:opacity-35 text-neutral-200 flex items-center justify-center transition-colors cursor-pointer"
              title="지도 축소"
              aria-label="지도 축소"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 자동 보완 안내 배너 (발생 시) */}
      {autoResolveNotice && (
        <div className="px-3.5 py-2 border-b border-white/[0.06] bg-white/[0.02] text-[11px] text-neutral-300">
          {autoResolveNotice}
        </div>
      )}

      {/* 하단 구조화 명세 테이블: [1] 공식 장소명 / [2] 상세 주소 (별도 출력) / [3] 위도·경도 (별도 2열 출력) */}
      <div className="divide-y divide-white/[0.06] select-text">
        {/* 1. 공식 장소명 */}
        <div className="px-3.5 py-2.5 space-y-0.5">
          <span className="block text-[10.5px] font-medium text-neutral-500">
            공식 장소명
          </span>
          <p className="text-xs sm:text-[13px] font-semibold text-neutral-100 leading-snug break-words">
            {event.location || '장소명 미기재'}
          </p>
        </div>

        {/* 2. 상세 주소 (별도 전용 행) */}
        <div className="px-3.5 py-2.5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-medium text-neutral-500">
              상세 주소
            </span>

            {(event.locationAddress || event.location) && (
              <button
                type="button"
                onClick={handleCopyAddress}
                className="h-5 px-1.5 rounded bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] text-[10px] text-neutral-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 select-none"
                title="상세 주소 복사"
              >
                {copiedTarget === 'address' ? (
                  <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-2.5 h-2.5 shrink-0" />
                )}
                <span>{copiedTarget === 'address' ? '복사됨' : '주소 복사'}</span>
              </button>
            )}
          </div>

          {event.locationAddress ? (
            <p className="text-xs text-neutral-200 leading-relaxed break-words">
              {event.locationAddress}
            </p>
          ) : (
            <p className="text-xs text-neutral-500 leading-relaxed">
              상세 도로명·지번 주소 미입력
            </p>
          )}
        </div>

        {/* 3. 위도 · 경도 (별도 2열 고정폭 수치 출력) */}
        <div className="bg-[#121620]/70">
          <div className="px-3.5 py-2 border-b border-white/[0.05] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <span className="text-[10.5px] font-medium text-neutral-400 shrink-0">
                위도 · 경도
              </span>
              {exactCoords && (
                <>
                  <span aria-hidden="true" className="text-neutral-600 shrink-0">
                    ·
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-neutral-500 truncate">
                    {formatCoordinateDMS(event.locationLat!, event.locationLng!)}
                  </span>
                </>
              )}
            </div>

            {exactCoords ? (
              <button
                type="button"
                onClick={handleCopyCoordinates}
                className="h-5 px-1.5 rounded bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] text-[10px] text-neutral-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 select-none"
                title="위도, 경도 좌표 복사"
              >
                {copiedTarget === 'coords' ? (
                  <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-2.5 h-2.5 shrink-0" />
                )}
                <span>{copiedTarget === 'coords' ? '복사됨' : '좌표 복사'}</span>
              </button>
            ) : onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="text-[10.5px] text-neutral-400 hover:text-neutral-200 underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0 select-none"
              >
                위경도 입력
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
            <div className="px-3.5 py-2.5 space-y-0.5 min-w-0">
              <span className="block text-[10px] font-mono text-neutral-500">
                위도 (Latitude)
              </span>
              {exactCoords ? (
                <p className="text-xs sm:text-[13px] font-mono tabular-nums font-medium text-neutral-100 truncate">
                  {formatLatitudeDecimal(event.locationLat!)}
                </p>
              ) : (
                <p className="text-xs font-mono tabular-nums text-neutral-500 truncate">
                  미입력
                </p>
              )}
            </div>

            <div className="px-3.5 py-2.5 space-y-0.5 min-w-0">
              <span className="block text-[10px] font-mono text-neutral-500">
                경도 (Longitude)
              </span>
              {exactCoords ? (
                <p className="text-xs sm:text-[13px] font-mono tabular-nums font-medium text-neutral-100 truncate">
                  {formatLongitudeDecimal(event.locationLng!)}
                </p>
              ) : (
                <p className="text-xs font-mono tabular-nums text-neutral-500 truncate">
                  미입력
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
