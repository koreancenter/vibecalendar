import React, { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

export type LegalDrawerTab = 'disclaimer' | 'privacy' | 'colophon';

interface LegalAndColophonDrawerProps {
  isOpen: boolean;
  initialTab?: LegalDrawerTab;
  onClose: () => void;
  onCopySuccess?: (message: string) => void;
}

export const CREATOR_ENTITY = {
  teamName: 'GOGUMA APP Team',
  networkName: 'Korean Center Global Network',
  fullTitle: 'GOGUMA APP Team - Korean Center Global Network',
  email: 'master@goguma.app',
  jurisdiction: 'Republic of Korea',
  copyrightYear: '2026',
} as const;

export const LegalAndColophonDrawer: React.FC<LegalAndColophonDrawerProps> = ({
  isOpen,
  initialTab = 'disclaimer',
  onClose,
  onCopySuccess,
}) => {
  const [activeTab, setActiveTab] = useState<LegalDrawerTab>(initialTab);
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CREATOR_ENTITY.email);
      setCopiedEmail(true);
      onCopySuccess?.(`문의 이메일(${CREATOR_ENTITY.email})이 복사되었습니다.`);
      setTimeout(() => setCopiedEmail(false), 2200);
    } catch {
      onCopySuccess?.(`문의 이메일: ${CREATOR_ENTITY.email}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/65 backdrop-blur-xs transition-opacity duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="법적 고지 및 제작 노트"
      onClick={onClose}
    >
      <aside
        className="relative w-full max-w-xl h-full bg-[#0d0f15] border-l border-white/[0.08] flex flex-col text-neutral-200 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 헤더 및 무테 탭 전환 */}
        <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-neutral-400 tracking-tight">
              바이브 행사 · 법적 고지 및 아틀리에 기록
            </span>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer"
              aria-label="창 닫기"
            >
              <X className="w-4 h-4" strokeWidth={1.65} />
            </button>
          </div>

          <nav
            className="mt-5 flex items-center gap-6"
            role="tablist"
            aria-label="법적 고지 문서 선택"
          >
            {(
              [
                { id: 'disclaimer', label: 'AI 보안·과금 면책고지' },
                { id: 'privacy', label: '개인정보처리방침' },
                { id: 'colophon', label: '제작 노트' },
              ] as const
            ).map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-2 text-[13px] transition-colors duration-150 border-b cursor-pointer whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'text-white font-semibold border-white'
                      : 'text-neutral-500 hover:text-neutral-300 font-normal border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-7 space-y-8 text-[13.5px] leading-relaxed text-neutral-300">
          {activeTab === 'disclaimer' && (
            <div className="space-y-7">
              <div>
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  AI API Key 보안 및 과금 책임 면책 고지
                </h2>
                <p className="mt-2 text-xs text-neutral-500 tabular-nums">
                  시행일: 2026. 10. 28 · 고지 주체: {CREATOR_ENTITY.fullTitle}
                </p>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  01. AI API Key 보안 관리 책임 및 면책
                </h3>
                <p className="text-neutral-400">
                  본 애플리케이션의 클라우드 AI 에이전트 또는 외부 연동 기능을 사용할 때 적용되는
                  AI API Key, 엔드포인트 자격 증명 및 실행 환경의 보안 유지 책임은 전적으로 사용자(또는
                  배포 운영자) 본인에게 있습니다. 키 유출, 공용 기기 방치, 권한 오설정, 제3자 무단
                  호출로 인해 발생하는 보안 사고에 대하여 제작자({CREATOR_ENTITY.fullTitle})는 어떠한
                  법적·기술적 보증이나 배상 책임도 부담하지 않습니다.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  02. 클라우드 API 호출 및 과금(Billing) 책임 면책
                </h3>
                <p className="text-neutral-400">
                  자연어 일정 생성, 문서·이미지·음성 멀티모달 첨부 분석, 실시간 웹 탐색(Grounding) 등
                  클라우드 AI 모델 호출 시 발생하는 토큰 사용료, 검색 API 호출료 및 일체의 클라우드
                  과금은 해당 API Key 또는 클라우드 프로젝트 계정의 소유자에게 직접 청구됩니다. 제작자는
                  사용자의 API 호출량, 요금 한도 초과, 예기치 않은 과금에 대해 일체의 금전적 책임을 지지
                  않으므로, 사용 전 반드시 클라우드 콘솔에서 예산 알림 및 할당량 제한(Quota Limit)을
                  직접 설정하시기 바랍니다.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  03. AI 생성 공정 및 장소·일정 정보의 참고성
                </h3>
                <p className="text-neutral-400">
                  AI 에이전트가 제안하는 D-Day 역산 공정, 시간대 변환, 개최 후보일 및 추천 장소 정보는
                  기획 편의를 돕기 위한 참고 자료이며 정확성·최신성·적합성을 보장하지 않습니다. 실제
                  대관 계약, 초청장 발송, 예산 집행 및 법적 의사결정 전 반드시 사용자가 원본 정보를 직접
                  검증해야 합니다.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  04. 무계정 AES-256-GCM 로컬 볼트 및 복구 불가 고지
                </h3>
                <p className="text-neutral-400">
                  본 서비스는 마스터 복구 키나 중앙 계정 서버를 두지 않는 로컬 퍼스트 암호화 구조를
                  채택하고 있습니다. 설정한 PIN을 분실하거나 브라우저 사이트 데이터를 삭제할 경우 제작자를
                  포함한 누구도 암호화된 일정을 복호화할 수 없으므로, 중요한 일정은 수시로 ICS 또는 PDF
                  내보내기 기능으로 별도 백업하시기 바랍니다.
                </p>
              </section>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-7">
              <div>
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  개인정보처리방침 (Local-First 아키텍처 기준)
                </h2>
                <p className="mt-2 text-xs text-neutral-500 tabular-nums">
                  시행일: 2026. 10. 28 · 개인정보 보호 고지 주체: {CREATOR_ENTITY.fullTitle}
                </p>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  01. 회원가입 부재 및 개인식별정보 미수집 원칙
                </h3>
                <p className="text-neutral-400">
                  ‘바이브 행사’는 아이디, 이메일, 성명, 휴대전화번호 등 어떠한 회원가입 절차도 요구하지
                  않으며, 중앙 데이터베이스에 사용자의 일정이나 개인정보를 수집·보관하지 않습니다.
                  작성된 프로젝트, 일정, 체크리스트는 전적으로 사용자 기기의 브라우저 저장소 내부에만
                  저장되며, 볼트 잠금 설정 시 Web Crypto 표준 AES-256-GCM 알고리즘으로 암호화됩니다.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  02. AI 엔진 선택에 따른 데이터 처리 범위
                </h3>
                <p className="text-neutral-400">
                  클라우드 AI 모델(Gemini API) 선택 시, 사용자가 대화창에 입력한 지시문·첨부 자료 및
                  일정 문맥이 응답 생성을 위해서만 암호화 전송되어 일시 처리되며 당사 서버에 별도
                  저장되지 않습니다. 온디바이스 AI(WebLLM) 또는 로컬 AI(Ollama) 선택 시에는 모든 추론이
                  사용자 기기 내부에서만 수행되어 외부 네트워크로 데이터가 전송되지 않습니다.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  03. 선택적 기기 권한 (생체 인증 · 카메라 · 마이크) 및 브리핑 패스 공유
                </h3>
                <p className="text-neutral-400">
                  생체 인증(WebAuthn — Face ID · Touch ID · Windows Hello · 지문) 활성화 시, 실제
                  생체 정보는 운영체제의 보안 영역(Secure Enclave · TPM) 외부로 절대 유출되지 않으며
                  앱이나 외부 서버로 전송되지 않습니다. 카메라 및 마이크 권한 역시 사용자가 해당 버튼을
                  직접 실행할 때만 일시 활성화되며, ‘브리핑 패스 공유’ 기능은 선택한 일정만 URL 토큰에
                  압축 인코딩하여 전달하는 무서버 방식으로 동작합니다.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  04. 데이터 파기 방법 및 운영 주체 연락처
                </h3>
                <p className="text-neutral-400">
                  사용자는 언제든 인트로 화면 또는 상단 볼트 메뉴의 ‘로컬 볼트 초기화’를 실행하여 기기
                  내 저장 데이터를 즉시 영구 파기할 수 있습니다. 본 방침과 관련한 문의는 아래 공식
                  연락처로 접수하실 수 있습니다.
                </p>
                <div className="pt-2 text-xs text-neutral-400 space-y-1 border-t border-white/[0.06]">
                  <div>운영 및 책임 주체: {CREATOR_ENTITY.fullTitle}</div>
                  <div>관할 및 소재지: {CREATOR_ENTITY.jurisdiction}</div>
                  <div>공식 문의처: {CREATOR_ENTITY.email}</div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'colophon' && (
            <div className="space-y-7">
              <div>
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  제작 노트 (Atelier Colophon)
                </h2>
                <p className="mt-2 text-xs text-neutral-500">
                  고밀도 행사 공정 설계를 위한 프라이빗 로컬 퍼스트 워크스페이스
                </p>
              </div>

              <p className="text-neutral-300 leading-relaxed">
                ‘바이브 행사’는 수많은 이해관계자와 마감 시한이 교차하는 행사 기획 현장에서, 불필요한
                계정 종속이나 복잡한 설정 없이 오직 공정 설계의 본질에만 몰입할 수 있도록 제작되었습니다.
                사용자의 모든 기획 자산은 오직 사용자의 기기 안에서만 암호화되어 숨 쉽니다.
              </p>

              <div className="border-t border-b border-white/[0.06] divide-y divide-white/[0.06] text-xs">
                <div className="py-3.5 flex items-center justify-between gap-4">
                  <span className="text-neutral-500">제작 및 설계</span>
                  <span className="text-neutral-100 font-medium text-right">
                    {CREATOR_ENTITY.teamName}
                  </span>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4">
                  <span className="text-neutral-500">글로벌 네트워크</span>
                  <span className="text-neutral-200 text-right">
                    {CREATOR_ENTITY.networkName}
                  </span>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4">
                  <span className="text-neutral-500">소재지 및 관할</span>
                  <span className="text-neutral-200 text-right">
                    {CREATOR_ENTITY.jurisdiction}
                  </span>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4">
                  <span className="text-neutral-500">공식 문의 이메일</span>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="inline-flex items-center gap-1.5 text-neutral-100 hover:text-white transition-colors duration-150 cursor-pointer"
                    title="클릭하여 이메일 주소 복사"
                  >
                    <span className="underline underline-offset-4 decoration-white/25">
                      {CREATOR_ENTITY.email}
                    </span>
                    {copiedEmail ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-neutral-500" />
                    )}
                  </button>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4">
                  <span className="text-neutral-500">볼트 암호화 규격</span>
                  <span className="text-neutral-300 tabular-nums text-right">
                    AES-256-GCM · PBKDF2-SHA256 · WebAuthn
                  </span>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4">
                  <span className="text-neutral-500">지원 추론 엔진</span>
                  <span className="text-neutral-300 text-right">
                    Gemini Cloud · Ollama Local · WebLLM
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 하단 고정 바 */}
        <div className="px-6 sm:px-8 py-4 border-t border-white/[0.06] flex items-center justify-between gap-4 text-xs text-neutral-500 shrink-0">
          <span className="truncate">
            © {CREATOR_ENTITY.copyrightYear} {CREATOR_ENTITY.fullTitle}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-neutral-200 font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            확인
          </button>
        </div>
      </aside>
    </div>
  );
};
