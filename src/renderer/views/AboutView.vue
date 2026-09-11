<template>
  <div class="h-full flex flex-col p-5 xl:p-7 overflow-hidden space-y-5">
    <!-- 顶部品牌 Header -->
    <div class="flex items-center justify-between gap-4 pb-4 border-b border-white/10 flex-wrap shrink-0">
      <div class="flex items-center gap-3.5">
        <div class="w-12 h-12 rounded-2xl overflow-hidden bg-slate-950/40 border border-white/10 shadow-lg shrink-0">
          <img :src="appLogo" alt="春风渡" class="w-full h-full object-cover" draggable="false" />
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-lg font-black tracking-wide text-slate-100">关于春风渡</h1>
            <span class="text-xs px-2.5 py-0.5 rounded-full theme-btn-primary text-slate-950 font-mono font-bold shadow-sm">
              v{{ appVersion }}
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-0.5">极速入库 · 联机生态引擎 · 专为 Steam 玩家打造的高性能工具</p>
        </div>
      </div>

      <div class="flex items-center gap-2.5 flex-wrap">
        <button
          @click="handleOpenSponsorLink"
          class="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-200 border border-rose-500/30 transition flex items-center gap-2 text-xs font-bold cursor-pointer shadow-sm active:scale-95"
          title="前往爱发电支持春风渡"
        >
          <HeartHandshake class="w-4 h-4 text-rose-400" />
          <span>在爱发电支持我们</span>
          <ExternalLink class="w-3.5 h-3.5 opacity-75" />
        </button>

        <button
          @click="handleOpenFeedback"
          class="px-3.5 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 hover:text-sky-200 border border-sky-500/25 transition flex items-center gap-2 text-xs font-bold cursor-pointer"
          title="加入官方 QQ 交流反馈群"
        >
          <MessageSquare class="w-3.5 h-3.5 text-sky-400" />
          <span>加入交流群</span>
        </button>

        <button
          @click="checkUpdates"
          :disabled="isCheckingUpdate"
          class="px-3.5 py-2 btn-soft-action rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
        >
          <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': isCheckingUpdate }" />
          <span>{{ isCheckingUpdate ? '正在检查...' : '检查更新' }}</span>
        </button>

        <button
          @click="emit('open-disclaimer')"
          class="px-3.5 py-2 theme-btn-primary rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer"
        >
          <ShieldAlert class="w-3.5 h-3.5" />
          <span>免责声明</span>
        </button>
      </div>
    </div>

    <!-- 主体双栏内容区域 (左侧更新日志，右侧赞助榜单) -->
    <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0 overflow-hidden">
      
      <!-- ==================== 左侧：更新日志 (5/12 列) ==================== -->
      <section class="lg:col-span-6 xl:col-span-6 flex flex-col theme-card rounded-3xl p-5 overflow-hidden shadow-lg border border-white/10">
        <!-- 栏目标题与操作 -->
        <div class="flex items-center justify-between pb-3.5 mb-3 border-b border-white/5 shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center text-sky-400">
              <Sparkles class="w-4 h-4" />
            </div>
            <div>
              <h2 class="text-sm font-black text-slate-100 flex items-center gap-2">
                <span>更新日志</span>
                <span class="text-[11px] font-normal text-slate-400 font-mono">Changelog</span>
              </h2>
              <p class="text-[11px] text-slate-400">记录春风渡历代版本进化历程</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-950/60 border border-white/10 text-slate-300">
              当前: v{{ appVersion }}
            </span>
            <button
              @click="loadChangelogs"
              :disabled="loadingChangelogs"
              class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              title="刷新更新日志"
            >
              <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': loadingChangelogs }" />
            </button>
          </div>
        </div>

        <!-- 时间轴列表 (垂直滚动) -->
        <div class="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
          <div
            v-for="(ver, idx) in changelogs"
            :key="ver.version || idx"
            class="relative pl-6 pb-2 group"
          >
            <!-- 时间线左侧竖线与节点圆点 -->
            <div
              v-if="idx !== changelogs.length - 1"
              class="absolute left-2.5 top-6 bottom-0 w-0.5 bg-slate-800 group-hover:bg-sky-500/40 transition-colors"
            ></div>
            <div
              class="absolute left-1 top-2.5 w-3.5 h-3.5 rounded-full border-2 transition-transform group-hover:scale-125"
              :class="idx === 0 
                ? 'bg-sky-400 border-sky-200 shadow-md shadow-sky-500/50' 
                : 'bg-slate-900 border-slate-600 group-hover:border-sky-400'"
            ></div>

            <!-- 版本卡片 -->
            <div class="p-4 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-white/15 transition space-y-2.5">
              <!-- 卡片头部：版本号 + 标签 + 发布日期 -->
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <span class="font-mono font-black text-sm text-slate-100">v{{ ver.version }}</span>
                  <span
                    v-if="idx === 0"
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                  >
                    最新版本
                  </span>
                  <span
                    v-if="ver.forceUpdate"
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25"
                  >
                    重大更新
                  </span>
                </div>
                <span class="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                  <Calendar class="w-3 h-3 text-slate-500" />
                  <span>{{ ver.releaseDate }}</span>
                </span>
              </div>

              <!-- 版本标题 -->
              <div v-if="ver.title" class="text-xs font-bold text-slate-200">
                {{ ver.title }}
              </div>

              <!-- 更新要点条目 -->
              <ul class="space-y-1.5 pt-1 text-xs text-slate-300">
                <li
                  v-for="(item, cIdx) in ver.changelog"
                  :key="cIdx"
                  class="flex items-start gap-2 leading-relaxed text-[11.5px]"
                >
                  <span class="text-sky-400 font-bold shrink-0 mt-0.5">•</span>
                  <span class="text-slate-300">{{ item }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- ==================== 右侧：爱发电赞助榜单 (6/12 列) ==================== -->
      <section class="lg:col-span-6 xl:col-span-6 flex flex-col theme-card rounded-3xl p-5 overflow-hidden shadow-lg border border-white/10">
        <!-- 栏目标题与同步操作 -->
        <div class="flex items-center justify-between pb-3.5 mb-3 border-b border-white/5 shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400">
              <Heart class="w-4 h-4" />
            </div>
            <div>
              <h2 class="text-sm font-black text-slate-100 flex items-center gap-2">
                <span>爱发电赞助榜</span>
                <span class="text-[11px] font-normal text-slate-400 font-mono">Sponsor Hall</span>
              </h2>
              <p class="text-[11px] text-slate-400">感谢每一位支持春风渡开源生态的伙伴</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="handleSyncAfdian"
              :disabled="syncingAfdian"
              class="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 transition flex items-center gap-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-60"
              title="立即从爱发电自动拉取最新赞助榜"
            >
              <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': syncingAfdian }" />
              <span>{{ syncingAfdian ? '正在同步...' : '自动刷新' }}</span>
            </button>
          </div>
        </div>

        <!-- 统计面板大盘卡片 -->
        <div class="p-3.5 rounded-2xl bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-sky-500/10 border border-white/10 mb-3.5 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-4">
            <div>
              <div class="text-[11px] text-slate-400">累计赞助人次</div>
              <div class="text-lg font-black text-rose-400 font-mono mt-0.5">
                {{ sponsorsData.totalCount || 0 }} <span class="text-xs font-normal text-slate-400">位</span>
              </div>
            </div>
            <div class="h-8 w-px bg-white/10"></div>
            <div>
              <div class="text-[11px] text-slate-400">累计支持金额</div>
              <div class="text-lg font-black text-amber-400 font-mono mt-0.5">
                ¥{{ (sponsorsData.totalAmount || 0).toFixed(2) }}
              </div>
            </div>
          </div>

          <div class="text-right">
            <div class="flex items-center justify-end gap-1.5 text-[10.5px] text-slate-300 font-medium">
              <span class="w-2 h-2 rounded-full" :class="sponsorsData.source === 'afdian' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'"></span>
              <span>{{ sponsorsData.source === 'afdian' ? '爱发电官方实时同步' : '官方赞助榜' }}</span>
            </div>
            <div class="text-[10px] font-mono text-slate-500 mt-0.5">
              更新于: {{ formatUpdatedDate(sponsorsData.updatedAt) }}
            </div>
          </div>
        </div>

        <!-- 赞助者列表 (有赞助数据时展示) -->
        <div
          v-if="sponsorsData.sponsors && sponsorsData.sponsors.length > 0"
          class="flex-1 overflow-y-auto pr-1 space-y-2.5 custom-scrollbar"
        >
          <div
            v-for="(sponsor, index) in sponsorsData.sponsors"
            :key="sponsor.id || index"
            class="p-3 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-rose-500/30 transition flex items-center justify-between gap-3 group"
          >
            <!-- 排名与赞助者信息 -->
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <!-- 排名勋章 -->
              <div
                class="w-7 h-7 rounded-xl flex items-center justify-center font-mono font-black text-xs shrink-0 shadow-sm"
                :class="getRankBadgeClass(sponsor.rank || index + 1)"
              >
                <Crown v-if="(sponsor.rank || index + 1) === 1" class="w-4 h-4 text-amber-300 fill-amber-300" />
                <Medal v-else-if="(sponsor.rank || index + 1) === 2" class="w-4 h-4 text-slate-200" />
                <Medal v-else-if="(sponsor.rank || index + 1) === 3" class="w-4 h-4 text-amber-600" />
                <span v-else>{{ sponsor.rank || index + 1 }}</span>
              </div>

              <!-- 头像 (带加载兜底与渐变首字母) -->
              <div class="w-9 h-9 rounded-xl overflow-hidden bg-slate-800 border border-white/10 shrink-0 relative flex items-center justify-center text-xs font-bold text-slate-200">
                <img
                  v-if="sponsor.avatar && !avatarErrors[sponsor.id]"
                  :src="sponsor.avatar"
                  :alt="sponsor.name"
                  @error="onAvatarError(sponsor.id)"
                  class="w-full h-full object-cover"
                  draggable="false"
                />
                <span v-else class="bg-gradient-to-tr from-rose-500 to-indigo-500 w-full h-full flex items-center justify-center text-white font-bold">
                  {{ (sponsor.name || 'S').slice(0, 1).toUpperCase() }}
                </span>
              </div>

              <!-- 昵称与身份标识 -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-xs text-slate-100 truncate max-w-[130px] xl:max-w-[180px]">
                    {{ sponsor.name }}
                  </span>
                  <span
                    class="text-[10px] px-2 py-0.5 rounded-full font-medium border shrink-0"
                    :class="getPlanBadgeClass(sponsor)"
                  >
                    {{ sponsor.planTitle || (sponsor.isLifetime ? '终身赞助者' : '爱心支持') }}
                  </span>
                </div>
                <div v-if="sponsor.comment" class="text-[11px] text-slate-400 truncate mt-0.5 italic">
                  “{{ sponsor.comment }}”
                </div>
                <div v-else class="text-[10px] font-mono text-slate-500 mt-0.5">
                  赞助日期: {{ sponsor.lastPayTime || '—' }}
                </div>
              </div>
            </div>

            <!-- 赞助金额与支持标志 -->
            <div class="text-right shrink-0">
              <div class="font-mono font-black text-xs text-rose-400">
                ¥{{ (sponsor.allSumAmount || 0).toFixed(2) }}
              </div>
              <div class="text-[10px] text-slate-400 mt-0.5">
                发电贡献
              </div>
            </div>
          </div>
        </div>

        <!-- 暂无赞助者优雅空状态 -->
        <div
          v-else
          class="flex-1 flex flex-col items-center justify-center p-6 text-center rounded-2xl bg-slate-950/30 border border-white/5 space-y-4 my-auto min-h-[260px]"
        >
          <div class="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shadow-inner">
            <Heart class="w-7 h-7 text-rose-400/80 animate-pulse" />
          </div>
          <div class="space-y-1.5 max-w-sm">
            <div class="text-sm font-bold text-slate-100">当前暂无赞助记录</div>
            <p class="text-xs text-slate-400 leading-relaxed">
              开源与服务器维护不易，期待您的支持！赞助支持后，榜单将自动同步您的昵称与赞助寄语。
            </p>
          </div>
          <button
            @click="handleOpenSponsorLink"
            class="px-5 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-bold text-xs shadow-lg shadow-rose-500/20 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Heart class="w-3.5 h-3.5 fill-current" />
            <span>成为第一位赞助者</span>
          </button>
        </div>

        <!-- 底部引导支持卡片 -->
        <div class="pt-3 mt-2 border-t border-white/5 shrink-0 flex items-center justify-between text-xs">
          <span class="text-[11px] text-slate-400 flex items-center gap-1.5">
            <HeartHandshake class="w-3.5 h-3.5 text-rose-400" />
            <span>赞助后榜单自动更新</span>
          </span>

          <button
            @click="handleOpenSponsorLink"
            class="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs transition shadow-md shadow-rose-600/30 flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <span>我要赞助</span>
            <ExternalLink class="w-3 h-3" />
          </button>
        </div>
      </section>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { APP_CONFIG } from '../../config/appConfig';
import { formatIpcError } from '../api/tauriBridge';
import type { SponsorItem, SponsorDataResponse, VersionChangelogItem } from '../../types';
import appLogo from '../assets/logo.svg';
import {
  RotateCw,
  ShieldAlert,
  Sparkles,
  Heart,
  HeartHandshake,
  Calendar,
  Crown,
  Medal,
  ExternalLink,
  MessageSquare
} from 'lucide-vue-next';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'open-disclaimer'): void;
  (e: 'show-version-modal', modal: any): void;
}>();

