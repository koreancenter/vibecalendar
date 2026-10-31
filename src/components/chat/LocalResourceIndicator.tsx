import React, { useId } from 'react';
import {
  HardwareTelemetrySnapshot,
  MetricLoadTone,
} from '../../hooks/useLocalHardwareMetrics';

function getToneStrokeColor(tone: MetricLoadTone): string {
  switch (tone) {
    case 'critical':
      return '#fb7185';
    case 'elevated':
      return '#fbbf24';
    case 'muted':
      return 'rgba(148, 163, 184, 0.35)';
    default:
      return '#e2e8f0';
  }
}

function getToneTextClass(tone: MetricLoadTone): string {
  switch (tone) {
    case 'critical':
      return 'text-rose-300';
    case 'elevated':
      return 'text-amber-200';
    case 'muted':
      return 'text-neutral-500';
    default:
      return 'text-neutral-200';
  }
}

interface MicroLinearMeterProps {
  percent: number;
  previewPercent?: number | null;
  tone: MetricLoadTone;
  width?: number;
}

const MicroLinearMeter: React.FC<MicroLinearMeterProps> = ({
  percent,
  previewPercent = null,
  tone,
  width = 24,
}) => {
  const gradId = useId();
  const clampedActive = Math.max(0, Math.min(100, percent));
  const clampedPreview =
    previewPercent !== null ? Math.max(0, Math.min(100, previewPercent)) : 0;

  const activeW = Math.round((clampedActive / 100) * width * 10) / 10;
  const previewW = Math.round((clampedPreview / 100) * width * 10) / 10;
  const primaryColor = getToneStrokeColor(tone);

  return (
    <svg
      width={width}
      height={4}
      viewBox={`0 0 ${width} 4`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={primaryColor} stopOpacity="0.65" />
          <stop offset="100%" stopColor={primaryColor} stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* 베이스 트랙 */}
      <rect
        x={0}
        y={1}
        width={width}
        height={2}
        rx={1}
        fill="rgba(255, 255, 255, 0.09)"
      />

      {/* 대기 상태 예상 점유량 고스트 트랙 */}
      {previewW > activeW && (
        <rect
          x={0}
          y={1}
          width={previewW}
          height={2}
          rx={1}
          fill="rgba(255, 255, 255, 0.22)"
        />
      )}

      {/* 실측 할당 게이지 */}
      {activeW > 0 && (
        <rect
          x={0}
          y={1}
          width={Math.max(1.5, activeW)}
          height={2}
          rx={1}
          fill={`url(#${gradId})`}
        />
      )}
    </svg>
  );
};

interface SegmentedHorologicalBarProps {
  percent: number;
  previewPercent: number | null;
  tone: MetricLoadTone;
}

const SEGMENT_COUNT = 20;

