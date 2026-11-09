import React, { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

export type LegalDrawerTab = 'disclaimer' | 'privacy' | 'opensource' | 'colophon';

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
            className="mt-5 flex items-center gap-5 sm:gap-6 overflow-x-auto no-scrollbar"
            role="tablist"
            aria-label="법적 고지 문서 선택"
          >
            {(
              [
                { id: 'disclaimer', label: 'AI 보안·과금 면책고지' },
                { id: 'privacy', label: '개인정보처리방침' },
                { id: 'opensource', label: '오픈소스 저작권 고지' },
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

          {activeTab === 'opensource' && (
            <div className="space-y-7">
              <div>
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  오픈소스 소프트웨어 저작권 고지 (Open Source Notice)
                </h2>
                <p className="mt-2 text-xs text-neutral-500 tabular-nums">
                  시행일: 2026. 10. 28 · 고지 주체: {CREATOR_ENTITY.fullTitle}
                </p>
              </div>

              <section className="space-y-2.5">
                <h3 className="text-sm font-semibold text-neutral-100">
                  01. 본 애플리케이션 라이선스 (MIT License)
                </h3>
                <p className="text-neutral-400">
                  ‘바이브 행사’는 오픈소스 소프트웨어 생태계의 지식 공유 정신을 바탕으로 구축되었으며, 본 애플리케이션의 핵심 소스 코드는 MIT License 규정에 따라 배포 및 제공됩니다.
                </p>
                <div className="p-3.5 rounded-lg bg-white/[0.03] border border-white/[0.06] font-mono text-xs text-neutral-400 space-y-2 leading-relaxed select-text">
                  <div className="text-neutral-300 font-semibold">
                    Copyright (c) 2026 {CREATOR_ENTITY.fullTitle}
                  </div>
                  <p className="text-[11.5px] text-neutral-400">
                    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
                  </p>
                  <p className="text-[11.5px] text-neutral-400">
                    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
                  </p>
                  <p className="text-[11.5px] text-neutral-500">
                    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-100">
                  02. 사용된 주요 기술 및 오픈소스 라이브러리 고지
                </h3>
                <p className="text-neutral-400">
                  본 서비스는 다음과 같은 검증된 오픈소스 소프트웨어 라이브러리를 활용하여 구현되었으며, 각 라이브러리의 저작권과 라이선스는 해당 원저작자에게 귀속됩니다.
                </p>

                <div className="border border-white/[0.07] rounded-xl overflow-hidden divide-y divide-white/[0.06] text-xs bg-white/[0.015]">
                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">Yjs · y-protocols · lib0</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Kevin Jahns · 적용: 실시간 E2EE CRDT 동시 편집 및 분산 문서 동기화 엔진</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">React & React DOM (v19)</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Meta Platforms, Inc. and affiliates · 적용: 선언적 컴포넌트 기반 리액티브 UI 프레임워크</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">Tailwind CSS (v4)</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Tailwind Labs, Inc. · 적용: 고밀도 옵시디언 다크 테마 디자인 시스템 및 유틸리티 스타일링</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">Lucide Icons (lucide-react)</span>
                      <span className="px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-400 font-mono text-[11px] border border-sky-500/20">ISC License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Lucide Contributors · 적용: 미니멀 벡터 심볼 및 아이코노그래피 시스템</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">fast-xml-parser</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Amit Kumar Gupta · 적용: RFC 4791 표준 CalDAV / WebDAV 다중 상태(Multistatus) XML 고속 파서</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">jsPDF</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: James Hall (Parall-ax) and contributors · 적용: 클라이언트 브라우저 기반 일정 브리핑 및 타임테이블 PDF 렌더링</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">Zod</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Colin McDonnell · 적용: TypeScript 우선 런타임 데이터 스키마 유효성 검증</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">WebLLM (@mlc-ai/web-llm)</span>
                      <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 font-mono text-[11px] border border-purple-500/20">Apache 2.0</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: MLC AI Team · 적용: 브라우저 내부 WebGPU 하드웨어 가속 온디바이스 로컬 AI 추론 엔진</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">Express & ws</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Express Contributors & Einar Otto Stangvik · 적용: E2EE 실시간 협업 룸 웹소켓 중계 및 API 서버</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">web-push</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Marco Castelluccio and contributors · 적용: W3C VAPID 표준 실시간 웹 푸시 알림 전송</p>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">Vite & esbuild</span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] border border-emerald-500/20">MIT License</span>
                    </div>
                    <p className="text-neutral-400 text-[11.5px]">저작자: Evan You & Evan Wallace · 적용: 차세대 초고속 프론트엔드 모듈 번들러 및 빌드 툴</p>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  03. W3C 및 IETF 개방형 표준 프로토콜 준수
                </h3>
                <p className="text-neutral-400">
                  본 애플리케이션은 벤더 종속 없는 지속 가능한 소프트웨어 환경을 위해 다음의 W3C 및 IETF 공식 개방형 웹 표준을 준수합니다.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="p-3 rounded-lg bg-white/[0.025] border border-white/[0.06] space-y-1">
                    <span className="font-semibold text-white block">Web Cryptography API</span>
                    <span className="text-[11.5px] text-neutral-400 block">W3C 표준 하드웨어 가속 AES-256-GCM 볼트 암호화 및 PBKDF2-SHA256 키 유도</span>
                  </div>
                  <div className="p-3 rounded-lg bg-white/[0.025] border border-white/[0.06] space-y-1">
                    <span className="font-semibold text-white block">WebAuthn (FIDO2)</span>
                    <span className="text-[11.5px] text-neutral-400 block">W3C 생체 인증 표준(Face ID · Touch ID · Windows Hello) 패스키 연동</span>
                  </div>
                  <div className="p-3 rounded-lg bg-white/[0.025] border border-white/[0.06] space-y-1">
                    <span className="font-semibold text-white block">RFC 4791 & RFC 5545</span>
                    <span className="text-[11.5px] text-neutral-400 block">IETF CalDAV 및 iCalendar(ICS) 분산 캘린더링 상호운용 표준</span>
                  </div>
                  <div className="p-3 rounded-lg bg-white/[0.025] border border-white/[0.06] space-y-1">
                    <span className="font-semibold text-white block">Service Worker & PWA</span>
                    <span className="text-[11.5px] text-neutral-400 block">W3C PWA 오프라인 캐싱 및 백그라운드 리마인더 동작</span>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  04. 저작권자 권리 보호 및 무보증(AS-IS) 면책
                </h3>
                <p className="text-neutral-400">
                  본 소프트웨어에 포함된 모든 오픈소스 라이브러리의 저작권 및 상표권은 해당 원저작자에게 유보됩니다. 각 오픈소스 소프트웨어는 명시적이거나 묵시적인 어떠한 보증 없이 "있는 그대로(AS-IS)" 제공되며, 사용 중 발생한 직·간접적 손해에 대해 원저작자와 기여자는 책임을 지지 않습니다.
                </p>
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
