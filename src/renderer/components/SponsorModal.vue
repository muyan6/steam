<template>
  <div class="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all duration-300">
    <div
      class="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
    >
      <!-- 弹窗顶部栏 -->
      <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <HeartHandshake class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>赞助支持与开发说明</span>
              <span
                class="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border"
                :class="licenseInfo.isActivated ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-slate-800 text-slate-400 border-white/10'"
              >
                {{ licenseInfo.isActivated ? (licenseInfo.isLifetime ? '终身赞助者' : '赞助者') : '普通用户' }}
              </span>
            </h3>
            <p class="text-[11px] text-slate-400">理性赞助 · 共同维护开源生态</p>
          </div>
        </div>
        <button
          @click="emit('close')"
          class="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition flex items-center justify-center text-sm cursor-pointer"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- 弹窗主体说明 -->
      <div class="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs">
        <!-- 重点提示卡片 -->
        <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 space-y-2">
          <div class="flex items-center gap-2 text-rose-300 font-bold text-xs">
            <Info class="w-4 h-4 text-rose-400 shrink-0" />
            <span>关于赞助支持的一点重要说明</span>
          </div>
          <p class="text-[11.5px] text-slate-300 leading-relaxed">
            赞助本项目<strong class="text-rose-300 font-semibold">只会解锁每日游戏入库数量上限</strong>，<strong class="text-rose-300 font-semibold">绝无任何其它专属付费特权或隐藏功能</strong>。
          </p>
          <p class="text-[11.5px] text-slate-300 leading-relaxed">
            我们希望你是为了<span class="text-amber-300 font-semibold">认可开发者的付出、自愿支持服务器日常开销与项目维护</span>而赞助，而不是为了追求功能差异。核心入库及全部工具生态对所有用户始终完全免费开放。
          </p>
        </div>

        <!-- 需求与反馈提示卡片 -->
        <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/5 space-y-2">
          <div class="flex items-center gap-2 text-sky-300 font-bold text-xs">
            <MessageSquare class="w-4 h-4 text-sky-400 shrink-0" />
            <span>需要新功能或遇到问题？</span>
          </div>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            如果你在使用过程中有任何需要的新功能、改善建议，或者遇到了 Bug：
          </p>
          <div class="flex items-center gap-3 pt-1">
            <button
              @click="handleGoToAbout"
              class="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition flex items-center gap-1.5 text-[11px] cursor-pointer"
            >
              <FileText class="w-3.5 h-3.5 text-sky-400" />
              <span>前往「关于」页面</span>
            </button>
            <button
              v-if="qqGroupUrl"
              @click="handleOpenQQGroup"
              class="px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/25 transition flex items-center gap-1.5 text-[11px] cursor-pointer"
            >
              <MessageSquare class="w-3.5 h-3.5 text-sky-400" />
              <span>加入 QQ 交流反馈群</span>
            </button>
          </div>
        </div>

        <!-- 激活码输入快捷区域 (解答用户在哪里输入激活码的问题) -->
        <div class="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-amber-300 font-bold text-xs">
              <Key class="w-4 h-4 text-amber-400 shrink-0" />
              <span>已有赞助码 / 卡密？在此输入激活</span>
            </div>
            <button
              @click="handleOpenFullLicenseModal"
              class="text-[11px] text-sky-400 hover:text-sky-300 transition flex items-center gap-1 cursor-pointer"
              title="打开包含设备识别码、换机迁移等完整绑定的窗口"
            >
              <span>设备绑定设置</span>
              <span>➔</span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <input
              v-model="activationCodeInput"
              type="text"
              placeholder="例如: CFD-L-XXXX-XXXX"
              class="flex-1 bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-100 uppercase tracking-widest focus:outline-none focus:border-amber-400/80 focus:ring-1 focus:ring-amber-400/30"
              @keydown.enter="handleActivateInline"
            />
            <button
              @click="handleActivateInline"
              :disabled="activating || !activationCodeInput.trim()"
              class="theme-btn-primary px-4 py-2.5 rounded-xl font-bold text-xs disabled:opacity-50 transition shadow flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <RotateCw v-if="activating" class="w-3.5 h-3.5 animate-spin" />
              <Zap v-else class="w-3.5 h-3.5" />
              <span>{{ activating ? '激活中…' : '立即激活' }}</span>
            </button>
          </div>
          <p class="text-[10.5px] text-slate-500 leading-tight">
            赞助完成后获得的卡密支持在此直接粘贴激活，激活后与本机硬件绑定并享受无上限入库。
          </p>
        </div>
      </div>

      <!-- 弹窗底部操作栏 -->
      <div class="px-6 py-4 border-t border-white/5 flex items-center justify-between bg-slate-950/40">
        <button
          @click="emit('close')"
          class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white font-medium rounded-xl text-xs transition border border-white/10 cursor-pointer"
        >
          我知道了
        </button>

        <button
          @click="handleOpenSponsorPage"
          class="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white font-bold rounded-xl text-xs transition shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer"
        >
          <HeartHandshake class="w-4 h-4 stroke-[2.5]" />
          <span>前往赞助支持页面</span>
          <ExternalLink class="w-3.5 h-3.5 opacity-80" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  HeartHandshake,
  X,
  Info,
  MessageSquare,
  FileText,
  Key,
  RotateCw,
  Zap,
  ExternalLink
} from 'lucide-vue-next';
import { ClientLicenseInfo } from '../../types';
import { formatIpcError } from '../api/tauriBridge';

