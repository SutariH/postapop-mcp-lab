import { isLoopbackOnly, type KnownClient } from './clients.js';

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #1d2426; }
  .card { border: 1px solid #d9e3de; border-radius: 12px; padding: 1.5rem; }
  .warn { background: #fff6e3; border-radius: 8px; padding: .75rem 1rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
  button { font: inherit; padding: .5rem 1.25rem; border-radius: 8px; border: 1px solid #0f3a40; cursor: pointer; }
  button[value="allow"] { background: #0f3a40; color: #fff; }
  button[value="deny"] { background: #fff; color: #0f3a40; }
  .meta { color: #56676a; font-size: .9rem; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

/** The page where the person presses Allow or Deny. */
export function consentPage(requestId: string, client: KnownClient, redirectUri: string) {
  const name = escape(client.name);
  const returnHost = escape(new URL(redirectUri).hostname);
  const loopbackWarning = isLoopbackOnly(client)
    ? `<p class="warn">${name} runs on your own computer. Press Allow only if you started this connection just now, in ${name}, on this computer.</p>`
    : `<p class="warn">Press Allow only if you started this connection just now in ${name}.</p>`;

  return page(
    `Connect ${client.name}`,
    `<h1>Connect ${name} to Moss &amp; Fern?</h1>
<p>${name} will be able to list your posts, read their results, save drafts and add pictures to drafts. It cannot publish.</p>
${loopbackWarning}
<p class="meta">After you choose, your browser returns to ${returnHost}. You are signed in as the demo user: this lab has no real login.</p>
<form method="post" action="/consent/${escape(requestId)}">
  <div class="actions">
    <button type="submit" name="decision" value="allow">Allow</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </div>
</form>`,
  );
}

export function errorPage(message: string) {
  return page('Sign-in stopped', `<h1>Sign-in stopped</h1><p>${escape(message)}</p>`);
}
