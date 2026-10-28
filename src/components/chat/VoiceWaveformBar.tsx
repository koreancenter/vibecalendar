import React, { useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';

interface VoiceWaveformBarProps {
  prompt: string;
  onSendNow: () => void;
  onCancel: () => void;
}

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/**
 * 60fps Web Audio 파형 애니메이션을 부모 React 상태와 완전히 격리한 Canvas 리프 컴포넌트
 */
export const VoiceWaveformBar: React.FC<VoiceWaveformBarProps> = ({
  prompt,
  onSendNow,
  onCancel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let rafId: number | null = null;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let isDisposed = false;

    const drawBars = (levels: number[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const barCount = levels.length;
      const gap = 6;
      const totalGap = gap * (barCount - 1);
      const barWidth = Math.max(3, Math.min(6, (rect.width - 24 - totalGap) / barCount));
      const contentWidth = barCount * barWidth + totalGap;
      const startX = (rect.width - contentWidth) / 2;

      for (let i = 0; i < barCount; i++) {
        const pct = Math.max(0.16, Math.min(1, levels[i]));
        const barHeight = Math.max(4, pct * (rect.height - 8));
        const x = startX + i * (barWidth + gap);
        const y = (rect.height - barHeight) / 2;

        ctx.fillStyle = pct > 0.6 ? '#fb7185' : pct > 0.35 ? '#818cf8' : 'rgba(129, 140, 248, 0.55)';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const startFallbackAnimation = () => {
      let tick = 0;
      const loop = () => {
        if (isDisposed) return;
        tick++;
        const levels = Array.from({ length: 20 }, (_, i) => {
          const wave = Math.abs(Math.sin(tick * 0.14 + i * 0.4) + Math.cos(tick * 0.09 - i * 0.25));
          return Math.min(0.95, 0.2 + wave * 0.35);
        });
        drawBars(levels);
        rafId = requestAnimationFrame(loop);
      };
      loop();
    };

    const initAudio = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (isDisposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const win = window as unknown as WindowWithWebkitAudio;
        const AudioContextClass = window.AudioContext || win.webkitAudioContext;
        if (!AudioContextClass) {
          startFallbackAnimation();
          return;
        }

        audioCtx = new AudioContextClass();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.76;

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const barCount = 20;

        const renderFrame = () => {
          if (isDisposed) return;
          analyser.getByteFrequencyData(dataArray);
          const step = Math.max(1, Math.floor(dataArray.length / barCount));
          const levels: number[] = [];
          for (let i = 0; i < barCount; i++) {
            const val = dataArray[i * step] || 0;
            levels.push(Math.max(0.16, val / 255));
          }
          drawBars(levels);
          rafId = requestAnimationFrame(renderFrame);
        };

        renderFrame();
      } catch {
        startFallbackAnimation();
      }
    };

    void initAudio();

    return () => {
      isDisposed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, []);

  return (
    <div className="px-3.5 py-2.5 bg-[#16131c] border-t border-rose-500/25 flex flex-col gap-2 shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-[11px] font-semibold text-rose-300">실시간 음성 감지 중</span>
        </div>

        <div className="flex items-center gap-1.5">
          {prompt.trim() && (
            <button
              type="button"
              onClick={onSendNow}
              className="px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold text-white transition-colors cursor-pointer flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
              <span>전송</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="음성 인식 취소"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="h-8 bg-black/40 border border-white/[0.08] rounded-lg overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {prompt ? (
        <div className="text-[11px] text-neutral-200 bg-black/30 px-2.5 py-1 rounded-md truncate border border-white/[0.06]">
          <span className="text-neutral-400 mr-1.5">인식:</span>
          <span>{prompt}</span>
        </div>
      ) : (
        <div className="text-[10px] text-neutral-400 text-center">
          마이크에 말씀해 주세요 (예: &quot;10월 22일 10시 고려대 방문&quot;)
        </div>
      )}
    </div>
  );
};