const SegmentedHorologicalBar: React.FC<SegmentedHorologicalBarProps> = ({
  percent,
  previewPercent,
  tone,
}) => {
  const activeSegments =
    percent > 0 ? Math.max(1, Math.round((Math.min(100, percent) / 100) * SEGMENT_COUNT)) : 0;
  const previewSegments =
    previewPercent !== null && previewPercent > 0
      ? Math.max(1, Math.round((Math.min(100, previewPercent) / 100) * SEGMENT_COUNT))
      : 0;

  const activeFill = getToneStrokeColor(tone);
  const segWidth = 4.4;
  const gap = 1.55;
  const totalWidth = SEGMENT_COUNT * segWidth + (SEGMENT_COUNT - 1) * gap;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} 6`}
      className="w-full h-[6px] block"
      aria-hidden="true"
    >
      {Array.from({ length: SEGMENT_COUNT }).map((_, idx) => {
        const x = idx * (segWidth + gap);
        const isActive = idx < activeSegments;
        const isPreview = !isActive && idx < previewSegments;

        let fill = 'rgba(255, 255, 255, 0.075)';
        if (isActive) {
          fill = activeFill;
        } else if (isPreview) {
          fill = 'rgba(226, 232, 240, 0.24)';
        }

        return (
          <rect
            key={idx}
            x={x}
            y={0.5}
            width={segWidth}
            height={5}
            rx={0.9}
            fill={fill}
          />
        );
      })}
    </svg>
  );
};

interface CpuSparklineProps {
  history: number[];
  isOffline: boolean;
  tone: MetricLoadTone;
}

const CpuSparkline: React.FC<CpuSparklineProps> = ({ history, isOffline, tone }) => {
  const fillGradId = useId();
  const width = 120;
  const height = 18;
  const padY = 2;

  const safePoints = history.length >= 2 ? history : [4, 4];
  const stepX = width / Math.max(1, safePoints.length - 1);

  const coords = safePoints.map((val, i) => {
    const normalized = isOffline ? 0 : Math.max(0, Math.min(100, val)) / 100;
    const x = Math.round(i * stepX * 10) / 10;
    const y =
      Math.round((height - padY - normalized * (height - padY * 2)) * 10) / 10;
    return { x, y };
  });

  const linePath = coords
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
    .join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const strokeColor = getToneStrokeColor(isOffline ? 'muted' : tone);
  const lastCoord = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[18px] block" aria-hidden="true">
      <defs>
        <linearGradient id={fillGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={isOffline ? '0.03' : '0.22'} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 미세 기준선 */}
      <line
        x1={0}
        y1={height - 1}
        x2={width}
        y2={height - 1}
        stroke="rgba(255, 255, 255, 0.06)"
        strokeWidth={0.75}
      />
      <line
        x1={0}
        y1={Math.round(height / 2)}
        x2={width}
        y2={Math.round(height / 2)}
        stroke="rgba(255, 255, 255, 0.04)"
        strokeDasharray="2 2"
        strokeWidth={0.75}
      />

      {!isOffline && <path d={areaPath} fill={`url(#${fillGradId})`} />}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!isOffline && lastCoord && (
        <circle cx={lastCoord.x} cy={lastCoord.y} r={1.6} fill={strokeColor} />
      )}
    </svg>
  );
};

interface LocalResourceInlineIndicatorProps {
  telemetry: HardwareTelemetrySnapshot;
  onClick?: () => void;
  hidden?: boolean;
}

/**
 * 프롬프트 하단 액션 바 내 모델 선택기 우측 빈 공간에 배치되는 인라인 럭셔리 리소스 인디케이터
 */
