import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';
import ko from './locales/ko/translation.json';
import zh from './locales/zh/translation.json';
import ja from './locales/ja/translation.json';
import es from './locales/es/translation.json';
import de from './locales/de/translation.json';
import fr from './locales/fr/translation.json';
import ru from './locales/ru/translation.json';
import pt from './locales/pt/translation.json';

export const SUPPORTED_LANGS = ['en', 'ko', 'zh', 'ja', 'es', 'de', 'fr', 'ru', 'pt'] as const;
export type SupportedLang = typeof SUPPORTED_LANGS[number];

function getInitialLanguage(): SupportedLang {
  const stored = localStorage.getItem('language') as SupportedLang | null;
  if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) return stored;
  const browserLang = navigator.language.split('-')[0] as SupportedLang;
  return (SUPPORTED_LANGS as readonly string[]).includes(browserLang) ? browserLang : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ko: { translation: ko },
    zh: { translation: zh },
    ja: { translation: ja },
    es: { translation: es },
    de: { translation: de },
    fr: { translation: fr },
    ru: { translation: ru },
    pt: { translation: pt },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
