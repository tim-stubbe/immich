<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { forkUpdateManager } from '$lib/managers/fork-update-manager.svelte';
  import { releaseManager } from '$lib/managers/release-manager.svelte';
  import ServerAboutModal from '$lib/modals/ServerAboutModal.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { websocketStore } from '$lib/stores/websocket';
  import { semverToName } from '$lib/utils';
  import { requestServerInfo } from '$lib/utils/auth';
  import {
    getAboutInfo,
    getVersionHistory,
    type ReleaseEventV1,
    type ServerAboutResponseDto,
    type ServerVersionHistoryResponseDto,
  } from '@immich/sdk';
  import { Icon, modalManager, Text } from '@immich/ui';
  import { mdiAlert, mdiNewBox } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  const { serverVersion, connected } = websocketStore;

  let info: ServerAboutResponseDto | undefined = $state();
  let versions: ServerVersionHistoryResponseDto[] = $state([]);

  let forkPollHandle: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    forkPollHandle = forkUpdateManager.startPolling();

    if (userInteraction.aboutInfo && userInteraction.versions && $serverVersion) {
      info = userInteraction.aboutInfo;
      versions = userInteraction.versions;
      return;
    }
    await requestServerInfo();
    [info, versions] = await Promise.all([getAboutInfo(), getVersionHistory()]);
    userInteraction.aboutInfo = info;
    userInteraction.versions = versions;
  });

  onDestroy(() => {
    clearInterval(forkPollHandle);
  });

  let isMain = $derived(info?.sourceRef === 'main' && info.repository === 'immich-app/immich');
  let version = $derived($serverVersion ? semverToName($serverVersion) : null);
  let buildAge = $derived(info?.buildDate ? DateTime.fromISO(info.buildDate).toRelative({ locale: $locale }) : null);
  let isForkOutdated = $derived(
    info?.sourceCommit && forkUpdateManager.value && info.sourceCommit !== forkUpdateManager.value.latestCommit,
  );
  let forkUpdatePushedAgo = $derived(
    forkUpdateManager.value ? DateTime.fromISO(forkUpdateManager.value.latestCommitDate).toRelative({ locale: $locale }) : null,
  );

  const getReleaseInfo = (release?: ReleaseEventV1) => {
    if (!release || !release?.isAvailable || !authManager.user.isAdmin) {
      return;
    }

    const availableVersion = semverToName(release.releaseVersion);
    const serverVersion = semverToName(release.serverVersion);

    if (serverVersion === availableVersion) {
      return;
    }

    return { availableVersion, releaseUrl: `https://github.com/immich-app/immich/releases/tag/${availableVersion}` };
  };

  const releaseInfo = $derived(getReleaseInfo(releaseManager.value));
</script>

<div
  class="flex min-w-52 place-content-center place-items-center justify-between overflow-hidden ps-5 pe-1 text-sm md:flex dark:text-immich-dark-fg"
>
  {#if $connected}
    <div class="flex place-content-center place-items-center gap-2">
      <div class="size-1.75 rounded-full bg-green-500"></div>
      <p class="dark:text-immich-gray">{$t('server_online')}</p>
    </div>
  {:else}
    <div class="flex place-content-center place-items-center gap-2">
      <div class="size-1.75 rounded-full bg-red-500"></div>
      <p class="text-red-500">{$t('server_offline')}</p>
    </div>
  {/if}

  <div class="flex justify-between justify-items-center">
    {#if $connected && version}
      <button
        type="button"
        onclick={() => info && modalManager.show(ServerAboutModal, { versions, info })}
        class="flex place-content-center place-items-center gap-1 dark:text-immich-gray"
      >
        {#if isMain}
          <Icon icon={mdiAlert} size="1.5em" color="#ffcc4d" /> {info?.sourceRef}
        {:else}
          {version}
        {/if}
      </button>
    {:else}
      <p class="text-red-500">{$t('unknown')}</p>
    {/if}
  </div>
</div>

{#if buildAge}
  <div class="ms-5 text-[11px] text-gray-500 opacity-70 dark:text-gray-400">
    {buildAge}
  </div>
{/if}

{#if isForkOutdated}
  <a
    href="https://github.com/tim-stubbe/immich/commit/{forkUpdateManager.value?.latestCommit}"
    target="_blank"
    rel="noopener noreferrer"
    class="group ms-4 mt-3 block min-w-52 rounded-lg border border-gray-200/50 bg-white/50 p-2.5 text-sm transition-all duration-200 hover:border-immich-primary/40 hover:bg-immich-primary/5 dark:border-gray-700/50 dark:bg-gray-800/50 dark:hover:border-immich-dark-primary/40 dark:hover:bg-immich-dark-primary/5"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Icon icon={mdiNewBox} size="16" class="text-immich-primary opacity-80 dark:text-immich-dark-primary" />
        <Text size="tiny" fontWeight="medium" class="text-gray-700 dark:text-gray-300">
          {$t('fork_update_available')}
        </Text>
      </div>
      {#if forkUpdatePushedAgo}
        <span
          class="text-[11px] text-gray-500 opacity-70 transition-colors group-hover:text-immich-primary group-hover:opacity-100 dark:text-gray-400 dark:group-hover:text-immich-dark-primary"
        >
          {$t('fork_update_pushed', { values: { time: forkUpdatePushedAgo } })}
        </span>
      {/if}
    </div>
  </a>
{/if}

{#if releaseInfo}
  <a
    href={releaseInfo.releaseUrl}
    target="_blank"
    rel="noopener noreferrer"
    class="group ms-4 mt-3 block min-w-52 rounded-lg border border-gray-200/50 bg-white/50 p-2.5 text-sm transition-all duration-200 hover:border-immich-primary/40 hover:bg-immich-primary/5 dark:border-gray-700/50 dark:bg-gray-800/50 dark:hover:border-immich-dark-primary/40 dark:hover:bg-immich-dark-primary/5"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Icon icon={mdiNewBox} size="16" class="text-immich-primary opacity-80 dark:text-immich-dark-primary" />
        <Text size="tiny" fontWeight="medium" class="text-gray-700 dark:text-gray-300">
          {releaseInfo.availableVersion}
        </Text>
      </div>
      <span
        class="text-[11px] text-gray-500 opacity-70 transition-colors group-hover:text-immich-primary group-hover:opacity-100 dark:text-gray-400 dark:group-hover:text-immich-dark-primary"
      >
        {$t('new_update')}!
      </span>
    </div>
  </a>
{/if}