export const LocalResourceInlineIndicator: React.FC<LocalResourceInlineIndicatorProps> = ({
  telemetry,
  onClick,
  hidden = false,
}) => {
  const isOffline =
    telemetry.connectionState === 'offline' || telemetry.connectionState === 'unsupported';

  const tooltip = `${telemetry.engineLabel} (${telemetry.stateLabel}) · VRAM ${telemetry.vram.displayValue} (${telemetry.vram.subLabel}) · CPU ${telemetry.cpu.displayValue}`;

  return (
    <div
      className={`flex items-center min-w-0 transition-opacity duration-150 ${
        hidden ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <span aria-hidden="true" className="w-px h-3 bg-white/[0.08] mx-1 shrink-0" />

      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        className="group h-7 px-2 rounded-lg hover:bg-white/[0.05] active:bg-white/[0.08] transition-colors duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap min-w-0"
      >
        {/* VRAM 미터 */}
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-medium tracking-tight text-neutral-500 group-hover:text-neutral-400 transition-colors">
            VRAM
          </span>
          <span className="hidden sm:inline-flex items-center">
            <MicroLinearMeter
              percent={telemetry.vram.percent}
              previewPercent={telemetry.vram.previewPercent}
              tone={telemetry.vram.tone}
              width={22}
            />
          </span>
          <span
            className={`text-[11px] font-mono tabular-nums tracking-tight ${getToneTextClass(
              telemetry.vram.tone
            )}`}
          >
            {telemetry.vram.compactValue}
          </span>
        </span>

        <span aria-hidden="true" className="text-[10px] text-neutral-600 shrink-0">
          ·
        </span>

        {/* CPU 미터 */}
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-medium tracking-tight text-neutral-500 group-hover:text-neutral-400 transition-colors">
            CPU
          </span>
          <span className="hidden lg:inline-flex items-center">
            <MicroLinearMeter
              percent={telemetry.cpu.percent ?? 0}
              tone={isOffline ? 'muted' : telemetry.cpu.tone}
              width={18}
            />
          </span>
          <span
            className={`text-[11px] font-mono tabular-nums tracking-tight ${getToneTextClass(
              isOffline ? 'muted' : telemetry.cpu.tone
            )}`}
          >
            {telemetry.cpu.displayValue}
          </span>
        </span>
      </button>
    </div>
  );
};

interface LocalResourceTelemetryPanelProps {
  telemetry: HardwareTelemetrySnapshot;
  onUnloadWebLlm?: () => void;
}

/**
 * 모델 선택 팝오버 우측 빈 공간(Ollama · WebLLM 탭)에 렌더링되는 고정밀 하드웨어 텔레메트리 인스트루먼트
 */
export const LocalResourceTelemetryPanel: React.FC<LocalResourceTelemetryPanelProps> = ({
  telemetry,
  onUnloadWebLlm,
}) => {
  const isOffline =
    telemetry.connectionState === 'offline' || telemetry.connectionState === 'unsupported';

  return (
    <div className="w-[134px] lg:w-[148px] shrink-0 pl-3 pr-2 py-1.5 border-l border-white/[0.07] flex flex-col justify-between select-none">
      {/* 상단 엔진 식별자 및 상태 */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-medium text-neutral-400 tracking-tight truncate">
          {telemetry.engineLabel}
        </span>
        <span
          className={`text-[10px] font-mono tabular-nums shrink-0 ${
            telemetry.connectionState === 'active'
              ? 'text-neutral-200'
              : telemetry.connectionState === 'loading'
              ? 'text-amber-200/90'
              : 'text-neutral-500'
          }`}
        >
          {telemetry.stateLabel}
        </span>
      </div>

      {/* VRAM 섹션 */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[10px] font-medium text-neutral-400/90 tracking-tight">
            VRAM
          </span>
          <span
            className={`text-[11px] font-mono tabular-nums font-medium ${getToneTextClass(
              telemetry.vram.tone
            )}`}
          >
            {telemetry.vram.displayValue}
          </span>
        </div>

        <SegmentedHorologicalBar
          percent={telemetry.vram.percent}
          previewPercent={telemetry.vram.previewPercent}
          tone={telemetry.vram.tone}
        />

        <div className="flex items-center justify-between gap-1 min-h-[14px]">
          <span
            className="text-[10px] text-neutral-500 truncate tabular-nums"
            title={telemetry.vram.subLabel}
          >
            {telemetry.vram.subLabel}
          </span>
          {telemetry.canUnloadWebLlm && onUnloadWebLlm && (
            <button
              type="button"
              onClick={onUnloadWebLlm}
              className="text-[10px] text-neutral-400 hover:text-white underline underline-offset-2 decoration-white/25 hover:decoration-white/70 transition-colors cursor-pointer shrink-0"
              title="GPU 메모리에서 적재된 WebLLM 모델 해제"
            >
              비우기
            </button>
          )}
        </div>
      </div>

      {/* 중앙 헤어라인 디바이더 */}
      <div className="h-px bg-gradient-to-r from-white/[0.09] via-white/[0.04] to-transparent" />

      {/* CPU 섹션 */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[10px] font-medium text-neutral-400/90 tracking-tight">
            CPU
          </span>
          <span
            className={`text-[11px] font-mono tabular-nums font-medium ${getToneTextClass(
              isOffline ? 'muted' : telemetry.cpu.tone
            )}`}
          >
            {telemetry.cpu.displayValue}
          </span>
        </div>

        <CpuSparkline
          history={telemetry.cpu.history}
          isOffline={isOffline}
          tone={telemetry.cpu.tone}
        />

        <div
          className="text-[10px] text-neutral-500 truncate tabular-nums"
          title={telemetry.cpu.subLabel}
        >
          {telemetry.cpu.subLabel}
        </div>
      </div>
    </div>
  );
};
