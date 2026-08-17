const REPO = 'tim-stubbe/immich';
const BRANCH = 'custom-features';
const POLL_INTERVAL_MS = 5 * 60 * 1000;

class ForkUpdateManager {
  value = $state<{ latestCommit: string; latestCommitDate: string } | undefined>();

  async check() {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      this.value = { latestCommit: data.sha, latestCommitDate: data.commit.author.date };
    } catch {
      // offline or rate-limited - keep last known value
    }
  }

  startPolling() {
    void this.check();
    return setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }
}

export const forkUpdateManager = new ForkUpdateManager();