const appVersion = APP_CONFIG.VERSION;
const isCheckingUpdate = ref(false);
const loadingChangelogs = ref(false);
const syncingAfdian = ref(false);

// 头像加载错误记录
const avatarErrors = reactive<Record<string, boolean>>({});
const onAvatarError = (id: string) => {
  avatarErrors[id] = true;
};

// 服务端下发链接
const appLinks = ref<{ tutorialUrl: string; faqUrl: string; qqGroupUrl: string; sponsorUrl: string }>({
  tutorialUrl: '',
  faqUrl: '',
  qqGroupUrl: '',
  sponsorUrl: ''
});

// 版本更新日志
const changelogs = ref<VersionChangelogItem[]>([]);

// 赞助榜单数据
const sponsorsData = ref<SponsorDataResponse>({
  totalCount: 0,
  totalAmount: 0,
  updatedAt: new Date().toISOString().slice(0, 10),
  source: 'cache',
  sponsors: []
});

const formatUpdatedDate = (dt: string) => {
  if (!dt) return '刚刚';
  try {
    return dt.slice(0, 10);
  } catch {
    return dt;
  }
};

const getRankBadgeClass = (rank: number) => {
  if (rank === 1) return 'bg-amber-400/20 text-amber-300 border border-amber-400/50';
  if (rank === 2) return 'bg-slate-300/20 text-slate-200 border border-slate-300/40';
  if (rank === 3) return 'bg-amber-700/25 text-amber-500 border border-amber-600/40';
  return 'bg-slate-900 text-slate-400 border border-white/5';
};

