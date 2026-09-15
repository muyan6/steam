<template>
  <div class="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all duration-300">
    <div
      class="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
    >
      <!-- 弹窗顶部栏 -->
      <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <Heart class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>软件授权与设备绑定</span>
              <span
                class="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border"
                :class="getLicenseBadgeClass(licenseInfo.status, licenseInfo.type)"
              >
                {{ getLicenseStatusText(licenseInfo) }}
              </span>
            </h3>
            <p class="text-[11px] text-slate-400">本机硬件指纹 · 一机一码绑定</p>
          </div>
        </div>
        <button
          @click="emit('close')"
          class="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition flex items-center justify-center text-sm"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- 标签页切换：激活码 / 邀请有礼 -->
      <div class="px-6 pt-3 pb-1 flex items-center gap-2 bg-slate-950/20 border-b border-white/5">
        <button
          @click="activeTab = 'license'"
          class="px-4 py-2 rounded-t-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
          :class="activeTab === 'license'
            ? 'bg-slate-900 text-amber-300 border border-white/10 border-b-transparent'
            : 'text-slate-400 hover:text-slate-200 border border-transparent'"
        >
          <Key class="w-3.5 h-3.5" />
          <span>激活码绑定</span>
        </button>
        <button
          @click="switchToInviteTab"
          class="px-4 py-2 rounded-t-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
          :class="activeTab === 'invite'
            ? 'bg-slate-900 text-rose-300 border border-white/10 border-b-transparent'
            : 'text-slate-400 hover:text-slate-200 border border-transparent'"
        >
          <Gift class="w-3.5 h-3.5" />
          <span>邀请有礼</span>
          <span
            v-if="inviteStatus && inviteStatus.invitedCount > 0"
            class="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/25 font-mono"
          >{{ inviteStatus.invitedCount }}</span>
        </button>
      </div>

      <!-- ==================== 标签页 1：激活码绑定 ==================== -->
      <div v-show="activeTab === 'license'" class="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
        <!-- 1. 本机唯一设备识别码 (Device ID) -->
        <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/5 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <Laptop class="w-3.5 h-3.5 text-sky-400" />
              <span>本机唯一设备码 (Device ID)</span>
            </span>
            <span class="text-[10px] text-slate-400 font-mono">硬件注册表唯一指纹</span>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-900/90 px-3.5 py-2.5 rounded-xl border border-white/10 font-mono text-xs text-sky-300 font-bold select-all tracking-wider break-all">
              {{ deviceId || '正在获取设备特征码...' }}
            </div>
            <button
              @click="handleCopyDeviceId"
              class="px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 font-medium rounded-xl border border-white/10 transition flex items-center gap-1.5 shrink-0"
              title="一键复制设备码"
            >
              <Copy class="w-3.5 h-3.5" />
              <span>{{ copiedDeviceId ? '已复制' : '复制' }}</span>
            </button>
          </div>
        </div>

        <!-- 2. 当前授权卡片 -->
        <div
          class="p-4 rounded-2xl border transition-all"
          :class="licenseInfo.isActivated 
            ? 'bg-emerald-950/20 border-emerald-500/30' 
            : 'bg-slate-950/40 border-white/10'"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <Sparkles v-if="licenseInfo.isActivated" class="w-4 h-4 text-emerald-400" />
              <User v-else class="w-4 h-4 text-slate-400" />
              <span class="font-bold text-slate-200 text-xs">
                {{ licenseInfo.isActivated ? '当前服务状态' : '当前用户状态' }}
              </span>
            </div>
            <span
              class="text-[11px] font-mono font-bold"
              :class="licenseInfo.isActivated ? 'text-emerald-400' : 'text-slate-300'"
            >
              {{ licenseInfo.isActivated ? (licenseInfo.isLifetime ? '终身赞助者' : '赞助者') : '普通用户' }}
            </span>
          </div>

          <div v-if="licenseInfo.isActivated" class="space-y-1.5 text-[11px] text-slate-300 pt-1 border-t border-white/5">
            <div class="flex justify-between">
              <span class="text-slate-400">已绑定赞助码:</span>
              <span class="font-mono text-slate-200 font-bold">{{ licenseInfo.code || '-' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">有效时长:</span>
              <span class="font-bold text-emerald-300 font-mono">
                {{ licenseInfo.isLifetime ? '终身有效' : `剩余 ${licenseInfo.remainingDays || 0} 天` }}
              </span>
            </div>
            <div v-if="!licenseInfo.isLifetime && licenseInfo.expiresAt" class="flex justify-between">
              <span class="text-slate-400">到期时间:</span>
              <span class="font-mono text-slate-400">{{ formatDateTime(licenseInfo.expiresAt) }}</span>
            </div>
          </div>
          <div v-else class="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-white/5 space-y-1.5">
            <p>当前为普通用户，支持本地核心入库功能。输入赞助码可升级为赞助者，享受全量云端高速检索与完整生态服务。</p>
            <div v-if="sponsorUrl" class="pt-0.5">
              <button
                @click="handleOpenSponsorPage"
                class="text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer flex items-center gap-1"
              >
                <span>前往赞助支持页面获取卡密 ➔</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 3. 输入赞助码 -->
        <div class="space-y-2">
          <label class="font-bold text-slate-200 text-xs flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <Key class="w-3.5 h-3.5 text-amber-400" />
              <span>输入赞助码</span>
            </span>
            <button
              @click="handlePasteCode"
              class="text-[11px] text-sky-400 hover:text-sky-300 transition font-normal"
            >
              从剪贴板粘贴
            </button>
          </label>

          <div class="flex items-center gap-2">
            <input
              v-model="activationCodeInput"
              type="text"
              placeholder="例如: CFD-L-A1B2-C3D4-E5F6"
              class="flex-1 bg-slate-950/80 border border-white/10 rounded-2xl px-4 py-3 text-xs font-mono text-slate-100 uppercase tracking-widest focus:outline-none focus:border-amber-400/80 focus:ring-1 focus:ring-amber-400/30"
              @keydown.enter="handleActivate"
            />
            <button
              @click="handleActivate"
              :disabled="activating || !activationCodeInput.trim()"
              class="theme-btn-primary px-5 py-3 rounded-2xl font-bold text-xs disabled:opacity-50 transition shadow flex items-center gap-1.5 shrink-0"
            >
              <RotateCw v-if="activating" class="w-3.5 h-3.5 animate-spin" />
              <Zap v-else class="w-3.5 h-3.5" />
              <span>{{ activating ? '正在核销...' : (licenseInfo.isActivated ? '更换赞助码' : '立即绑定') }}</span>
            </button>
          </div>
        </div>

        <!-- 3.5 换机迁移（赞助码已被其他设备绑定时出现） -->
        <div v-if="showRebind" class="space-y-2 p-3 rounded-2xl bg-sky-950/30 border border-sky-500/30">
          <div class="font-bold text-sky-300 text-xs flex items-center gap-1.5">
            <ArrowLeftRight class="w-3.5 h-3.5" />
            <span>换机迁移绑定</span>
          </div>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            该赞助码已绑定其他设备。若旧设备已报废或重装系统，可填入旧设备显示的设备码，验证匹配后迁移到本机。
          </p>
          <div class="flex items-center gap-2">
            <input
              v-model="rebindOldDeviceId"
              type="text"
              placeholder="旧设备码，例如 CFD-XXXX-XXXX-XXXX-XXXX"
              class="flex-1 bg-slate-950/80 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] font-mono text-slate-100 uppercase tracking-wider focus:outline-none focus:border-sky-400/80"
            />
            <button
              @click="handleRebind"
              :disabled="rebinding || !rebindOldDeviceId.trim() || !activationCodeInput.trim()"
              class="px-4 py-2.5 rounded-xl font-bold text-[11px] bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 transition disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              <RotateCw v-if="rebinding" class="w-3.5 h-3.5 animate-spin" />
              <span>{{ rebinding ? '迁移中...' : '迁移到本机' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ==================== 标签页 2：邀请有礼 ==================== -->
      <div v-show="activeTab === 'invite'" class="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
        <!-- 活动说明 -->
        <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 space-y-2">
          <div class="flex items-center gap-2 text-rose-300 font-bold text-xs">
            <Gift class="w-4 h-4 text-rose-400 shrink-0" />
            <span>邀请有礼 · 多邀多得</span>
          </div>
          <p class="text-[11.5px] text-slate-300 leading-relaxed">
            把你的邀请码发给好友，好友在本页填写后：
            <strong class="text-rose-300 font-semibold">好友立即获得 {{ inviteRewardDays }} 天赞助版</strong>，
            <strong class="text-rose-300 font-semibold">你也同步获得 {{ inviteRewardDays }} 天</strong>。
          </p>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            邀请人数不设上限，多邀多得；每个设备<strong class="text-amber-300">仅能绑定一次</strong>邀请码，
            且不能填写自己的邀请码。奖励天数由官方统一配置，如有调整双方同步生效。
          </p>
        </div>

        <!-- 我的邀请码 -->
        <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/5 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <Share2 class="w-3.5 h-3.5 text-rose-400" />
              <span>我的邀请码</span>
            </span>
            <span class="text-[10px] text-slate-400 font-mono">设备码后 12 位 · 无需另行生成</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-900/90 px-3.5 py-2.5 rounded-xl border border-white/10 font-mono text-sm text-rose-300 font-black select-all tracking-[0.2em] text-center">
              {{ myInviteCode || '正在生成邀请码...' }}
            </div>
            <button
              @click="handleCopyInviteCode"
              :disabled="!myInviteCode"
              class="px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 font-medium rounded-xl border border-white/10 transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <Copy class="w-3.5 h-3.5" />
              <span>{{ copiedInviteCode ? '已复制' : '复制' }}</span>
            </button>
          </div>
        </div>

        <!-- 邀请战绩 -->
        <div class="grid grid-cols-3 gap-3">
          <div class="p-3 rounded-2xl bg-slate-950/60 border border-white/5 text-center">
            <div class="text-[11px] text-slate-400 mb-1">成功邀请</div>
            <div class="font-mono font-black text-base text-emerald-300">{{ inviteStatus?.invitedCount ?? 0 }} <span class="text-[10px] font-normal text-slate-400">人</span></div>
          </div>
          <div class="p-3 rounded-2xl bg-slate-950/60 border border-white/5 text-center">
            <div class="text-[11px] text-slate-400 mb-1">累计获得</div>
            <div class="font-mono font-black text-base text-rose-300">{{ inviteStatus?.earnedDays ?? 0 }} <span class="text-[10px] font-normal text-slate-400">天</span></div>
          </div>
          <div class="p-3 rounded-2xl bg-slate-950/60 border border-white/5 text-center">
            <div class="text-[11px] text-slate-400 mb-1">单次奖励</div>
            <div class="font-mono font-black text-base text-amber-300">{{ inviteRewardDays }} <span class="text-[10px] font-normal text-slate-400">天</span></div>
          </div>
        </div>

        <!-- 填写邀请码 -->
        <div class="space-y-2">
          <label class="font-bold text-slate-200 text-xs flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <Ticket class="w-3.5 h-3.5 text-amber-400" />
              <span>填写好友的邀请码</span>
            </span>
            <button
              v-if="!inviteStatus?.hasBoundInvite"
              @click="handlePasteInviteCode"
              class="text-[11px] text-sky-400 hover:text-sky-300 transition font-normal"
            >
              从剪贴板粘贴
            </button>
          </label>

          <!-- 已绑定：只读展示，防止重复领取 -->
          <div
            v-if="inviteStatus?.hasBoundInvite"
            class="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-1"
          >
            <div class="flex items-center gap-2 text-emerald-300 font-bold text-xs">
              <CheckCircle2 class="w-4 h-4 text-emerald-400 shrink-0" />
              <span>已绑定邀请码</span>
            </div>
            <div class="flex justify-between text-[11px] text-slate-300 pt-1">
              <span class="text-slate-400">邀请码:</span>
              <span class="font-mono font-bold text-emerald-300">{{ inviteStatus.boundInviteCode || '-' }}</span>
            </div>
            <div class="flex justify-between text-[11px] text-slate-300">
              <span class="text-slate-400">绑定时间:</span>
              <span class="font-mono text-slate-400">{{ formatDateTime(inviteStatus.boundAt) }}</span>
            </div>
            <p class="text-[10.5px] text-slate-500 pt-1">每个设备仅能绑定一次邀请码，奖励已发放到本机账户。</p>
          </div>

          <!-- 未绑定：可输入 -->
          <template v-else>
            <div class="flex items-center gap-2">
              <input
                v-model="inviteCodeInput"
                type="text"
                placeholder="例如: A1B2-C3D4-E5F6"
                class="flex-1 bg-slate-950/80 border border-white/10 rounded-2xl px-4 py-3 text-xs font-mono text-slate-100 uppercase tracking-widest focus:outline-none focus:border-amber-400/80 focus:ring-1 focus:ring-amber-400/30"
                @keydown.enter="handleBindInvite"
              />
              <button
                @click="handleBindInvite"
                :disabled="bindingInvite || !inviteCodeInput.trim()"
                class="theme-btn-primary px-5 py-3 rounded-2xl font-bold text-xs disabled:opacity-50 transition shadow flex items-center gap-1.5 shrink-0"
              >
                <RotateCw v-if="bindingInvite" class="w-3.5 h-3.5 animate-spin" />
                <Gift v-else class="w-3.5 h-3.5" />
                <span>{{ bindingInvite ? '正在领取...' : `领取 ${inviteRewardDays} 天` }}</span>
              </button>
            </div>
            <p class="text-[10.5px] text-slate-500 leading-tight">
              绑定成功后本机立即获得 {{ inviteRewardDays }} 天赞助版（无卡密设备将自动发放奖励卡），邀请人同步获得 {{ inviteRewardDays }} 天。
            </p>
          </template>
        </div>
      </div>

      <!-- 弹窗底部操作栏 -->
      <div class="px-6 py-4 border-t border-white/5 flex items-center justify-between bg-slate-950/40">
        <button
          v-if="licenseInfo.isActivated"
          @click="handleUnbindLocal"
          class="text-rose-400 hover:text-rose-300 text-xs transition underline"
        >
          清除本机授权缓存
        </button>
        <span v-else class="text-[11px] text-slate-400">如有疑问请联系技术支持</span>

        <button
          @click="emit('close')"
          class="px-4 py-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 font-medium rounded-xl text-xs transition border border-white/10"
        >
          完成并关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  Heart,
  User,
  X,
  Laptop,
  Copy,
  Sparkles,
  Key,
  RotateCw,
  Zap,
  ArrowLeftRight,
  Gift,
  Share2,
  Ticket,
  CheckCircle2
} from 'lucide-vue-next';
import { ClientLicenseInfo, LicenseType, InviteStatus } from '../../types';
import { formatIpcError } from '../api/tauriBridge';

const props = defineProps<{
  licenseInfo: ClientLicenseInfo;
  sponsorUrl?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const activeTab = ref<'license' | 'invite'>('license');

const deviceId = ref('');
const copiedDeviceId = ref(false);
const activationCodeInput = ref('');
const activating = ref(false);
const showRebind = ref(false);
const rebindOldDeviceId = ref('');
const rebinding = ref(false);

// 邀请有礼状态
const myInviteCode = ref('');
const copiedInviteCode = ref(false);
const inviteCodeInput = ref('');
const bindingInvite = ref(false);
const inviteStatus = ref<InviteStatus | null>(null);
// 单次奖励天数：优先取服务端下发值，离线时回退 3 天（仅用于展示）
const inviteRewardDays = ref(3);

const handleOpenSponsorPage = async () => {
  const url = props.sponsorUrl && props.sponsorUrl.trim();
  if (url) {
    try {
      await window.electronAPI.openExternalUrl(url);
      emit('notify', '正在打开赞助支持页面...', 'info');
    } catch (e: any) {
      emit('notify', '打开链接失败: ' + formatIpcError(e), 'error');
    }
  } else {
    emit('notify', '后端暂未配置赞助链接，感谢您的支持！', 'info');
  }
};

const getLicenseBadgeClass = (status: string, type?: LicenseType) => {
  if (status === 'active') {
    if (type === 'lifetime') return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
    return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
  }
  if (status === 'expired') return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
  return 'bg-slate-800/80 text-slate-400 border-white/10';
};

const getLicenseStatusText = (info: ClientLicenseInfo) => {
  if (info.isActivated) {
    // 显示服务端下发的具体卡种名（体验卡/月卡/季卡/年卡/永久/邀请奖励），未识别时回退通用文案
    if (info.isLifetime) return info.typeName || '终身赞助者';
    const base = info.typeName || '赞助者';
    return `${base} (剩 ${info.remainingDays || 0} 天)`;
  }
  if (info.status === 'expired') return '赞助已到期';
  return '普通用户';
};

const formatDateTime = (iso?: string) => {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
};

/** 复制通用逻辑：失败时给出明确反馈而非静默 */
const copyText = async (text: string, okMsg: string): Promise<boolean> => {
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      emit('notify', okMsg, 'success');
      return true;
    } catch {
      emit('notify', '复制失败：剪贴板不可用，请手动选择复制', 'error');
      return false;
    }
  }
  emit('notify', '剪贴板不可用，请手动选择复制', 'error');
  return false;
};

const loadDeviceId = async () => {
  try {
    const id = await window.electronAPI.getDeviceId();
    if (id) {
      deviceId.value = id;
      // 邀请码由设备码本地派生（与服务端算法一致），无需额外请求即可展示
      myInviteCode.value = window.electronAPI.deriveInviteCode(id);
    }
  } catch (e: any) {
    console.warn('获取设备码异常:', formatIpcError(e));
  }
};

const loadInviteStatus = async () => {
  try {
    const st = await window.electronAPI.getInviteStatus();
    if (st) {
      inviteStatus.value = st;
      if (st.inviteCode) myInviteCode.value = st.inviteCode;
      if (typeof st.rewardDays === 'number' && st.rewardDays > 0) {
        inviteRewardDays.value = st.rewardDays;
      }
    }
  } catch (e: any) {
    console.warn('获取邀请状态异常:', formatIpcError(e));
  }
};

const switchToInviteTab = async () => {
  activeTab.value = 'invite';
  if (!inviteStatus.value) await loadInviteStatus();
};

const handleCopyDeviceId = async () => {
  if (await copyText(deviceId.value, '设备码已成功复制到剪贴板！')) {
    copiedDeviceId.value = true;
    setTimeout(() => { copiedDeviceId.value = false; }, 2000);
  }
};

const handleCopyInviteCode = async () => {
  if (await copyText(myInviteCode.value, '邀请码已复制，快发给好友吧！')) {
    copiedInviteCode.value = true;
    setTimeout(() => { copiedInviteCode.value = false; }, 2000);
  }
};

const handlePasteCode = async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        activationCodeInput.value = text.trim().toUpperCase();
        emit('notify', '已自动粘贴剪贴板内容', 'info');
      } else {
        emit('notify', '剪贴板为空，请手动输入赞助码', 'warning');
      }
    } else {
      emit('notify', '当前环境不支持读取剪贴板，请手动输入', 'warning');
    }
  } catch (e: any) {
    // 权限被拒/无剪贴板数据时给出明确反馈，不再静默失败让用户困惑
    emit('notify', `读取剪贴板失败：${e?.message || '请手动输入赞助码'}`, 'warning');
  }
};

