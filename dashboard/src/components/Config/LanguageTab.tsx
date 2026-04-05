import { useTranslation } from 'react-i18next';
import { useLanguage, LANG_LABELS, SUPPORTED_LANGS } from '../../hooks/useLanguage';

export function LanguageTab() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('language.desc')}</p>
      <div className="grid grid-cols-2 gap-2">
        {SUPPORTED_LANGS.map((code) => (
          <button
            key={code}
            className={`px-3 py-2 text-sm rounded border transition-colors cursor-pointer ${
              language === code
                ? 'border-node-user text-node-user bg-node-user/10'
                : 'border-border text-foreground hover:bg-muted'
            }`}
            onClick={() => setLanguage(code)}
          >
            {LANG_LABELS[code]}
          </button>
        ))}
      </div>
    </div>
  );
}
