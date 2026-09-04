<template>
  <div class="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all duration-300">
    <div
      class="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
    >
      <!-- 弹窗顶部栏 -->
      <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Crown class="w-5 h-5" />
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
            <p class="text-[11px] text-slate-400">支持月卡、季卡、年卡及永久卡 · 一机一码绑定</p>
          </div>
        </div>
        <button
          @click="emit('close')"
          class="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition flex items-center justify-center text-sm"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- 弹窗主体内容 -->
      <div class="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
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
            : 'bg-amber-950/20 border-amber-500/30'"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <Sparkles v-if="licenseInfo.isActivated" class="w-4 h-4 text-emerald-400" />
              <AlertCircle v-else class="w-4 h-4 text-amber-400" />
              <span class="font-bold text-slate-200 text-xs">
                {{ licenseInfo.isActivated ? '当前会员权益状态' : '当前设备尚未激活' }}
              </span>
            </div>
            <span
              class="text-[11px] font-mono font-bold"
              :class="licenseInfo.isActivated ? 'text-emerald-400' : 'text-amber-400'"
            >
              {{ licenseInfo.typeName || (licenseInfo.isActivated ? '尊享会员' : '未激活') }}
            </span>
          </div>

          <div v-if="licenseInfo.isActivated" class="space-y-1.5 text-[11px] text-slate-300 pt-1 border-t border-white/5">
            <div class="flex justify-between">
              <span class="text-slate-400">已绑定激活码:</span>
              <span class="font-mono text-slate-200 font-bold">{{ licenseInfo.code || '-' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">有效时长:</span>
              <span class="font-bold text-emerald-300 font-mono">
                {{ licenseInfo.isLifetime ? '永久终身有效' : `剩余 ${licenseInfo.remainingDays || 0} 天` }}
              </span>
            </div>
            <div v-if="!licenseInfo.isLifetime && licenseInfo.expiresAt" class="flex justify-between">
              <span class="text-slate-400">到期时间:</span>
              <span class="font-mono text-slate-400">{{ formatDateTime(licenseInfo.expiresAt) }}</span>
            </div>
          </div>
          <div v-else class="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-white/5">
            请输入管理员发放的卡密激活码完成设备绑定。激活后立享 28.8万+ DepotKey 云端高速秒查与全量游戏极速入库！
          </div>
        </div>

        <!-- 3. 输入激活码 -->
        <div class="space-y-2">
          <label class="font-bold text-slate-200 text-xs flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <Key class="w-3.5 h-3.5 text-amber-400" />
              <span>输入卡密激活码</span>
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
              <span>{{ activating ? '正在核销...' : (licenseInfo.isActivated ? '续费/换码' : '立即激活') }}</span>
            </button>
          </div>
        </div>

        <!-- 4. 卡种权益卡片网格 -->
        <div class="pt-2">
          <div class="text-[11px] font-bold text-slate-400 mb-2 flex items-center gap-1">
            <ShieldCheck class="w-3.5 h-3.5 text-slate-400" />
            <span>支持的卡密类型与特权说明</span>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="p-2.5 rounded-xl bg-slate-950/40 border border-white/5">
              <div class="font-bold text-sky-400 text-[11px] flex items-center justify-between">
                <span>月卡会员</span>
                <span class="text-[10px] font-mono text-slate-400">30天</span>
              </div>
              <p class="text-[10px] text-slate-400 mt-0.5">全量 28.8万条密钥云端极速入库与联机修复</p>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-950/40 border border-white/5">
              <div class="font-bold text-emerald-400 text-[11px] flex items-center justify-between">
                <span>季卡会员</span>
                <span class="text-[10px] font-mono text-slate-400">90天</span>
              </div>
              <p class="text-[10px] text-slate-400 mt-0.5">季度畅玩 · 实时游戏更新与热重载</p>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-950/40 border border-white/5">
              <div class="font-bold text-amber-400 text-[11px] flex items-center justify-between">
                <span>年卡会员</span>
                <span class="text-[10px] font-mono text-slate-400">365天</span>
              </div>
              <p class="text-[10px] text-slate-400 mt-0.5">年度超值 · 独享 PICS 访问令牌与专属节点</p>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-950/40 border border-amber-500/20 bg-amber-500/5">
              <div class="font-bold text-amber-300 text-[11px] flex items-center justify-between">
                <span>永久尊享卡</span>
                <span class="text-[10px] font-mono text-amber-400 font-bold">终身</span>
              </div>
              <p class="text-[10px] text-slate-400 mt-0.5">永久有效 · 换机无忧 · 尊贵身份标识</p>
            </div>
          </div>
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
        <span v-else class="text-[11px] text-slate-400">如需获取激活码请联系软件管理员</span>

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
  Crown,
  X,
  Laptop,
  Copy,
  Sparkles,
  AlertCircle,
  Key,
  RotateCw,
  Zap,
  ShieldCheck
} from 'lucide-vue-next';
import { ClientLicenseInfo, LicenseType } from '../../types';

const props = defineProps<{
  licenseInfo: ClientLicenseInfo;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const deviceId = ref('');
const copiedDeviceId = ref(false);
const activationCodeInput = ref('');
const activating = ref(false);

const getLicenseBadgeClass = (status: string, type?: LicenseType) => {
  if (status === 'active') {
    if (type === 'lifetime') return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
    return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
  }
  if (status === 'expired') return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
  return 'bg-slate-800/80 text-slate-400 border-white/10';
};

const getLicenseStatusText = (info: ClientLicenseInfo) => {
  if (info.isActivated) {
    if (info.isLifetime) return '👑 永久尊享会员';
    return `⏱️ ${info.typeName || '会员'} (剩 ${info.remainingDays || 0} 天)`;
  }
  if (info.status === 'expired') return '⏱️ 授权已到期';
  return '⚠️ 未激活';
};

const formatDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
};

const loadDeviceId = async () => {
  try {
    const id = await window.electronAPI.getDeviceId();
    if (id) deviceId.value = id;
  } catch (e: any) {
    console.warn('获取设备码异常:', e.message);
  }
};

const handleCopyDeviceId = () => {
  if (!deviceId.value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(deviceId.value).then(() => {
      copiedDeviceId.value = true;
      emit('notify', '设备码已成功复制到剪贴板！', 'success');
      setTimeout(() => { copiedDeviceId.value = false; }, 2000);
    }).catch(() => {
      emit('notify', '复制失败：剪贴板不可用，请手动选择复制', 'error');
    });
  }
};

const handlePasteCode = async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        activationCodeInput.value = text.trim().toUpperCase();
        emit('notify', '已自动粘贴剪贴板内容', 'info');
      }
    }
  } catch {}
};

const handleActivate = async () => {
  const code = activationCodeInput.value.trim().toUpperCase();
  if (!code) {
    emit('notify', '请输入激活码后再点击激活', 'warning');
    return;
  }

  activating.value = true;
  try {
    const res = await window.electronAPI.activateLicense(code);
    if (res.success) {
      emit('notify', res.message || '恭喜，激活成功！', 'success');
      activationCodeInput.value = '';
      emit('refresh');
    } else {
      emit('notify', res.message || '激活失败', 'error');
    }
  } catch (e: any) {
    emit('notify', `激活失败: ${e.message}`, 'error');
  } finally {
    activating.value = false;
  }
};

const handleUnbindLocal = async () => {
  if (!confirm('确定要清除本机的卡密授权缓存吗？')) return;
  try {
    const res = await window.electronAPI.unbindLicense();
    if (res.success) {
      emit('notify', '已清除本机授权缓存', 'info');
      emit('refresh');
    }
  } catch (e: any) {
    emit('notify', `操作失败: ${e.message}`, 'error');
  }
};

onMounted(() => {
  loadDeviceId();
});
</script>
