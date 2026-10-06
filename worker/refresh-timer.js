// Hourly refresh timer for pollsvsodds.com.
// GitHub's built-in schedule often runs hours late, so this Cloudflare Worker fires at the top of every hour
// and asks GitHub to run the "Refresh data and deploy" workflow.
const WORKFLOW = "https://api.github.com/repos/sulaimwn/polls-vs-odds/actions/workflows/deploy.yml/dispatches";

async function triggerRefresh(env) {
  const res = await fetch(WORKFLOW, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pollsvsodds-refresh-timer",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}: ${await res.text()}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerRefresh(env));
  },
};
