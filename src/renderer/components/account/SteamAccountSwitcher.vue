<template>
  <div class="relative w-full" ref="containerRef">
    <!-- 当前激活账号胶囊卡片 -->
    <div
      @click="toggleDropdown"
      class="flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-all duration-200 group select-none shadow-sm"
      :class="{ 'ring-1 ring-sky-400/30 border-sky-400/40 bg-white/10': isOpen }"
      title="点击快速切换本地已登录的 Steam 账号"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <!-- 账号头像 -->
        <div class="w-7 h-7 rounded-full overflow-hidden bg-slate-800 border border-white/15 shrink-0 flex items-center justify-center relative shadow-inner">
          <img
            v-if="currentAccount?.avatarBase64"
            :src="currentAccount.avatarBase64"
            :alt="currentAccount.personaName"
            class="w-full h-full object-cover"
          />
          <User v-else class="w-3.5 h-3.5 text-slate-400" />
        </div>

        <!-- 账号昵称与提示 -->
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-slate-100 truncate group-hover:theme-text-accent transition-colors flex items-center gap-1.5">
            <span class="truncate">{{ currentAccount?.personaName || currentAccount?.accountName || '未检测到账号' }}</span>
          </div>
          <div class="text-[10px] text-slate-400 truncate flex items-center gap-1">
            <span v-if="currentAccount?.isCurrentAutoLogin" class="text-emerald-400 font-semibold">自动登录</span>
            <span v-else-if="currentAccount">本地凭证</span>
            <span v-else>请启动Steam</span>
            <span v-if="accounts.length > 1" class="text-slate-500 font-mono">({{ accounts.length }}个账号)</span>
          </div>
        </div>
      </div>

      <!-- 展开箭头 -->
      <ChevronDown
        class="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-transform duration-200 shrink-0 ml-1"
        :class="{ 'rotate-180 text-sky-400': isOpen }"
      />
    </div>

    <!-- 悬浮下拉面板 (极速切号) -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="transform scale-95 opacity-0 translate-y-1"
      enter-to-class="transform scale-100 opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="transform scale-100 opacity-100 translate-y-0"
      leave-to-class="transform scale-95 opacity-0 translate-y-1"
    >
      <div
        v-if="isOpen"
        class="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-2xl bg-slate-900/95 border border-white/15 backdrop-blur-2xl shadow-2xl z-50 flex flex-col gap-1.5 min-w-[220px]"
      >
        <!-- 弹层头部 -->
        <div class="flex items-center justify-between px-2 py-1 border-b border-white/5 text-[11px] text-slate-400">
          <span class="font-bold text-slate-200 flex items-center gap-1.5">
            <Users class="w-3.5 h-3.5 theme-text-accent" />
            <span>本机 Steam 账号 ({{ accounts.length }})</span>
          </span>
          <button
            @click.stop="refreshAccounts"
            class="hover:text-slate-200 transition p-1 hover:bg-white/5 rounded-md"
            title="刷新本机账号列表"
          >
            <RotateCw class="w-3 h-3" :class="{ 'animate-spin': loading }" />
          </button>
        </div>

        <!-- 账号列表容器 -->
        <div class="max-h-56 overflow-y-auto space-y-1 pr-0.5">
          <div
            v-if="accounts.length === 0"
            class="py-4 text-center text-xs text-slate-500"
          >
            未读取到登录凭证，请先启动并登录 Steam
          </div>

          <div
            v-for="acc in accounts"
            :key="acc.steamId"
            @click.stop="onSelectAccount(acc.accountName)"
            class="flex items-center justify-between p-2 rounded-xl transition-all duration-150 cursor-pointer group"
            :class="acc.isCurrentAutoLogin
              ? 'bg-sky-500/15 border border-sky-500/30 text-sky-200'
              : 'hover:bg-white/10 text-slate-300 hover:text-white border border-transparent'"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <!-- 头像 -->
              <div class="w-7 h-7 rounded-full overflow-hidden bg-slate-800 border border-white/10 shrink-0 flex items-center justify-center">
                <img
                  v-if="acc.avatarBase64"
                  :src="acc.avatarBase64"
                  :alt="acc.personaName"
                  class="w-full h-full object-cover"
                />
                <span v-else class="text-xs font-bold text-slate-400">{{ acc.personaName.charAt(0).toUpperCase() }}</span>
              </div>

              <!-- 昵称与账号名 -->
              <div class="min-w-0 flex-1">
                <div class="text-xs font-bold truncate flex items-center gap-1.5">
                  <span class="truncate">{{ acc.personaName }}</span>
                  <span
                    v-if="acc.isCurrentAutoLogin"
                    class="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono shrink-0 font-bold"
                  >
                    当前
                  </span>
                </div>
                <div class="text-[10px] text-slate-400 truncate font-mono">
                  @{{ acc.accountName }} · {{ formatTimestamp(acc.timestamp) }}
                </div>
              </div>
            </div>

            <!-- 切号动作指示 -->
            <div class="shrink-0 ml-2">
              <RotateCw
                v-if="switchingAccount === acc.accountName"
                class="w-3.5 h-3.5 animate-spin text-sky-400"
              />
              <ArrowRight
                v-else-if="!acc.isCurrentAutoLogin"
                class="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 transition-colors"
              />
              <Check
                v-else
                class="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { User, Users, ChevronDown, RotateCw, ArrowRight, Check } from 'lucide-vue-next';
import { useSteamAccount } from '../../composables/useSteamAccount';

const emit = defineEmits<{
  (e: 'notify', msg: string, type?: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const { accounts, currentAccount, loading, switchingAccount, refreshAccounts, handleSwitch, formatTimestamp } = useSteamAccount();
const isOpen = ref(false);
const containerRef = ref<HTMLElement | null>(null);

function toggleDropdown() {
  isOpen.value = !isOpen.value;
  if (isOpen.value && accounts.value.length === 0) {
    refreshAccounts();
  }
}

async function onSelectAccount(accountName: string) {
  if (currentAccount.value?.accountName === accountName && currentAccount.value?.isCurrentAutoLogin) {
    isOpen.value = false;
    return;
  }
  const ok = await handleSwitch(accountName, (msg, type) => emit('notify', msg, type));
  if (ok) {
    isOpen.value = false;
  }
}

function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  refreshAccounts();
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>
