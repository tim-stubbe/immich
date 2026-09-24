<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { lang } from '$lib/stores/preferences.store';
  import { getAssetPlaybackUrl, getAssetUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetOrder,
    AssetTypeEnum,
    AssetVisibility,
    deleteAssets,
    restoreAssets,
    searchAssets,
    searchSmart,
    type AssetResponseDto,
    type MetadataSearchDto,
    type SmartSearchDto,
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
    deleteState?: 'queued' | 'deleting' | 'deleted' | 'cancelled' | 'failed';
    deletionPromise?: Promise<void>;
  };

  type Props = { data: PageData };
  let { data }: Props = $props();

  type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;

  const sourceQuery = $derived(page.url.searchParams.get('query'));
  const searchScoped = $derived(page.url.searchParams.get('source') === 'search' && Boolean(sourceQuery));
  const scopedTerms = $derived<SearchTerms>(sourceQuery ? JSON.parse(sourceQuery) : {});
  const storageKey = $derived(
    searchScoped ? `immich-smash-or-pass-reviewed-search-v1:${sourceQuery}` : 'immich-smash-or-pass-reviewed-v1',
  );
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
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;
  let deleteQueue: Action[] = [];
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
        const searchDto = {
          ...scopedTerms,
          visibility: AssetVisibility.Timeline,
          order: AssetOrder.Desc,
          page: nextPage,
          size: batchSize,
        };
        const response =
          searchScoped && ('query' in searchDto || 'queryAssetId' in searchDto) && featureFlagsManager.value.smartSearch
            ? await searchSmart({ smartSearchDto: { ...searchDto, language: $lang } })
            : await searchAssets({ metadataSearchDto: searchDto });
        nextPage = Number(response.assets.nextPage) || 0;
        const candidates = response.assets.items.filter(
          (asset) => (searchScoped || asset.type === AssetTypeEnum.Image) && !reviewed.has(asset.id),
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

  const flushDeleteQueue = async () => {
    deleteTimer = undefined;
    const batch = deleteQueue.splice(0, 10).filter((action) => action.deleteState === 'queued' && !action.undone);
    if (batch.length === 0) {
      return;
    }

    for (const action of batch) {
      action.deleteState = 'deleting';
    }

    const completion = (async () => {
      try {
        await deleteAssets({ assetBulkDeleteDto: { ids: batch.map((action) => action.asset.id) } });
        for (const action of batch) {
          action.deleteState = 'deleted';
        }
      } catch (error) {
        for (const action of batch) {
          action.deleteState = 'failed';
          if (!action.undone) {
            history = history.filter((item) => item !== action);
            reviewed.delete(action.asset.id);
            queue = [action.asset, ...queue.filter((asset) => asset.id !== action.asset.id)];
            passedCount = Math.max(0, passedCount - 1);
          }
        }
        reviewed = new Set(reviewed);
        saveReviewed();
        handleError(error, $t('errors.unable_to_delete_assets'));
      } finally {
        if (deleteQueue.some((action) => action.deleteState === 'queued')) {
          deleteTimer = setTimeout(() => void flushDeleteQueue(), 100);
        }
      }
    })();

    for (const action of batch) {
      action.deletionPromise = completion;
    }
    await completion;
  };

  const queueDelete = (action: Action) => {
    action.deleteState = 'queued';
    deleteQueue.push(action);
    if (!deleteTimer) {
      deleteTimer = setTimeout(() => void flushDeleteQueue(), 250);
    }
  };

  const undo = async (action = history.at(-1)) => {
    if (!action || action.undone || acting) {
      return;
    }

    acting = true;
    try {
      if (action.kind === 'pass') {
        if (action.deleteState === 'queued') {
          action.deleteState = 'cancelled';
          deleteQueue = deleteQueue.filter((item) => item !== action);
        } else if (action.deleteState === 'deleting') {
          await action.deletionPromise;
          if ((action.deleteState as Action['deleteState']) === 'deleted') {
            await restoreAssets({ bulkIdsDto: { ids: [action.asset.id] } });
          }
        } else if (action.deleteState === 'deleted') {
          await restoreAssets({ bulkIdsDto: { ids: [action.asset.id] } });
        }
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

    const asset = current;
    const action = finishAction(asset, 'pass');
    queueDelete(action);
    toastManager.primary(
      {
        description: $t('smash_or_pass_moved_to_trash'),
        button: { label: $t('undo'), color: 'secondary', onclick: () => undo(action) },
      },
      { timeout: 8000 },
    );
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
  <div class="relative flex h-full min-h-[32rem] flex-col items-center justify-center gap-3 overflow-hidden px-2 py-3">
    <div
      class="flex w-full max-w-3xl items-center justify-between rounded-2xl bg-white/75 px-4 py-2 text-sm text-gray-700 shadow-lg backdrop-blur-md dark:bg-black/65 dark:text-gray-200"
    >
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
        class="relative flex min-h-0 w-full max-w-3xl flex-1 touch-pan-y select-none items-center justify-center overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/30"
        onpointerdown={handlePointerDown}
        onpointerup={handlePointerUp}
      >
        {#if current.type === AssetTypeEnum.Video}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            class="h-full max-h-[82dvh] w-full object-contain"
            src={getAssetPlaybackUrl({ id: current.id, cacheKey: current.thumbhash })}
            poster={getAssetUrl({ asset: current })}
            controls
            autoplay
            playsinline
          ></video>
        {:else}
          <img
            class="h-full max-h-[82dvh] w-full object-contain"
            src={getAssetUrl({ asset: current })}
            alt={current.originalFileName}
            draggable="false"
          />
        {/if}
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

      <div
        class="hidden w-full max-w-3xl justify-between rounded-full bg-black/55 px-4 py-2 text-xs text-white/85 backdrop-blur-md md:flex"
      >
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
