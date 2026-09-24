<script lang="ts">
  import { page } from '$app/state';
  import UploadCover from './DragAndDropUploadOverlay.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import type { Snippet } from 'svelte';
  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  // $page.data.asset is loaded by route specific +page.ts loaders if that
  // route contains the assetId path.
  $effect.pre(() => {
    if (page.data.asset) {
      assetViewerManager.setAsset(page.data.asset);
    } else {
      assetViewerManager.showAssetViewer(false);
    }
    const asset = page.url.searchParams.get('at');
    assetViewerManager.gridScrollTarget = { at: asset };
  });
</script>

<div
  aria-hidden="true"
  class="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-60"
  style="background-image: url('/alpen-bg.jpg')"
></div>
<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 bg-white/30 dark:bg-black/40"></div>

<div class="relative z-1 h-dvh" class:display-none={assetViewerManager.isViewing}>
  {@render children?.()}
</div>
<div class="relative z-2"><UploadCover /></div>

<style>
  :root {
    overscroll-behavior: none;
  }
  .display-none {
    display: none;
  }
</style>
