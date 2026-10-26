import { useLanguage, LANG_LABELS, SUPPORTED_LANGS } from '../../hooks/useLanguage';

export function LanguageTab() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {SUPPORTED_LANGS.map((code) => (
          <button
            key={code}
            className={`px-3 py-2 text-sm rounded-none border transition-colors cursor-pointer ${
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
