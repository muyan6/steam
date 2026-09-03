<template>
  <TransitionGroup
    tag="div"
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="transform translate-y-4 opacity-0"
    enter-to-class="transform translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="transform translate-y-0 opacity-100"
    leave-to-class="transform translate-y-4 opacity-0"
    class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm"
  >
    <div
      v-for="item in toasts"
      :key="item.id"
      class="flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm font-medium backdrop-blur-md"
      :class="{
        'bg-emerald-950/80 border-emerald-500/30 text-emerald-200': item.type === 'success',
        'bg-rose-950/80 border-rose-500/30 text-rose-200': item.type === 'error',
        'bg-amber-950/80 border-amber-500/30 text-amber-200': item.type === 'warning',
        'bg-sky-950/80 border-sky-500/30 text-sky-200': item.type === 'info',
      }"
    >
      <span class="text-base">{{ getIcon(item.type) }}</span>
      <span class="flex-1">{{ item.message }}</span>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

defineProps<{
  toasts: ToastItem[];
}>();

const getIcon = (type: string) => {
  switch (type) {
    case 'success': return '✓';
    case 'error': return '✕';
    case 'warning': return '⚠';
    default: return 'ℹ';
  }
};
</script>
