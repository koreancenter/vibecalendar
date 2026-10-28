import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Building2, Check, Hash, FileText, Send, ClipboardPaste } from 'lucide-react';
import { ProjectItem, ProjectStatus } from '../types';
import { LUXURY_PROJECT_COLORS, PROJECT_STATUS_MAP } from '../constants/projects';
import { parseProjectPrompt, generateProjectCode } from '../utils/projectAiParser';
import { getTodayDateString, parseLocalDate, formatDateString } from '../shared/dateUtils';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (projectData: Omit<ProjectItem, 'id' | 'createdAt'>) => void;
  initialProject?: ProjectItem | null;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialProject,
}) => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiApplied, setIsAiApplied] = useState(false);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isCodeManuallySet, setIsCodeManuallySet] = useState(false);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(LUXURY_PROJECT_COLORS[0].hex);
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [clientOrOrg, setClientOrOrg] = useState('');

  useEffect(() => {
    if (initialProject) {
      setName(initialProject.name || '');
      setCode(initialProject.code || '');
      setIsCodeManuallySet(true);
      setDescription(initialProject.description || '');
      setColor(initialProject.color || LUXURY_PROJECT_COLORS[0].hex);
      setStatus(initialProject.status || 'active');
      setStartDate(initialProject.startDate || '');
      setEndDate(initialProject.endDate || '');
      setClientOrOrg(initialProject.clientOrOrg || '');
    } else {
      setName('');
      setCode('');
      setIsCodeManuallySet(false);
      setDescription('');
      setColor(LUXURY_PROJECT_COLORS[0].hex);
      setStatus('active');
      setStartDate(getTodayDateString());
      setEndDate('');
      setClientOrOrg('');
    }
    setAiPrompt('');
    setIsAiApplied(false);
  }, [initialProject, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // AI 자연어 한 줄 분석 실행
  const handleRunAiParse = (textToParse?: string) => {
    const query = textToParse || aiPrompt;
    if (!query.trim()) return;

    const parsed = parseProjectPrompt(query);
    if (parsed.name) setName(parsed.name);
    if (parsed.code) {
      setCode(parsed.code);
      setIsCodeManuallySet(true);
    }
    if (parsed.clientOrOrg) setClientOrOrg(parsed.clientOrOrg);
    if (parsed.startDate) setStartDate(parsed.startDate);
    if (parsed.endDate) setEndDate(parsed.endDate);
    if (parsed.status) setStatus(parsed.status);

    setIsAiApplied(true);
    setTimeout(() => setIsAiApplied(false), 2000);
  };

  // 프로젝트명 입력 시 식별 코드 자동 추천
  const handleNameChange = (val: string) => {
    setName(val);
    if (!isCodeManuallySet) {
      const suggested = generateProjectCode(val);
      setCode(suggested);
    }
  };

  // 빠른 마감일 프리셋 핸들러 (로컬 타임존 안전 계산)
  const handleApplyPreset = (monthsToAdd: number | 'year-end') => {
    const base = startDate ? parseLocalDate(startDate) : new Date();
    if (monthsToAdd === 'year-end') {
      const year = base.getFullYear();
      setEndDate(`${year}-12-31`);
    } else {
      const target = new Date(base);
      target.setMonth(target.getMonth() + monthsToAdd);
      setEndDate(formatDateString(target));
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      code: code.trim().toUpperCase() || undefined,
      description: description.trim() || undefined,
      color,
      status,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      clientOrOrg: clientOrOrg.trim() || undefined,
    });
    onClose();
  };

  const currentColorObj = LUXURY_PROJECT_COLORS.find((c) => c.hex === color) || LUXURY_PROJECT_COLORS[0];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#0e1017] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
      >
        {/* 1. 모달 상단 헤더 */}
        <div className="h-14 px-6 border-b border-white/[0.06] flex items-center justify-between bg-[#11131b] shrink-0">
          <h3 className="text-sm font-semibold text-white tracking-tight">
            {initialProject ? '프로젝트 정보 수정' : '새 프로젝트 등록'}
          </h3>
        </div>

        {/* 2. 입력 폼 본문 */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* AI 자연어 한 줄 스마트 등록 (클린 단일 필드 & 와이드 인풋) */}
          {!initialProject && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-neutral-300">
                  <span>AI 한 줄 자연어 · 클립보드 등록</span>
                </label>
                {isAiApplied ? (
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    자동 추출 완료
                  </span>
                ) : pasteHint ? (
                  <span className="text-[10px] text-neutral-400">{pasteHint}</span>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  ref={aiInputRef}
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData?.getData('text/plain');
                    if (pasted && pasted.trim()) {
                      e.preventDefault();
                      const normalized = pasted.replace(/\s+/g, ' ').trim();
                      setAiPrompt(normalized);
                      handleRunAiParse(normalized);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRunAiParse();
                    }
                  }}
                  placeholder="예: 2026 하반기 차세대 R&D 협약 10/1~11/30 (파트너: 루미에르 미래기술원)"
                  className="flex-1 bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-white/[0.22] rounded-xl px-3.5 py-2.5 text-white placeholder-neutral-500 text-xs transition-colors outline-hidden"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const clipText = await navigator.clipboard.readText();
                      if (clipText.trim()) {
                        const normalized = clipText.replace(/\s+/g, ' ').trim();
                        setAiPrompt(normalized);
                        handleRunAiParse(normalized);
                      } else {
                        aiInputRef.current?.focus();
                        setPasteHint('클립보드가 비어 있습니다');
                        setTimeout(() => setPasteHint(null), 2200);
                      }
                    } catch {
                      aiInputRef.current?.focus();
                      setPasteHint('입력창에 Ctrl+V(⌘V)로 붙여넣으세요');
                      setTimeout(() => setPasteHint(null), 2500);
                    }
                  }}
                  className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-neutral-300 hover:text-white border border-white/[0.08] transition-all cursor-pointer flex items-center justify-center shrink-0"
                  title="클립보드 텍스트 붙여넣기 및 즉시 추출"
                >
                  <ClipboardPaste className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRunAiParse()}
                  disabled={!aiPrompt.trim()}
                  className="p-2.5 rounded-xl bg-white text-neutral-950 hover:bg-neutral-200 transition-all disabled:opacity-30 cursor-pointer flex items-center justify-center shrink-0"
                  title="자연어 일정 정보 자동 추출"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* 프로젝트명 (필수) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-300 flex items-center justify-between">
              <span>프로젝트명</span>
              <span className="text-[10px] text-neutral-500 font-mono">REQUIRED</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="예: 2026 하반기 글로벌 파트너스 살롱"
              className={`w-full bg-[#13151f] border hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl px-3.5 py-2.5 text-white placeholder-neutral-500 text-xs transition-all outline-hidden font-medium ${
                isAiApplied ? 'border-indigo-400/70 ring-1 ring-indigo-400/30' : 'border-white/[0.08]'
              }`}
            />
          </div>

          {/* 식별 코드 & 상태 (2열 그리드) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5">
                  <Hash className="w-3 h-3 text-neutral-400" />
                  <span>식별 코드 (단축명)</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const c = generateProjectCode(name);
                    if (c) {
                      setCode(c);
                      setIsCodeManuallySet(true);
                    }
                  }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono cursor-pointer"
                >
                  자동 제안
                </button>
              </div>
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setIsCodeManuallySet(true);
                }}
                maxLength={8}
                placeholder="예: VIP-NET, Q4-DEV"
                className="w-full bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl px-3.5 py-2.5 text-white placeholder-neutral-500 font-mono uppercase text-xs transition-colors outline-hidden"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-neutral-300">
                진행 상태
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className="w-full bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl px-3.5 py-2.5 text-white text-xs transition-colors outline-hidden cursor-pointer"
              >
                {Object.entries(PROJECT_STATUS_MAP).map(([key, val]) => (
                  <option key={key} value={key} className="bg-[#13151f] text-white">
                    {val.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 파트너사 / 조직 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5">
              <Building2 className="w-3 h-3 text-neutral-400" />
              <span>파트너사 / 조직 / 고객사</span>
            </label>
            <input
              type="text"
              value={clientOrOrg}
              onChange={(e) => setClientOrOrg(e.target.value)}
              placeholder="예: 산학협력단, 프라이빗 파트너십"
              className="w-full bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl px-3.5 py-2.5 text-white placeholder-neutral-500 text-xs transition-colors outline-hidden"
            />
          </div>

          {/* 일정 기간 (시작일 ~ 종료일) & 퀵 프리셋 */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 text-neutral-400" />
                  <span>시작일</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl px-3.5 py-2 text-white text-xs font-mono transition-colors outline-hidden cursor-pointer"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 text-neutral-400" />
                  <span>목표 마감일</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl px-3.5 py-2 text-white text-xs font-mono transition-colors outline-hidden cursor-pointer"
                />
              </div>
            </div>

            {/* 마감일 퀵 프리셋 버튼 */}
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] text-neutral-500 mr-1">마감 프리셋:</span>
              <button
                type="button"
                onClick={() => handleApplyPreset(1)}
                className="px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-neutral-300 border border-white/[0.06] transition-colors cursor-pointer font-mono"
              >
                +1개월
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset(3)}
                className="px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-neutral-300 border border-white/[0.06] transition-colors cursor-pointer font-mono"
              >
                +3개월
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('year-end')}
                className="px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-neutral-300 border border-white/[0.06] transition-colors cursor-pointer font-mono"
              >
                올해 말 마감
              </button>
            </div>
          </div>

          {/* 3. 시그니처 럭셔리 컬러 테마 */}
          <div className="space-y-2 pt-1">
            <label className="text-[11px] font-medium text-neutral-300 flex items-center justify-between">
              <span>시그니처 컬러 테마</span>
              <span className="text-[10px] text-neutral-400 font-mono tracking-tight">
                {currentColorObj.name}
              </span>
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {LUXURY_PROJECT_COLORS.map((col) => {
                const isSelected = color === col.hex;
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => setColor(col.hex)}
                    className={`h-7.5 rounded-lg flex items-center justify-center transition-all cursor-pointer relative ${
                      isSelected
                        ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-[#0e1017] scale-105'
                        : 'opacity-70 hover:opacity-100 hover:scale-102'
                    }`}
                    style={{ backgroundColor: col.hex }}
                    title={col.name}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-black drop-shadow-xs" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. 프로젝트 개요 & 메모 */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-neutral-400" />
              <span>프로젝트 개요 및 주요 목표</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="프로젝트의 주요 목표, 산출물 또는 협력 사항을 메모하세요..."
              className="w-full bg-[#13151f] border border-white/[0.08] hover:border-white/[0.14] focus:border-indigo-400/50 rounded-xl p-3 text-white placeholder-neutral-500 text-xs transition-colors resize-none outline-hidden leading-relaxed"
            />
          </div>

          {/* 5. 하단 버튼 바 */}
          <div className="pt-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] text-xs font-medium transition-colors cursor-pointer"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-1.5 rounded-lg bg-white text-neutral-900 hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
            >
              <span>{initialProject ? '수정 사항 저장' : '프로젝트 등록'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
