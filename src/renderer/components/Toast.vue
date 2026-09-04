<template>
  <TransitionGroup
    tag="div"
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="transform translate-y-4 opacity-0 scale-95"
    enter-to-class="transform translate-y-0 opacity-100 scale-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="transform translate-y-0 opacity-100 scale-100"
    leave-to-class="transform translate-y-4 opacity-0 scale-95"
    class="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none select-none"
  >
    <div
      v-for="item in toasts"
      :key="item.id"
      class="flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold backdrop-blur-xl pointer-events-auto transition-all"
      :class="{
        'bg-emerald-950/85 border-emerald-500/40 text-emerald-200 shadow-emerald-950/50': item.type === 'success',
        'bg-rose-950/85 border-rose-500/40 text-rose-200 shadow-rose-950/50': item.type === 'error',
        'bg-amber-950/85 border-amber-500/40 text-amber-200 shadow-amber-950/50': item.type === 'warning',
        'bg-sky-950/85 border-sky-500/40 text-sky-200 shadow-sky-950/50': item.type === 'info',
      }"
    >
      <component :is="getIconComponent(item.type)" class="w-4 h-4 shrink-0" />
      <span class="flex-1 leading-snug">{{ item.message }}</span>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-vue-next';

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

defineProps<{
  toasts: ToastItem[];
}>();

const getIconComponent = (type: string) => {
  switch (type) {
    case 'success': return CheckCircle2;
    case 'error': return XCircle;
    case 'warning': return AlertTriangle;
    default: return Info;
  }
};
</script>
