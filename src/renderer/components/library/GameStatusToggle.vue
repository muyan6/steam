<template>
  <button
    @click.stop="onToggle"
    :disabled="loading"
    class="px-2.5 py-1 rounded-xl text-xs font-semibold font-mono flex items-center gap-1.5 transition-all duration-200 cursor-pointer select-none active:scale-95 disabled:opacity-50"
    :class="isDisabled
      ? 'bg-slate-700/40 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 border border-slate-600/30'
      : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30'"
    :title="isDisabled ? '已停用入库（文件已移至 Disable 目录，Steam 不会加载）；点击即可一键重新激活' : '入库生效中；点击可将其临时停用归档，无需删除文件'"
  >
    <RotateCw v-if="loading" class="w-3 h-3 animate-spin text-current" />
    <template v-else>
      <CheckCircle2 v-if="!isDisabled" class="w-3.5 h-3.5 text-emerald-400" />
      <PauseCircle v-else class="w-3.5 h-3.5 text-slate-400" />
      <span>{{ isDisabled ? '已停用' : '已生效' }}</span>
    </template>
  </button>
</template>

<script setup lang="ts">
import { CheckCircle2, PauseCircle, RotateCw } from 'lucide-vue-next';

const props = defineProps<{
  appId: number;
  isDisabled: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', targetDisabled: boolean): void;
}>();

function onToggle() {
  if (props.loading) return;
  emit('toggle', !props.isDisabled);
}
</script>
