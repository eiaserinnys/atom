import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGS, type SupportedLang } from '../i18n';

export const LANG_LABELS: Record<SupportedLang, string> = {
  en: 'English',
  ko: '한국어',
  zh: '中文',
  ja: '日本語',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  ru: 'Русский',
  pt: 'Português',
};

export { SUPPORTED_LANGS };

export function useLanguage() {
  const { i18n } = useTranslation();
  const setLanguage = (lang: SupportedLang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  };
  return { language: i18n.language as SupportedLang, setLanguage };
}
