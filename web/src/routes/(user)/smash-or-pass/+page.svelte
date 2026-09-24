<script lang="ts">
  import { browser } from '$app/environment';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { getAssetUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetOrder,
    AssetTypeEnum,
    AssetVisibility,
    deleteAssets,
    restoreAssets,
    searchAssets,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { Icon, toastManager } from '@immich/ui';
  import { mdiArrowLeft, mdiArrowRight, mdiBackupRestore, mdiHeart, mdiTrashCanOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Action = {
    asset: AssetResponseDto;
    kind: 'smash' | 'pass';
    undone: boolean;
  };

  type Props = { data: PageData };
  let { data }: Props = $props();

  const storageKey = 'immich-smash-or-pass-reviewed-v1';
  const batchSize = 100;
  let queue = $state<AssetResponseDto[]>([]);
  let history = $state<Action[]>([]);
  let reviewed = $state(new Set<string>());
  let nextPage = $state(1);
  let loading = $state(false);
  let acting = $state(false);
  let keptCount = $state(0);
  let passedCount = $state(0);
  let pointerStartX = 0;
  let current = $derived(queue[0]);

  const shuffle = (items: AssetResponseDto[]) => {
    for (let index = items.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  };

  const saveReviewed = () => {
    if (browser) {
      localStorage.setItem(storageKey, JSON.stringify([...reviewed]));
    }
  };

  const loadBatch = async () => {
    if (loading || nextPage === 0 || queue.length >= 20) {
      return;
    }

    loading = true;
    try {
      while (nextPage !== 0 && queue.length < 20) {
        const response = await searchAssets({
          metadataSearchDto: {
            visibility: AssetVisibility.Timeline,
            order: AssetOrder.Desc,
            page: nextPage,
            size: batchSize,
          },
        });
        nextPage = Number(response.assets.nextPage) || 0;
        const candidates = response.assets.items.filter(
          (asset) => asset.type === AssetTypeEnum.Image && !reviewed.has(asset.id),
        );
        queue = [...queue, ...shuffle(candidates)];
      }
    } catch (error) {
      handleError(error, $t('smash_or_pass_load_error'));
    } finally {
      loading = false;
    }
  };

  const finishAction = (asset: AssetResponseDto, kind: Action['kind']) => {
    const action: Action = { asset, kind, undone: false };
    history = [...history, action];
    reviewed.add(asset.id);
    reviewed = new Set(reviewed);
    saveReviewed();
    queue = queue.slice(1);
    if (kind === 'smash') {
      keptCount++;
    } else {
      passedCount++;
    }
    void loadBatch();
    return action;
  };

  const undo = async (action = history.at(-1)) => {
    if (!action || action.undone || acting) {
      return;
    }

    acting = true;
    try {
      if (action.kind === 'pass') {
        await restoreAssets({ bulkIdsDto: { ids: [action.asset.id] } });
        passedCount = Math.max(0, passedCount - 1);
      } else {
        keptCount = Math.max(0, keptCount - 1);
      }
      action.undone = true;
      history = history.filter((item) => item !== action);
      reviewed.delete(action.asset.id);
      reviewed = new Set(reviewed);
      saveReviewed();
      queue = [action.asset, ...queue.filter((asset) => asset.id !== action.asset.id)];
    } catch (error) {
      handleError(error, $t('errors.unable_to_restore_assets'));
    } finally {
      acting = false;
    }
  };

  const smash = async () => {
    if (!current || acting) {
      return;
    }
    finishAction(current, 'smash');
  };

  const pass = async () => {
    if (!current || acting) {
      return;
    }

    acting = true;
    const asset = current;
    try {
      await deleteAssets({ assetBulkDeleteDto: { ids: [asset.id] } });
      const action = finishAction(asset, 'pass');
      toastManager.primary(
        {
          description: $t('smash_or_pass_moved_to_trash'),
          button: { label: $t('undo'), color: 'secondary', onclick: () => undo(action) },
        },
        { timeout: 8000 },
      );
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_assets'));
    } finally {
      acting = false;
    }
  };

  const resetProgress = async () => {
    reviewed = new Set();
    history = [];
    queue = [];
    nextPage = 1;
    keptCount = 0;
    passedCount = 0;
    saveReviewed();
    await loadBatch();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 's') {
      event.preventDefault();
      void smash();
    } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'p' || event.key === 'Delete') {
      event.preventDefault();
      void pass();
    } else if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void undo();
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    pointerStartX = event.clientX;
  };

  const handlePointerUp = (event: PointerEvent) => {
    const distance = event.clientX - pointerStartX;
    if (Math.abs(distance) < 70) {
      return;
    }
    if (distance > 0) {
      void smash();
    } else {
      void pass();
    }
  };

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(saved)) {
        reviewed = new Set(saved.filter((id): id is string => typeof id === 'string'));
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    void loadBatch();
  });

  $effect(() => {
    const nextAsset = queue[1];
    if (browser && nextAsset) {
      const image = new Image();
      image.src = getAssetUrl({ asset: nextAsset }) ?? '';
    }
  });
