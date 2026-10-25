import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="index-action w-8 h-8 !p-0 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      title={theme === 'dark' ? t('app.theme_to_light') : t('app.theme_to_dark')}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" strokeWidth={1.75} /> : <Moon className="w-4 h-4" strokeWidth={1.75} />}
    </button>
  );
}
