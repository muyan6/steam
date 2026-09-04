import { ref } from 'vue';
import { AppThemeId, ThemeConfig } from '../../types';

export const THEME_LIST: ThemeConfig[] = [
  {
    id: 'midnight',
    name: '极光钛蓝',
    nameEn: 'Titanium Sapphire',
    description: '深邃高奢钛蓝与冰晶电光蓝，现代工作室旗舰质感，通透明亮，视野清晰',
    bgHex: '#0f1624',
    cardHex: '#1b263b',
    accentHex: '#38bdf8',
    secondaryHex: '#2dd4bf'
  },
  {
    id: 'neon',
    name: '幻曜紫晶',
    nameEn: 'Amethyst Velvet',
    description: '奢华曜紫丝绒搭配极光粉紫微光，高端电竞赛博沉浸感，质感非凡',
    bgHex: '#130f24',
    cardHex: '#231b40',
    accentHex: '#c084fc',
    secondaryHex: '#f43f5e'
  },
  {
    id: 'emerald',
    name: '皓月翡翠',
    nameEn: 'Emerald Platinum',
    description: '钛金墨玉底色搭配铂金荧光薄荷绿，清新雅致，通透护眼，极具高科技质感',
    bgHex: '#0b1814',
    cardHex: '#17322a',
    accentHex: '#34d399',
    secondaryHex: '#22d3ee'
  }
];

const currentTheme = ref<AppThemeId>('midnight');

export function useTheme() {
  const initTheme = () => {
    const saved = localStorage.getItem('app_theme') as AppThemeId;
    if (saved && (saved === 'midnight' || saved === 'neon' || saved === 'emerald')) {
      currentTheme.value = saved;
    } else {
      currentTheme.value = 'midnight';
    }
    applyTheme(currentTheme.value);
  };

  const applyTheme = (themeId: AppThemeId) => {
    currentTheme.value = themeId;
    localStorage.setItem('app_theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId);
  };

  const setTheme = (themeId: AppThemeId) => {
    applyTheme(themeId);
  };

  return {
    currentTheme,
    THEME_LIST,
    initTheme,
    setTheme
  };
}
