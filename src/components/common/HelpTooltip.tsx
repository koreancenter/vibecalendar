import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpTooltipProps {
  content: React.ReactNode;
  title?: string;
  align?: 'left' | 'center' | 'right';
  placement?: 'top' | 'bottom';
  className?: string;
}

/**
 * 모달 및 폼 공용 정밀 도움말 툴팁 (물음표 아이콘)
 * - 장황한 설명 텍스트를 대체하여 모달 레이아웃을 깔끔하게 유지
 * - 호버 및 포커스, 모바일 터치(토글)를 모두 지원
 * - z-[85] 레이어로 모달 및 폼 내부에서 잘림 방지
 */
export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  content,
  title,
  align = 'center',
  placement = 'top',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const alignmentClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  const placementClass =
    placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2';

  return (
    <div
      className={`relative inline-flex items-center align-middle group/help ${className}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-label={title || '도움말 확인'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        className="w-4 h-4 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-help shrink-0 outline-hidden"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={`absolute ${placementClass} ${alignmentClass} z-[85] transition-all duration-150 ease-out`}
        >
          <div className="luxury-glass-border relative max-w-xs sm:max-w-sm w-max p-2.5 rounded-xl bg-gradient-to-b from-[#181c27]/96 via-[#11141d]/95 to-[#0c0e15]/98 backdrop-blur-xl shadow-[0_16px_36px_-6px_rgba(0,0,0,0.85),0_4px_12px_-2px_rgba(0,0,0,0.5)] border border-white/[0.12] text-xs text-neutral-200 select-text leading-relaxed">
            {title && (
              <div className="font-semibold text-white mb-1 tracking-tight text-[11px] pb-1 border-b border-white/[0.06]">
                {title}
              </div>
            )}
            <div className="text-[11px] text-neutral-300 font-normal leading-normal whitespace-normal">
              {content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
