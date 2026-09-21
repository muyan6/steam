<template>
  <div class="rounded-3xl tool-card overflow-hidden shadow-xl flex flex-col justify-between duration-300">
    <!-- 头部横幅与图标 -->
    <div class="h-28 tool-banner-a flex items-center justify-center relative overflow-hidden">
      <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-inner">
        <Users class="w-8 h-8" />
      </div>
      <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
    </div>

    <!-- 卡片主体内容 -->
    <div class="p-5 flex-1 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-100 flex items-center gap-2">
              <span>Steam 本地账号一键秒切</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-mono font-bold border border-sky-500/20">
                {{ accounts.length }} 个账号
              </span>
            </h3>
            <p class="text-xs text-slate-400 mt-1">自动读取本地记住的账号凭证，免密秒切并平滑重启 Steam</p>
          </div>
          <button
            @click="refreshAccounts"
            class="p-2 rounded-xl btn-soft-action text-xs transition flex items-center gap-1.5"
            title="重新扫描本地账号"
          >
            <RotateCw class="w-3.5 h-3.5 text-slate-400" :class="{ 'animate-spin': loading }" />
          </button>
        </div>

        <!-- 账号列表网格 -->
        <div class="mt-4 space-y-2.5 max-h-60 overflow-y-auto pr-1">
          <div
            v-if="accounts.length === 0"
            class="p-4 rounded-2xl bg-slate-900/60 border border-white/5 text-center text-xs text-slate-400"
          >
            <UserX class="w-6 h-6 mx-auto mb-1.5 text-slate-500" />
            <p>未在当前 Steam 目录下发现已记住的账号</p>
            <p class="text-[11px] text-slate-500 mt-0.5">请先在 Steam 客户端勾选「记住我的密码」完成至少一次登录</p>
          </div>

          <div
            v-for="acc in accounts"
            :key="acc.steamId"
            class="p-3 rounded-2xl border transition-all flex items-center justify-between gap-3"
            :class="acc.isCurrentAutoLogin
              ? 'bg-sky-500/10 border-sky-500/30 text-sky-100 shadow-sm'
              : 'bg-slate-900/60 border-white/5 hover:border-white/15 text-slate-200'"
          >
            <!-- 左侧：头像与资料 -->
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-800 border border-white/10 shrink-0 flex items-center justify-center relative">
                <img
                  v-if="acc.avatarBase64"
                  :src="acc.avatarBase64"
                  :alt="acc.personaName"
                  class="w-full h-full object-cover"
                />
                <span v-else class="text-sm font-bold text-slate-400">{{ acc.personaName.charAt(0).toUpperCase() }}</span>
                <span
                  v-if="acc.isCurrentAutoLogin"
                  class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900"
                  title="当前活动账号"
                ></span>
              </div>

              <div class="min-w-0 flex-1">
                <div class="text-xs font-bold truncate flex items-center gap-2">
                  <span class="truncate">{{ acc.personaName }}</span>
                  <span
                    v-if="acc.isCurrentAutoLogin"
                    class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold shrink-0"
                  >
                    当前登录中
                  </span>
                </div>
                <div class="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>@{{ acc.accountName }}</span>
                  <span class="text-slate-600">|</span>
                  <span class="text-slate-500 text-[10px]">{{ formatTimestamp(acc.timestamp) }}</span>
                </div>
                <div class="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                  ID: {{ acc.steamId }}
                </div>
              </div>
            </div>

            <!-- 右侧：切换按钮 -->
            <div class="shrink-0">
              <button
                v-if="!acc.isCurrentAutoLogin"
                @click="onSwitch(acc.accountName)"
                :disabled="switchingAccount !== null"
                class="px-3.5 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-300 hover:text-sky-200 text-xs font-semibold transition flex items-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <RotateCw v-if="switchingAccount === acc.accountName" class="w-3.5 h-3.5 animate-spin" />
                <ArrowRight v-else class="w-3.5 h-3.5" />
                <span>{{ switchingAccount === acc.accountName ? '正在切换...' : '切换为此账号' }}</span>
              </button>
              <div
                v-else
                class="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 select-none"
              >
                <Check class="w-3.5 h-3.5 stroke-[2.5]" />
                <span>正在使用</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部安全提示 -->
      <div class="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
        <span>免密切换将写入注册表 AutoLoginUser 并重启 Steam</span>
        <span class="text-emerald-400/80 font-medium">✓ 零封禁风险 · 原生支持</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { Users, RotateCw, UserX, ArrowRight, Check } from 'lucide-vue-next';
import { useSteamAccount } from '../../composables/useSteamAccount';

const emit = defineEmits<{
  (e: 'notify', msg: string, type?: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const { accounts, loading, switchingAccount, refreshAccounts, handleSwitch, formatTimestamp } = useSteamAccount();

async function onSwitch(accountName: string) {
  await handleSwitch(accountName, (msg, type) => emit('notify', msg, type));
}

onMounted(() => {
  refreshAccounts();
});
</script>
