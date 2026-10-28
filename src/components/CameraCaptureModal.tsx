import React, { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, Image, Check, AlertCircle } from 'lucide-react';

export interface CapturedPhoto {
  dataUrl: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (photo: CapturedPhoto) => void;
  showToast: (msg: string) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
  showToast,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [isLoadingCamera, setIsLoadingCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 카메라 스트림 시작
  const startCamera = async () => {
    setIsLoadingCamera(true);
    setCameraError(null);
    setCapturedPreview(null);

    // 기존 스트림 해제
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('브라우저에서 카메라 접근 API를 지원하지 않습니다.');
      }

      // 후면 카메라 우선 시도 (스마트폰 촬영 최적화), 실패 시 일반 카메라
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn('카메라 스트림 시작 실패:', err);
      let msg = '카메라를 시작할 수 없습니다.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = '카메라 권한이 차단되었습니다. 브라우저 설정에서 카메라 권한을 허용해 주세요.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = '연결된 카메라 장치를 찾을 수 없습니다.';
      } else {
        msg = err.message || msg;
      }
      setCameraError(msg);
    } finally {
      setIsLoadingCamera(false);
    }
  };

  // 모달 열림/닫힘 시 스트림 생명주기 및 Escape 키 처리
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      void startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
      setCapturedPreview(null);
      setCameraError(null);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen]);

  // 셔터 누르기 (현재 프레임 캡처)
  const handleTakeSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');

    // 최대 1600px 해상도로 최적화
    const maxDim = 1600;
    let w = video.videoWidth || 1280;
    let h = video.videoHeight || 720;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedPreview(dataUrl);
  };

  // 캡처 확인 및 프롬프트에 첨부
  const handleConfirmPhoto = () => {
    if (!capturedPreview) return;
    const parts = capturedPreview.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const base64 = parts[1];

    onCapture({
      dataUrl: capturedPreview,
      base64,
      mimeType,
      fileName: `촬영사진_${new Date().toISOString().slice(5, 10).replace('-', '')}_${Date.now().toString().slice(-4)}.jpg`,
    });
    showToast('사진이 첨부되었습니다. AI가 일정을 분석합니다.');
    onClose();
  };

  // 파일 선택기(앨범/로컬 파일) 처리
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(file.type)) {
      showToast('JPG, PNG, WEBP 형식의 이미지 파일만 첨부할 수 있습니다.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      if (result) {
        // 이미지 캔버스로 리사이징/압축
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1600;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
            const parts = optimizedDataUrl.split(',');
            const base64 = parts[1];
            onCapture({
              dataUrl: optimizedDataUrl,
              base64,
              mimeType: 'image/jpeg',
              fileName: file.name,
            });
            showToast('이미지가 첨부되었습니다.');
            onClose();
          }
        };
        img.src = result;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#14161f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between bg-[#171a24]">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Camera className="w-4 h-4 text-indigo-400" />
            <span>사진 촬영 및 문서 판독</span>
          </div>
        </div>

        {/* 카메라 뷰파인더 / 미리보기 영역 */}
        <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
          {capturedPreview ? (
            <img
              src={capturedPreview}
              alt="촬영된 사진 미리보기"
              className="w-full h-full object-contain"
            />
          ) : cameraError ? (
            <div className="flex flex-col items-center justify-center text-center p-6 space-y-3">
              <AlertCircle className="w-10 h-10 text-amber-400" />
              <p className="text-xs sm:text-sm text-neutral-300 max-w-xs">{cameraError}</p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 다시 시도
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Image className="w-3.5 h-3.5" /> 사진 파일 업로드
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {/* 뷰파인더 그리드 가이드 */}
              <div className="absolute inset-4 border border-white/25 rounded-xl pointer-events-none flex flex-col justify-between p-2">
                <div className="text-[10px] text-white/70 font-mono tracking-wider">
                  [일정표 / 안내문 / 명함 중앙 정렬]
                </div>
                <div className="self-end text-[10px] text-white/50 font-mono">AI VISION</div>
              </div>
              {isLoadingCamera && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs text-neutral-300 gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>카메라를 활성화하고 있습니다...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* 숨김 파일 인풋 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* 하단 컨트롤 바 */}
        <div className="p-3.5 bg-[#171a24] border-t border-white/[0.08] flex items-center justify-between gap-2">
          {capturedPreview ? (
            <>
              <button
                type="button"
                onClick={() => setCapturedPreview(null)}
                className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-xs text-neutral-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>다시 촬영</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmPhoto}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-md shadow-indigo-600/30 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>이 사진 사용하기</span>
              </button>
            </>
          ) : (
            <>
              {/* 파일 업로드 바로가기 */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Image className="w-4 h-4 text-indigo-400" />
                <span>앨범/파일 선택</span>
              </button>

              {/* 셔터 버튼 */}
              <div className="flex-1 flex justify-center">
                <button
                  type="button"
                  onClick={handleTakeSnapshot}
                  disabled={isLoadingCamera || Boolean(cameraError)}
                  className="w-12 h-12 rounded-full border-4 border-white/20 bg-indigo-600 hover:bg-indigo-500 active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center cursor-pointer shadow-lg shadow-indigo-600/40"
                  title="사진 촬영"
                >
                  <div className="w-5 h-5 rounded-full bg-white" />
                </button>
              </div>

              {/* 닫기 버튼 */}
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-xl text-xs text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                닫기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
