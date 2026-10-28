import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Table2,
  Calendar,
  Volume2,
  ClipboardPaste,
  Image as ImageIcon,
  ArrowDownToLine,
  Check,
} from 'lucide-react';
import {
  MessageAttachmentSummary,
  PromptAttachmentItem,
  PromptAttachmentKind,
} from '../../types';
import { formatFileSize } from '../../utils/attachmentProcessor';

export function AttachmentKindIcon({
  kind,
  className = 'w-4 h-4',
}: {
  kind: PromptAttachmentKind;
  className?: string;
}) {
  switch (kind) {
    case 'image':
      return <ImageIcon className={className} />;
    case 'spreadsheet':
      return <Table2 className={className} />;
    case 'calendar':
      return <Calendar className={className} />;
    case 'audio':
      return <Volume2 className={className} />;
    case 'clipboard':
      return <ClipboardPaste className={className} />;
    case 'pdf':
    case 'document':
    default:
      return <FileText className={className} />;
  }
}

interface AttachmentPreviewModalProps {
  attachment: PromptAttachmentItem | MessageAttachmentSummary | null;
  onClose: () => void;
  onExpandToPrompt?: (item: PromptAttachmentItem | MessageAttachmentSummary) => void;
}

export const AttachmentPreviewModal: React.FC<AttachmentPreviewModalProps> = ({
  attachment,
  onClose,
  onExpandToPrompt,
}) => {
  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachment, onClose]);

  if (!attachment) return null;

  const canExpandText = Boolean(attachment.textContent && onExpandToPrompt);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#0e1017] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[86vh]"
      >
        {/* 상단 헤더 */}
        <div className="px-5 py-3.5 border-b border-white/[0.07] bg-[#12151f] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-neutral-200 shrink-0">
              <AttachmentKindIcon kind={attachment.kind} className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-white truncate">{attachment.name}</h3>
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 tabular-nums">
                <span>{attachment.metaLabel || attachment.mimeType}</span>
                <span aria-hidden="true">·</span>
                <span>{formatFileSize(attachment.sizeBytes)}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            title="닫기 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 미리보기 */}
        <div className="p-5 overflow-y-auto flex-1 bg-[#0b0d13]">
          {attachment.kind === 'image' && attachment.previewUrl ? (
            <div className="flex items-center justify-center bg-black/40 rounded-xl border border-white/[0.06] p-2">
              <img
                src={attachment.previewUrl}
                alt={attachment.name}
                referrerPolicy="no-referrer"
                className="max-h-[62vh] w-auto object-contain rounded-lg"
              />
            </div>
          ) : attachment.kind === 'audio' && attachment.previewUrl ? (
            <div className="py-10 px-6 rounded-xl bg-[#131620] border border-white/[0.06] flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-neutral-200">
                <Volume2 className="w-6 h-6" />
              </div>
              <p className="text-xs text-neutral-300 text-center">
                첨부된 오디오 음성을 AI가 직접 청취하여 일정 및 준비 사항을 추출합니다.
              </p>
              <audio controls src={attachment.previewUrl} className="w-full max-w-md" />
            </div>
          ) : attachment.textContent ? (
            <pre className="w-full text-xs text-neutral-200 font-mono leading-relaxed whitespace-pre-wrap break-words bg-[#12151e] border border-white/[0.06] rounded-xl p-4 max-h-[58vh] overflow-y-auto select-text">
              {attachment.textContent}
            </pre>
          ) : (
            <div className="py-12 px-6 rounded-xl bg-[#12151e] border border-white/[0.06] text-center space-y-2">
              <p className="text-xs font-medium text-neutral-200">
                {attachment.kind === 'pdf'
                  ? 'PDF 원본 문서가 멀티모달 분석 대기 중입니다.'
                  : '첨부 파일이 준비되었습니다.'}
              </p>
              <p className="text-[11px] text-neutral-500">
                전송 시 문서 내 표, 일시, 장소, 참석자 정보를 자동으로 판독합니다.
              </p>
            </div>
          )}
        </div>

        {/* 하단 액션 바 */}
        <div className="px-5 py-3 border-t border-white/[0.07] bg-[#12151f] flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-neutral-500">
            AI 컨시어지가 첨부 데이터를 문맥으로 함께 참조합니다
          </span>

          <div className="flex items-center gap-2">
            {canExpandText && (
              <button
                type="button"
                onClick={() => {
                  onExpandToPrompt?.(attachment);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-neutral-200 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span>입력창 본문으로 펼치기</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DirectPasteSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttachSnippet: (title: string, content: string) => void;
}

export const DirectPasteSnippetModal: React.FC<DirectPasteSnippetModalProps> = ({
  isOpen,
  onClose,
  onAttachSnippet,
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setContent('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onAttachSnippet(title, content);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-[#0e1017] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-5 space-y-3.5 text-xs">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="문서 제목 (선택)"
            className="w-full bg-[#141722] border border-white/[0.08] focus:border-white/[0.22] rounded-xl px-3.5 py-2 text-white placeholder-neutral-500 text-xs outline-hidden transition-colors"
          />

          <textarea
            autoFocus
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="클립보드 텍스트나 표를 붙여넣으세요 (Ctrl+V / ⌘V)..."
            className="w-full bg-[#141722] border border-white/[0.08] focus:border-white/[0.22] rounded-xl p-3.5 text-neutral-100 placeholder-neutral-500 text-xs font-mono leading-relaxed resize-none outline-hidden transition-colors"
          />
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.07] bg-[#12151f] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!content.trim()}
            className="px-4 py-1.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            <span>컨텍스트로 첨부</span>
          </button>
        </div>
      </form>
    </div>
  );
};
