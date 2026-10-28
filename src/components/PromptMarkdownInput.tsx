import React, {
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import {
  Plus,
  Paperclip,
  ClipboardPaste,
  Camera,
  Mic,
  Globe,
  ArrowUp,
  Loader2,
  X,
  ArrowDownToLine,
} from 'lucide-react';
import { AiModelSelection, PromptAttachmentItem } from '../types';
import {
  UNIVERSAL_FILE_ACCEPT,
  MAX_ATTACHMENTS,
  processFilesForAttachment,
  classifySmartPastedText,
  readSystemClipboard,
} from '../utils/attachmentProcessor';
import { DEFAULT_AI_MODEL_SELECTION } from '../services/agentApi';
import { WebLlmLoadProgress } from '../services/webllmProvider';
import { AttachmentKindIcon } from './chat/AttachmentPreviewModal';
import { ModelSelectorPopover } from './chat/ModelSelectorPopover';

export interface PromptMarkdownInputRef {
  focus: () => void;
  clear: () => void;
  setText: (text: string) => void;
  getText: () => string;
  openFilePicker: () => void;
}

interface PromptMarkdownInputProps {
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  onSend: (text: string) => void;
  onTextChange?: (text: string) => void;
  externalText?: string;
  attachments?: PromptAttachmentItem[];
  onAddAttachments?: (items: PromptAttachmentItem[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onClearAttachments?: () => void;
  onPreviewAttachment?: (item: PromptAttachmentItem) => void;
  onExpandAttachmentToText?: (item: PromptAttachmentItem) => void;
  onOpenCamera?: () => void;
  onOpenSnippetModal?: () => void;
  onOpenDateDiscovery?: () => void;
  isListening?: boolean;
  onToggleVoice?: () => void;
  modelSelection?: AiModelSelection;
  onChangeModelSelection?: (next: AiModelSelection) => void;
  webllmProgress?: WebLlmLoadProgress | null;
  onWebLlmProgress?: (progress: WebLlmLoadProgress | null) => void;
  showToast?: (msg: string) => void;
}

export const PromptMarkdownInput = forwardRef<PromptMarkdownInputRef, PromptMarkdownInputProps>(
  (
    {
      placeholder = '일정을 등록하거나 장소를 추천받아 보세요...',
      disabled = false,
      loading = false,
      onSend,
      onTextChange,
      externalText = '',
      attachments = [],
      onAddAttachments,
      onRemoveAttachment,
      onPreviewAttachment,
      onExpandAttachmentToText,
      onOpenCamera,
      onOpenSnippetModal,
      onOpenDateDiscovery,
      isListening = false,
      onToggleVoice,
      modelSelection = DEFAULT_AI_MODEL_SELECTION,
      onChangeModelSelection,
      webllmProgress = null,
      onWebLlmProgress,
      showToast,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const universalInputRef = useRef<HTMLInputElement>(null);
    const menuContainerRef = useRef<HTMLDivElement>(null);
    const isComposingRef = useRef(false);

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isProcessingFiles, setIsProcessingFiles] = useState(false);

    const adjustHeight = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      const nextHeight = Math.min(168, Math.max(42, el.scrollHeight));
      el.style.height = `${nextHeight}px`;
    }, []);

    useEffect(() => {
      adjustHeight();
    }, [externalText, adjustHeight]);

    useEffect(() => {
      if (!isMenuOpen) return;
      const handleOutsideClick = (e: MouseEvent) => {
        if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
          setIsMenuOpen(false);
        }
      };
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setIsMenuOpen(false);
      };
      document.addEventListener('mousedown', handleOutsideClick);
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.removeEventListener('mousedown', handleOutsideClick);
        window.removeEventListener('keydown', handleEsc);
      };
    }, [isMenuOpen]);

    useImperativeHandle(ref, () => ({
      focus: () => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      },
      clear: () => {
        onTextChange?.('');
        if (textareaRef.current) {
          textareaRef.current.value = '';
          textareaRef.current.style.height = '42px';
        }
      },
      setText: (text: string) => {
        onTextChange?.(text);
        requestAnimationFrame(adjustHeight);
      },
      getText: () => {
        return textareaRef.current?.value ?? externalText;
      },
      openFilePicker: () => {
        universalInputRef.current?.click();
      },
    }));

    const handleFilesSelected = async (
      files: FileList | File[],
      source: PromptAttachmentItem['source']
    ) => {
      if (!onAddAttachments) return;
      setIsProcessingFiles(true);
      try {
        const { added, errors } = await processFilesForAttachment(
          files,
          attachments.length,
          source
        );
        if (added.length > 0) {
          onAddAttachments(added);
          const summary =
            added.length === 1
              ? `'${added[0].name}' 파일이 첨부되었습니다.`
              : `${added.length}개 파일이 첨부되었습니다.`;
          showToast?.(summary);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }
        if (errors.length > 0) {
          showToast?.(errors[0]);
        }
      } finally {
        setIsProcessingFiles(false);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isComposingRef.current || e.nativeEvent.isComposing) {
          return;
        }
        e.preventDefault();
        const trimmed = (textareaRef.current?.value ?? externalText).trim();
        if ((trimmed || attachments.length > 0) && !disabled && !loading) {
          onSend(trimmed);
        }
      }
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled || loading || !onAddAttachments) return;

      const clipboard = e.clipboardData;
      if (!clipboard) return;

      const plainText = clipboard.getData('text/plain') || '';

      // 1. 엑셀 / 스프레드시트 탭 구분 표 데이터가 있는 경우 구조화된 표 데이터로 우선 첨부
      if (plainText.trim()) {
        const smartCandidate = classifySmartPastedText(plainText);
        if (smartCandidate && smartCandidate.kind === 'spreadsheet') {
          if (attachments.length < MAX_ATTACHMENTS) {
            e.preventDefault();
            onAddAttachments([smartCandidate]);
            showToast?.('클립보드 표 데이터가 첨부되었습니다.');
            return;
          }
        }
      }

      // 2. 클립보드 파일 또는 캡처 이미지 확인
      let pastedFiles: File[] = [];
      if (clipboard.files && clipboard.files.length > 0) {
        pastedFiles = Array.from(clipboard.files);
      } else if (clipboard.items && clipboard.items.length > 0) {
        for (let i = 0; i < clipboard.items.length; i++) {
          const item = clipboard.items[i];
          if (item.kind === 'file') {
            const f = item.getAsFile();
            if (f) pastedFiles.push(f);
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        await handleFilesSelected(pastedFiles, 'paste');
        return;
      }

      // 3. 장문 문서 / 회의록 / ICS 캘린더 텍스트 자동 첨부 전환
      if (plainText.trim()) {
        const smartTextAttachment = classifySmartPastedText(plainText);
        if (smartTextAttachment && attachments.length < MAX_ATTACHMENTS) {
          e.preventDefault();
          onAddAttachments([smartTextAttachment]);
          showToast?.(
            smartTextAttachment.kind === 'calendar'
              ? '클립보드 ICS 일정 데이터가 첨부되었습니다.'
              : '클립보드 텍스트가 문서 컨텍스트로 첨부되었습니다.'
          );
        }
      }
    };

    const handleClipboardMenuAction = async () => {
      if (disabled || loading) return;
      setIsMenuOpen(false);

      const res = await readSystemClipboard(attachments.length);
      if (res.type === 'attachments') {
        if (res.items.length > 0 && onAddAttachments) {
          onAddAttachments(res.items);
          showToast?.(
            res.items[0].kind === 'image'
              ? '클립보드 이미지가 첨부되었습니다.'
              : `'${res.items[0].name}' 데이터가 첨부되었습니다.`
          );
          textareaRef.current?.focus();
        }
        if (res.errors.length > 0) {
          showToast?.(res.errors[0]);
        }
        return;
      }

      if (res.type === 'inline-text') {
        const nextText = externalText
          ? `${externalText}${externalText.endsWith('\n') || externalText.endsWith(' ') ? '' : ' '}${res.text}`
          : res.text;
        onTextChange?.(nextText);
        showToast?.('클립보드 텍스트를 붙여넣었습니다.');
        requestAnimationFrame(() => {
          adjustHeight();
          textareaRef.current?.focus();
        });
        return;
      }

      if (res.type === 'empty') {
        showToast?.('클립보드가 비어 있습니다.');
        textareaRef.current?.focus();
        return;
      }

      if (onOpenSnippetModal) {
        onOpenSnippetModal();
      } else {
        textareaRef.current?.focus();
        showToast?.('입력창에서 Ctrl+V (Mac: ⌘V)를 눌러 붙여넣으세요.');
      }
    };

    const canSend =
      !disabled && !loading && (externalText.trim().length > 0 || attachments.length > 0);

    return (
      <div className="w-full rounded-2xl bg-[#151822] border border-white/[0.08] hover:border-white/[0.13] focus-within:border-white/[0.2] focus-within:bg-[#171a26] transition-colors duration-150 p-2.5 flex flex-col">
        {/* 1. 첨부 파일 트레이 */}
        {attachments.length > 0 && (
          <div className="pb-2 mb-1.5 border-b border-white/[0.06] flex items-center gap-2 overflow-x-auto no-scrollbar">
            {attachments.map((item) => (
              <div
                key={item.id}
                onClick={() => onPreviewAttachment?.(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreviewAttachment?.(item);
                  }
                }}
                title="클릭하여 미리보기"
                className="group relative flex items-center gap-2 p-1.5 pr-2 rounded-xl bg-white/[0.035] hover:bg-white/[0.07] border border-white/[0.07] transition-colors cursor-pointer shrink-0 max-w-[220px]"
              >
                {item.kind === 'image' && item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center text-neutral-300 shrink-0">
                    <AttachmentKindIcon kind={item.kind} className="w-3.5 h-3.5" />
                  </div>
                )}

                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[11px] font-medium text-neutral-100 truncate">
                    {item.name}
                  </div>
                  <div className="text-[10px] text-neutral-400 truncate tabular-nums">
                    {item.metaLabel || item.mimeType}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  {item.textContent && onExpandAttachmentToText && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExpandAttachmentToText(item);
                      }}
                      className="p-1 rounded-md text-neutral-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title="입력창 본문으로 펼치기"
                    >
                      <ArrowDownToLine className="w-3 h-3" />
                    </button>
                  )}

                  {onRemoveAttachment && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAttachment(item.id);
                      }}
                      className="p-1 rounded-md text-neutral-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title="첨부 제거"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 2. 프롬프트 텍스트 영역 */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={externalText}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onTextChange?.(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => void handlePaste(e)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          aria-label={placeholder}
          className="w-full bg-transparent text-[13px] text-neutral-100 placeholder-neutral-500 border-0 no-focus-outline px-1 pt-0.5 pb-1.5 resize-none leading-relaxed min-h-[42px] max-h-[168px] overflow-y-auto whitespace-pre-wrap break-words disabled:opacity-50"
        />

        {/* 숨김 통합 파일 인풋 */}
        <input
          ref={universalInputRef}
          type="file"
          multiple
          accept={UNIVERSAL_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleFilesSelected(e.target.files, 'file');
            }
            e.target.value = '';
          }}
        />

        {/* 3. 미니멀 하단 액션 바 (무테 Ghost + 메뉴 · AI 모델 선택기 · 전송 버튼) */}
        <div className="flex items-center justify-between pt-1 gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <div className="relative" ref={menuContainerRef}>
              <button
                type="button"
                disabled={disabled || isProcessingFiles}
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 ${
                  isMenuOpen
                    ? 'bg-white/[0.09] text-white'
                    : isListening
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]'
                }`}
                title="입력 및 첨부 메뉴"
              >
                {isProcessingFiles ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-300" />
                ) : (
                  <Plus
                    className={`w-4 h-4 transition-transform duration-150 ${
                      isMenuOpen ? 'rotate-45' : ''
                    }`}
                  />
                )}
              </button>

              {/* + 통합 메뉴 (모델 선택 모달과 동일한 프로스티드 글래스모피즘 & 투명 그라데이션 경계선) */}
              {isMenuOpen && (
                <div className="luxury-glass-border absolute bottom-full left-0 mb-2.5 w-44 rounded-xl bg-gradient-to-b from-[#181c27]/76 via-[#11141d]/72 to-[#0c0e15]/80 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] p-1.5 z-30 space-y-0.5 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      universalInputRef.current?.click();
                    }}
                    className="group w-full h-[34px] px-2.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-neutral-400/90 group-hover:text-white transition-colors shrink-0" />
                    <span className="text-xs font-medium text-neutral-200/95 group-hover:text-white transition-colors">
                      파일 첨부
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleClipboardMenuAction()}
                    className="group w-full h-[34px] px-2.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5 text-neutral-400/90 group-hover:text-white transition-colors shrink-0" />
                    <span className="text-xs font-medium text-neutral-200/95 group-hover:text-white transition-colors">
                      클립보드 붙여넣기
                    </span>
                  </button>

                  {onOpenCamera && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenCamera();
                      }}
                      className="group w-full h-[34px] px-2.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Camera className="w-3.5 h-3.5 text-neutral-400/90 group-hover:text-white transition-colors shrink-0" />
                      <span className="text-xs font-medium text-neutral-200/95 group-hover:text-white transition-colors">
                        카메라 스캔
                      </span>
                    </button>
                  )}

                  {onToggleVoice && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onToggleVoice();
                      }}
                      className={`group w-full h-[34px] px-2.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap ${
                        isListening ? 'bg-rose-500/12' : ''
                      }`}
                    >
                      <Mic
                        className={`w-3.5 h-3.5 transition-colors shrink-0 ${
                          isListening
                            ? 'text-rose-400'
                            : 'text-neutral-400/90 group-hover:text-white'
                        }`}
                      />
                      <span
                        className={`text-xs font-medium transition-colors ${
                          isListening
                            ? 'text-rose-300'
                            : 'text-neutral-200/95 group-hover:text-white'
                        }`}
                      >
                        {isListening ? '음성 입력 중지' : '음성 입력'}
                      </span>
                    </button>
                  )}

                  {onOpenDateDiscovery && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenDateDiscovery();
                      }}
                      className="group w-full h-[34px] px-2.5 rounded-[7px] hover:bg-white/[0.06] text-left flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Globe className="w-3.5 h-3.5 text-neutral-400/90 group-hover:text-white transition-colors shrink-0" />
                      <span className="text-xs font-medium text-neutral-200/95 group-hover:text-white transition-colors">
                        공휴일·업계 일정 탐색
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* + 기호 우측 미니멀 AI 모델 선택기 */}
            {onChangeModelSelection && onWebLlmProgress && (
              <ModelSelectorPopover
                selection={modelSelection}
                onChangeSelection={onChangeModelSelection}
                disabled={disabled}
                webllmProgress={webllmProgress}
                onWebLlmProgress={onWebLlmProgress}
                showToast={showToast}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => onSend((textareaRef.current?.value ?? externalText).trim())}
            disabled={!canSend}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0 ${
              canSend
                ? 'bg-white text-neutral-950 hover:bg-neutral-200 shadow-xs'
                : 'bg-white/[0.05] text-neutral-600 cursor-not-allowed'
            }`}
            title="전송 (Enter)"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-300" />
            ) : (
              <ArrowUp className="w-4 h-4 stroke-[2.25]" />
            )}
          </button>
        </div>
      </div>
    );
  }
);

PromptMarkdownInput.displayName = 'PromptMarkdownInput';