const getPlanBadgeClass = (sponsor: SponsorItem) => {
  if (sponsor.isLifetime || (sponsor.planTitle && sponsor.planTitle.includes('终身'))) {
    return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  }
  if (sponsor.planTitle && sponsor.planTitle.includes('豪华')) {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
  if (sponsor.planTitle && sponsor.planTitle.includes('月度')) {
    return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  }
  return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
};

const activeSponsorUrl = computed(() => {
  return (
    (appLinks.value.sponsorUrl && appLinks.value.sponsorUrl.trim()) ||
    (sponsorsData.value.sponsorUrl && sponsorsData.value.sponsorUrl.trim()) ||
    ''
  );
});

const loadAppLinks = async () => {
  try {
    const links = await window.electronAPI.getAppLinks();
    if (links) {
      appLinks.value = {
        tutorialUrl: (links.tutorialUrl || '').trim(),
        faqUrl: (links.faqUrl || '').trim(),
        qqGroupUrl: (links.qqGroupUrl || '').trim(),
        sponsorUrl: (links.sponsorUrl || '').trim()
      };
    }
  } catch (e) {
    console.warn('获取跳转链接失败:', e);
  }
};

const loadChangelogs = async () => {
  loadingChangelogs.value = true;
  try {
    const logs = await window.electronAPI.getVersionChangelogs();
    if (logs && logs.length > 0) {
      changelogs.value = logs;
    }
  } catch (e) {
    console.warn('加载更新日志异常:', e);
  } finally {
    loadingChangelogs.value = false;
  }
};

const isMockSponsor = (s: SponsorItem): boolean => {
  if (!s) return true;
  const mockNames = [
    '星海漫游者', '云水禅心', 'CyberSamurai', '极光幻梦', '风之诺言',
    '秋水长天', 'NightOwl_99', '浮生若梦', '代码写到天亮', 'Steam重度爱好者'
  ];
  return mockNames.includes(s.name) || /^af_(top\d+|\d+)$/.test(s.id || '');
};

const sanitizeSponsorState = (data: SponsorDataResponse): SponsorDataResponse => {
  if (!data) {
    return {
      totalCount: 0,
      totalAmount: 0,
      updatedAt: new Date().toISOString().slice(0, 10),
      source: 'afdian',
      sponsorUrl: '',
      sponsors: []
    };
  }
  const realSponsors = (data.sponsors || []).filter(s => !isMockSponsor(s));
  const realAmount = realSponsors.reduce((sum, item) => sum + (item.allSumAmount || 0), 0);
  return {
    ...data,
    totalCount: realSponsors.length,
    totalAmount: Math.round(realAmount * 100) / 100,
    source: data.source || 'afdian',
    sponsorUrl: typeof data.sponsorUrl === 'string' ? data.sponsorUrl.trim() : '',
    sponsors: realSponsors
  };
};

const loadSponsors = async () => {
  try {
    const data = await window.electronAPI.getSponsors();
    if (data) {
      const sanitized = sanitizeSponsorState(data);
      sponsorsData.value = sanitized;
      if (sanitized.sponsorUrl && !appLinks.value.sponsorUrl) {
        appLinks.value.sponsorUrl = sanitized.sponsorUrl;
      }
    }
  } catch (e) {
    console.warn('加载赞助榜单异常:', e);
  }
};

const handleSyncAfdian = async () => {
  syncingAfdian.value = true;
  try {
    const res = await window.electronAPI.syncAfdianSponsors();
    if (res.success) {
      emit('notify', res.message || '爱发电赞助榜单同步成功！', 'success');
    } else {
      emit('notify', res.message || '同步未完成，已刷新本地榜单', 'warning');
    }
    await Promise.all([loadSponsors(), loadAppLinks()]);
  } catch (e: any) {
    emit('notify', '爱发电同步异常: ' + formatIpcError(e), 'error');
  } finally {
    syncingAfdian.value = false;
  }
};

const handleOpenSponsorLink = async () => {
  const url = activeSponsorUrl.value;
  if (!url) {
    emit('notify', '暂未配置赞助支持链接，感谢您的心意与支持！', 'info');
    return;
  }
  try {
    await window.electronAPI.openExternalUrl(url);
    emit('notify', '正在打开赞助支持页面...', 'info');
  } catch (e: any) {
    emit('notify', '打开外部链接失败: ' + formatIpcError(e), 'error');
  }
};

const handleOpenFeedback = async () => {
  const url = appLinks.value.qqGroupUrl && appLinks.value.qqGroupUrl.trim();
  if (url) {
    try {
      await window.electronAPI.openExternalUrl(url);
      emit('notify', '正在打开 QQ 反馈交流群链接...', 'info');
    } catch (e: any) {
      emit('notify', '打开外部链接失败: ' + formatIpcError(e), 'error');
    }
  } else {
    emit('notify', '官方 QQ 反馈群暂未配置，请稍后重试', 'warning');
  }
};

const checkUpdates = async () => {
  isCheckingUpdate.value = true;
  try {
    const res = await window.electronAPI.checkVersion(appVersion);
    if (res && res.hasUpdate && res.latest?.version) {
      emit('show-version-modal', res);
      emit('notify', `发现新版本 v${res.latest.version}，已为您打开更新窗口！`, 'info');
    } else {
      emit('notify', '当前已是最新版本 (v' + appVersion + ')！', 'success');
    }
  } catch (e: any) {
    emit('notify', '检查更新失败: ' + formatIpcError(e), 'warning');
  } finally {
    isCheckingUpdate.value = false;
  }
};

onMounted(() => {
  try {
    const cached = localStorage.getItem('cfd_sponsors_cache');
    if (cached && (cached.includes('星海漫游者') || cached.includes('1805') || cached.includes('chunfengdu') || cached.includes('afdian.com'))) {
      localStorage.removeItem('cfd_sponsors_cache');
    }
    const cachedLogs = localStorage.getItem('cfd_changelogs_cache');
    if (cachedLogs && cachedLogs.includes('新版本')) {
      localStorage.removeItem('cfd_changelogs_cache');
    }
  } catch {}
  loadAppLinks();
  loadChangelogs();
  loadSponsors();
});
</script>
