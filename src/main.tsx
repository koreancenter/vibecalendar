import {Component, ErrorInfo, ReactNode, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import './i18n';

interface RootErrorBoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends Component<{children: ReactNode}, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen w-screen bg-[#0c0e14] text-neutral-100 flex items-center justify-center p-6 font-sans">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#13161f] p-6 space-y-4">
            <h1 className="text-sm font-semibold text-white">화면을 표시하는 중 오류가 발생했습니다</h1>
            <p className="text-xs text-neutral-400 break-words leading-relaxed">
              {this.state.error.message || '알 수 없는 렌더링 오류'}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3.5 py-2 rounded-lg bg-white text-neutral-950 text-xs font-medium hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                새로고침
              </button>
              <button
                type="button"
                onClick={() => this.setState({error: null})}
                className="px-3.5 py-2 rounded-lg bg-white/[0.06] text-neutral-200 text-xs font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                다시 시도
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    registerSW({immediate: true});
  } else {
    void (async () => {
      try {
        const hadController = Boolean(navigator.serviceWorker.controller);
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        if (hadController && registrations.length > 0) {
          const reloadKey = 'vibe_dev_sw_cleaned_once';
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
          }
        }
      } catch {
        // ignore dev SW cleanup errors
      }
    })();
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
