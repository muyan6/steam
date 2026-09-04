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
        'toast-success': item.type === 'success',
        'toast-error': item.type === 'error',
        'toast-warning': item.type === 'warning',
        'toast-info': item.type === 'info',
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