const props = defineProps<{
  licenseInfo: ClientLicenseInfo;
  sponsorUrl?: string;
  qqGroupUrl?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
  (e: 'switch-tab', tab: string): void;
  (e: 'open-license-modal'): void;
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const activationCodeInput = ref('');
const activating = ref(false);

const handleOpenSponsorPage = async () => {
  const url = props.sponsorUrl && props.sponsorUrl.trim();
  if (url) {
    try {
      await window.electronAPI.openExternalUrl(url);
      emit('notify', '正在浏览器中打开赞助支持页面...', 'info');
    } catch (e: any) {
      emit('notify', '打开外部链接失败: ' + formatIpcError(e), 'error');
    }
  } else {
    emit('notify', '暂未配置赞助链接，感谢您的心意与支持！', 'info');
  }
};

const handleOpenQQGroup = async () => {
  const url = props.qqGroupUrl && props.qqGroupUrl.trim();
  if (url) {
    try {
      await window.electronAPI.openExternalUrl(url);
      emit('notify', '正在打开 QQ 反馈交流群链接...', 'info');
    } catch (e: any) {
      emit('notify', '打开链接失败: ' + formatIpcError(e), 'error');
    }
  } else {
    emit('notify', 'QQ 反馈群暂未配置，请在「关于」页面查看联系方式', 'info');
  }
};

const handleGoToAbout = () => {
  emit('close');
  emit('switch-tab', 'about');
};

const handleOpenFullLicenseModal = () => {
  emit('close');
  emit('open-license-modal');
};

const handleActivateInline = async () => {
  const code = activationCodeInput.value.trim().toUpperCase();
  if (!code) {
    emit('notify', '请输入赞助码后再点击绑定', 'warning');
    return;
  }

  activating.value = true;
  try {
    const res = await window.electronAPI.activateLicense(code);
    if (res.success) {
      emit('notify', res.message || '恭喜，赞助码绑定成功！', 'success');
      activationCodeInput.value = '';
      emit('refresh');
    } else {
      emit('notify', res.message || '激活失败，请检查卡密输入', 'error');
    }
  } catch (e: any) {
    emit('notify', '激活异常: ' + formatIpcError(e), 'error');
  } finally {
    activating.value = false;
  }
};
</script>
