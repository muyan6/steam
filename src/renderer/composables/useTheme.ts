import { ref } from 'vue';
import { AppThemeId, ThemeConfig } from '../../types';

export const THEME_LIST: ThemeConfig[] = [
  // 3 套高端深色主题
  {
    id: 'midnight',
    name: '极光钛蓝',
    nameEn: 'Titanium Sapphire',
    type: 'dark',
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
    type: 'dark',
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
    type: 'dark',
    description: '钛金墨玉底色搭配铂金荧光薄荷绿，清新雅致，通透护眼，极具高科技质感',
    bgHex: '#0b1814',
    cardHex: '#17322a',
    accentHex: '#34d399',
    secondaryHex: '#22d3ee'
  },

  // 3 套高雅浅色主题
  {
    id: 'frost',
    name: '极简皓月',
    nameEn: 'Frost Platinum',
    type: 'light',
    description: '纯净通透银霜白底色搭配冰晶蔚蓝与天青色，极简现代，明亮纯粹',
    bgHex: '#f1f5f9',
    cardHex: '#ffffff',
    accentHex: '#0284c7',
    secondaryHex: '#06b6d4'
  },
  {
    id: 'dawn',
    name: '香槟晨曦',
    nameEn: 'Champagne Dawn',
    type: 'light',
    description: '暖意温润的香槟暖白底色搭配奢华琥珀金与暮色玫红，典雅轻奢，质感温润',
    bgHex: '#faf7f2',
    cardHex: '#ffffff',
    accentHex: '#d97706',
    secondaryHex: '#e11d48'
  },
  {
    id: 'mint',
    name: '薄荷清风',
    nameEn: 'Mint Breeze',
    type: 'light',
    description: '清爽淡雅的森林薄荷白底色搭配翡翠绿与海洋青，清新自然，舒适护眼',
    bgHex: '#f0fdf4',
    cardHex: '#ffffff',
    accentHex: '#059669',
    secondaryHex: '#0284c7'
  }
];

const currentTheme = ref<AppThemeId>('midnight');

export function useTheme() {
  const initTheme = () => {
    const saved = localStorage.getItem('app_theme') as AppThemeId;
    if (saved && THEME_LIST.some(t => t.id === saved)) {
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