</script>

<svelte:document onkeydown={handleKeydown} />

<UserPageLayout title={data.meta.title} scrollbar={false}>
  <div class="flex h-full min-h-[32rem] flex-col items-center justify-center gap-4 overflow-hidden px-2 py-4">
    <div class="flex w-full max-w-3xl items-center justify-between text-sm text-gray-500 dark:text-gray-400">
      <span>{$t('smash_or_pass_progress', { values: { kept: keptCount, passed: passedCount } })}</span>
      <button
        type="button"
        class="rounded-full px-3 py-1 transition hover:bg-gray-200 dark:hover:bg-gray-700"
        disabled={history.length === 0 || acting}
        onclick={() => undo()}
      >
        <span class="inline-flex items-center gap-1"><Icon icon={mdiBackupRestore} size="18" /> {$t('undo')}</span>
      </button>
    </div>

    {#if current}
      <div
        role="group"
        aria-label={$t('smash_or_pass')}
        class="relative flex min-h-0 w-full max-w-3xl flex-1 touch-pan-y select-none items-center justify-center overflow-hidden rounded-3xl bg-black shadow-2xl"
        onpointerdown={handlePointerDown}
        onpointerup={handlePointerUp}
      >
        <img
          class="h-full max-h-[65dvh] w-full object-contain"
          src={getAssetUrl({ asset: current })}
          alt={current.originalFileName}
          draggable="false"
        />
        <div
          class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-5 pb-4 pt-16 text-white"
        >
          <p class="truncate text-sm font-medium">{current.originalFileName}</p>
          <p class="text-xs text-white/75">{new Date(current.fileCreatedAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div class="grid w-full max-w-3xl grid-cols-2 gap-3">
        <button
          type="button"
          class="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-lg font-semibold text-white shadow-lg transition hover:bg-red-700 active:scale-95 disabled:opacity-50"
          disabled={acting}
          onclick={pass}
        >
          <Icon icon={mdiTrashCanOutline} size="28" />
          {$t('pass_to_trash')}
        </button>
        <button
          type="button"
          class="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-green-600 px-5 text-lg font-semibold text-white shadow-lg transition hover:bg-green-700 active:scale-95 disabled:opacity-50"
          disabled={acting}
          onclick={smash}
        >
          <Icon icon={mdiHeart} size="28" />
          {$t('smash_keep')}
        </button>
      </div>

      <div class="hidden w-full max-w-3xl justify-between text-xs text-gray-400 md:flex">
        <span><Icon icon={mdiArrowLeft} size="16" /> {$t('smash_or_pass_left_hint')}</span>
        <span>{$t('smash_or_pass_right_hint')} <Icon icon={mdiArrowRight} size="16" /></span>
      </div>
    {:else if loading}
      <div class="text-center text-gray-500">{$t('loading')}</div>
    {:else}
      <div class="max-w-lg rounded-3xl bg-gray-100 p-8 text-center dark:bg-immich-dark-gray">
        <h2 class="mb-2 text-2xl font-semibold">{$t('smash_or_pass_complete')}</h2>
        <p class="mb-6 text-gray-500 dark:text-gray-400">{$t('smash_or_pass_complete_description')}</p>
        <button
          type="button"
          class="rounded-full bg-primary px-6 py-3 font-semibold text-white"
          onclick={resetProgress}
        >
          {$t('smash_or_pass_start_over')}
        </button>
      </div>
    {/if}
  </div>
</UserPageLayout>
