import React from 'react';

interface TopBarTooltipProps {
  label: string;
  shortcut?: string;
  align?: 'left' | 'center' | 'right';
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * 상단 타이틀 바 전용 미니멀 프로스티드 글래스 호버 툴팁
 * - 헤더 하단(top-full)으로 펼쳐져 상단 뷰포트 잘림 원천 방지
 * - 드롭다운 팝오버가 열려 있을 때(disabled=true) 즉시 숨김 처리해 중첩 차단
 */
export const TopBarTooltip: React.FC<TopBarTooltipProps> = ({
  label,
  shortcut,
  align = 'center',
  disabled = false,
  children,
}) => {
  const alignmentClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  return (
    <div className="relative inline-flex items-center group/tip">
      {children}
      {!disabled && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute top-full mt-2 ${alignmentClass} z-[60] opacity-0 -translate-y-0.5 group-hover/tip:opacity-100 group-hover/tip:translate-y-0 transition-all duration-150 ease-out whitespace-nowrap`}
        >
          <div className="luxury-glass-border relative px-2.5 py-1 rounded-lg bg-gradient-to-b from-[#181c27]/92 via-[#11141d]/90 to-[#0c0e15]/95 backdrop-blur-xl backdrop-saturate-150 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.78),0_4px_12px_-2px_rgba(0,0,0,0.5)] flex items-center gap-1.5 text-[11px] leading-none text-neutral-100">
            <span className="tracking-tight">{label}</span>
            {shortcut && (
              <span className="font-mono text-[10px] text-neutral-400 tabular-nums">
                {shortcut}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