const handlePasteInviteCode = async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        inviteCodeInput.value = text.trim().toUpperCase();
        emit('notify', '已自动粘贴剪贴板内容', 'info');
      } else {
        emit('notify', '剪贴板为空，请手动输入邀请码', 'warning');
      }
    } else {
      emit('notify', '当前环境不支持读取剪贴板，请手动输入', 'warning');
    }
  } catch (e: any) {
    emit('notify', `读取剪贴板失败：${e?.message || '请手动输入邀请码'}`, 'warning');
  }
};

const handleActivate = async () => {
  const code = activationCodeInput.value.trim().toUpperCase();
  if (!code) {
    emit('notify', '请输入赞助码后再点击绑定', 'warning');
    return;
  }

  activating.value = true;
  showRebind.value = false;
  try {
    const res = await window.electronAPI.activateLicense(code);
    if (res.success) {
      emit('notify', res.message || '恭喜，赞助码绑定成功！', 'success');
      activationCodeInput.value = '';
      emit('refresh');
    } else {
      emit('notify', res.message || '绑定失败', 'error');
      // 赞助码已被其他设备绑定时，展开换机迁移入口
      if ((res.message || '').includes('已被其他设备绑定')) {
        showRebind.value = true;
      }
    }
  } catch (e: any) {
    emit('notify', `绑定失败: ${formatIpcError(e)}`, 'error');
  } finally {
    activating.value = false;
  }
};

