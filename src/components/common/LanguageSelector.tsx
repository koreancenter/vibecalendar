import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { SUPPORTED_LANGUAGES, SupportedLanguageCode } from '../../i18n';
import { TopBarTooltip } from './TopBarTooltip';

export const LanguageSelector: React.FC = () => {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLang = (i18n.language?.slice(0, 2) || 'ko') as SupportedLanguageCode;
  const currentLangObj =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentLang) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectLanguage = (code: SupportedLanguageCode) => {
    i18n.changeLanguage(code);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <TopBarTooltip label={t('common.language', '언어 변경')} align="right">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label={t('common.language', '언어')}
          aria-expanded={isOpen}
          className="h-7 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.16] text-neutral-300 hover:text-white flex items-center gap-1.5 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 text-xs font-mono font-medium"
        >
          <Globe className="w-3.5 h-3.5 text-neutral-400" strokeWidth={1.75} />
          <span>{currentLangObj.shortLabel}</span>
        </button>
      </TopBarTooltip>

      {isOpen && (
        <div
          role="menu"
          aria-label={t('common.language', '언어 선택')}
          className="absolute right-0 top-full mt-1.5 z-[100] w-36 rounded-xl bg-[#141720]/95 backdrop-blur-xl border border-white/[0.12] shadow-2xl py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-400 border-b border-white/[0.06] uppercase tracking-wider">
            {t('common.language', '언어 / Language')}
          </div>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = currentLang === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="menuitem"
                onClick={() => handleSelectLanguage(lang.code)}
                className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'text-white bg-white/[0.08] font-medium'
                    : 'text-neutral-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-neutral-400 w-4 font-semibold">
                    {lang.shortLabel}
                  </span>
                  <span>{lang.label}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
