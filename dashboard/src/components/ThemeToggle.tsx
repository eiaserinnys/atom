import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
      title={theme === 'dark' ? t('app.theme_to_light') : t('app.theme_to_dark')}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
