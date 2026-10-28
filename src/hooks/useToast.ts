import { useState, useRef, useEffect, useCallback } from 'react';

export interface ToastState {
  toastMessage: string;
  showToast: (msg: string, onUndo?: () => void) => void;
  handleExecuteUndo: () => void;
  hasUndo: boolean;
}

export function useToast(): ToastState {
  const [toastMessage, setToastMessage] = useState<string>('');
  const [undoCallback, setUndoCallback] = useState<(() => void) | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, onUndo?: () => void) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    setUndoCallback(onUndo ? () => onUndo : null);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage('');
      setUndoCallback(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  const handleExecuteUndo = useCallback(() => {
    if (undoCallback) {
      undoCallback();
      setUndoCallback(null);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      setToastMessage('이전 상태로 되돌렸습니다.');
      toastTimerRef.current = setTimeout(() => {
        setToastMessage('');
        toastTimerRef.current = null;
      }, 2000);
    }
  }, [undoCallback]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return {
    toastMessage,
    showToast,
    handleExecuteUndo,
    hasUndo: !!undoCallback,
  };
}
