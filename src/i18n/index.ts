import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { ko } from './locales/ko';
import { en } from './locales/en';
import { ja } from './locales/ja';

export const SUPPORTED_LANGUAGES = [
  { code: 'ko', label: '한국어', shortLabel: 'KO' },
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'ja', label: '日本語', shortLabel: 'JA' },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const defaultNS = 'common';
export const resources = {
  ko,
  en,
  ja,
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ko',
    defaultNS: 'common',
    ns: ['common', 'calendar', 'vault', 'agent'],
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'vibe_user_locale',
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
