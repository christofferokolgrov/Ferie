'use server';

// Server action: trigger the Apollo sweep GitHub Actions workflow (workflow_dispatch).
// Runs only on the server, so the token never reaches the browser.
export async function triggerSweep() {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo = process.env.GH_REPO ?? 'christofferokolgrov/Ferie';
  const workflow = process.env.GH_WORKFLOW ?? 'sweep.yml';
  const ref = process.env.GH_REF ?? 'main';

  if (!token) {
    return { ok: false, message: 'GH_DISPATCH_TOKEN is not configured on the server.' };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref }),
        cache: 'no-store',
      },
    );
    // GitHub returns 204 No Content on a successful dispatch.
    if (res.status === 204) {
      return { ok: true, message: 'Sweep started — results appear here in a few minutes.' };
    }
    const body = await res.text().catch(() => '');
    return { ok: false, message: `GitHub ${res.status}: ${body.slice(0, 200) || 'dispatch failed'}` };
  } catch (err) {
    return { ok: false, message: `Request failed: ${err?.message ?? err}` };
  }
}
