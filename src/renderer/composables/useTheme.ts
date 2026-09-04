import { ref } from 'vue';
import { AppThemeId, ThemeConfig } from '../../types';

export const THEME_LIST: ThemeConfig[] = [
  {
    id: 'midnight',
    name: '极客深邃',
    nameEn: 'Midnight Cyber',
    description: '经典 Steam 墨蓝沉浸暗夜，天青电光蓝点缀，清晰锐利、低眩光',
    bgHex: '#080c14',
    cardHex: '#101827',
    accentHex: '#38bdf8',
    secondaryHex: '#2dd4bf'
  },
  {
    id: 'neon',
    name: '赛博幻紫',
    nameEn: 'Cyber Neon',
    description: '黑曜石深邃暗紫搭配霓虹粉紫光效，赛博电竞质感，极具未来科幻冲击力',
    bgHex: '#070510',
    cardHex: '#16102c',
    accentHex: '#c084fc',
    secondaryHex: '#f43f5e'
  },
  {
    id: 'emerald',
    name: '翡翠矩阵',
    nameEn: 'Emerald Matrix',
    description: '黑钛幽境暗绿与矩阵荧光薄荷青，黑客终端风格，通透清爽护眼',
    bgHex: '#030a06',
    cardHex: '#0b1c13',
    accentHex: '#34d399',
    secondaryHex: '#06b6d4'
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