const handleRebind = async () => {
  const code = activationCodeInput.value.trim().toUpperCase();
  const oldDeviceId = rebindOldDeviceId.value.trim().toUpperCase();
  if (!code || !oldDeviceId) {
    emit('notify', '请填写赞助码与旧设备码后再迁移', 'warning');
    return;
  }
  rebinding.value = true;
  try {
    const res = await window.electronAPI.rebindLicense(code, oldDeviceId);
    if (res.success) {
      emit('notify', res.message || '赞助码已成功迁移到本机！', 'success');
      showRebind.value = false;
      rebindOldDeviceId.value = '';
      activationCodeInput.value = '';
      emit('refresh');
    } else {
      emit('notify', res.message || '迁移失败', 'error');
    }
  } catch (e: any) {
    emit('notify', `迁移失败: ${formatIpcError(e)}`, 'error');
  } finally {
    rebinding.value = false;
  }
};

const handleBindInvite = async () => {
  const code = inviteCodeInput.value.trim().toUpperCase();
  if (!code) {
    emit('notify', '请输入好友的邀请码后再领取', 'warning');
    return;
  }
  bindingInvite.value = true;
  try {
    const res = await window.electronAPI.bindInviteCode(code);
    if (res.success) {
      emit('notify', res.message || '邀请码绑定成功，奖励已到账！', 'success');
      inviteCodeInput.value = '';
      await loadInviteStatus();
      // 奖励可能新建了邀请奖励卡：刷新授权状态让顶栏徽章立即更新
      emit('refresh');
    } else {
      emit('notify', res.message || '邀请码绑定失败', 'error');
    }
  } catch (e: any) {
    emit('notify', `邀请码绑定失败: ${formatIpcError(e)}`, 'error');
  } finally {
    bindingInvite.value = false;
  }
};

const handleUnbindLocal = async () => {
  if (!confirm('确定要清除本机的赞助授权缓存吗？')) return;
  try {
    const res = await window.electronAPI.unbindLicense();
    if (res.success) {
      emit('notify', '已清除本机授权缓存', 'info');
      emit('refresh');
    }
  } catch (e: any) {
    emit('notify', `操作失败: ${formatIpcError(e)}`, 'error');
  }
};

onMounted(() => {
  void loadDeviceId();
  void loadInviteStatus();
});
</script>