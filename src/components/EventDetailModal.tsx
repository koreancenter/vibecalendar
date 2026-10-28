import React, { useEffect } from 'react';
import { Share2 } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { EventDetailContent } from './EventDetailContent';

interface EventDetailModalProps {
  event: CalendarEventItem | null;
  viewerTimeZone?: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onToggleChecklistItem: (eventId: string, itemId: string) => void;
  hasConflict?: boolean;
  projects?: ProjectItem[];
  onUpdateProject?: (eventId: string, projectId: string | undefined) => void;
  onUpdateTimeZone?: (eventId: string, timeZone: string | undefined) => void;
  onUpdateLocation?: (
    eventId: string,
    location?: string,
    locationAddress?: string
  ) => void;
  onShare?: (event: CalendarEventItem) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  viewerTimeZone,
  onClose,
  onDelete,
  onToggleComplete,
  onToggleChecklistItem,
  hasConflict = false,
  projects = [],
  onUpdateProject,
  onUpdateTimeZone,
  onUpdateLocation,
  onShare,
}) => {
  useEffect(() => {
    if (!event) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [event, onClose]);

  if (!event) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#12151e] border border-white/[0.10] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <EventDetailContent
          event={event}
          viewerTimeZone={viewerTimeZone}
          hasConflict={hasConflict}
          projects={projects}
          variant="modal"
          onUpdateProject={onUpdateProject}
          onUpdateTimeZone={onUpdateTimeZone}
          onUpdateLocation={onUpdateLocation}
          onToggleComplete={onToggleComplete}
          onToggleChecklistItem={onToggleChecklistItem}
          onShare={onShare}
          onDelete={onDelete}
          onClose={onClose}
        />

        <div className="p-3 bg-[#0f121a] border-t border-white/[0.07] flex items-center justify-between gap-2 shrink-0">
          {onShare ? (
            <button
              type="button"
              onClick={() => onShare(event)}
              className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-neutral-100 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span>브리핑 패스 공유</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
