# Client notes

What we learned about real MCP clients while building a server like this one, on 2026-10-28. Clients change often. Check the linked documentation before you rely on a detail here.

## Claude and ChatGPT side by side

| | Claude | ChatGPT |
| --- | --- | --- |
| Add your own server | A connector, added by its URL (Customize > Connectors) | A custom MCP server in developer mode (see below) |
| Sign-in | OAuth, with Client ID Metadata Documents | OAuth; choose Client ID Metadata Documents in the advanced settings |
| The app's client id | Claude Code publishes its document. claude.ai on the web, the desktop app and the phone app share one connection and one id, which is not published | `https://chatgpt.com/oauth/client.json`, published |
| Files from the chat to a tool | No. Pass a reference instead (step 9) | Yes, with `_meta["openai/fileParams"]` (step 10) |
| After you add a tool | Not tested here | The old tool list stays until the person refreshes the plugin |
| Public listing | The Connectors directory, with Verified and Community labels | The plugin directory, after a review (see below) |

Sources: [Claude: get started with connectors](https://claude.com/docs/connectors/overview), [OpenAI: submit a plugin](https://developers.openai.com/apps-sdk/deploy/submission).

## One connection, many apps

A person who connects your server in claude.ai can use it in the Claude desktop app and on the phone too. The connector belongs to their account, so the desktop app makes no second sign-in, and all of these apps send the same client id.

So when you add an unpublished client id to your allow-list (challenge 8 in the README), take it from the first real sign-in, then check every app of that vendor before you rely on it: web, desktop and phone.

## Connecting ChatGPT to your own server

In developer mode, a person adds a custom MCP server roughly like this (the wording in ChatGPT may change):

1. Settings > Plugins > Add > "Add custom MCP server".
2. Enter the server address, ending in `/mcp`, and choose OAuth.
3. Under the advanced OAuth settings, choose Client ID Metadata Document (CIMD) as the registration method. ChatGPT then shows its callback address and its client id.

ChatGPT offers dynamic client registration only if your authorization server metadata lists a registration endpoint. This lab has none, so CIMD is the only choice, and the exact-match rule in `src/oauth/clients.ts` is enough.

A custom server in developer mode is private to the person who added it. It needs no review.

## Tool lists are cached

After our server got a new tool, ChatGPT kept using its old tool list. It told the person that the connector "only supports" the old tools, and it offered to upload the picture with a browser instead. Refreshing the plugin fixed it; reconnecting was not needed.

Three lessons:

- **After you add or change a tool, tell people to refresh** the connector or plugin.
- **Say what is not possible.** Tool descriptions and server instructions should say what the tools cannot do, and what the person can do instead. This lab's server instructions end with: "If no tool fits what the user asks, say what the user can do in the app. Do not try other ways, such as a browser."
- **Test the "tool missing" case.** Ask the model for something no tool does, and read what it tries.

## Check a live test on the server, not in the chat

The chat shows what the model says it did. The server shows what really happened. A call record with the app, the tool, the outcome and the time answers questions like "Did ChatGPT call the new tool at all?" In the cached-list case above, the record showed that the connection was used, but the new tool never ran.

This lab records each picture call with its tool and outcome (`getActivity()` in `src/demo-api.ts`). A real product also records the app, which the access key tells it (step 7).

## What ChatGPT sent in a spike

A throwaway server (step 10, "Find out first") logged this on 2026-10-28:

- The user agent was `openai-mcp/1.0.0`.
- It called `server/discover` before `initialize`. Your server must answer a method it does not know with a normal JSON-RPC error, not crash. The MCP SDK does this for you.
- File links pointed to one file-store host, did not redirect, and stopped working after about 5 minutes.

## Publishing to ChatGPT's plugin directory

OpenAI calls published add-ons "plugins", in ChatGPT and in Codex. Each plugin has at most one MCP server. From [OpenAI's submission page](https://developers.openai.com/apps-sdk/deploy/submission), read on 2026-10-28, a public listing needs:

- a verified individual or business organization;
- a stable, public HTTPS server, and a domain verification token at `/.well-known/openai-apps-challenge`;
- no sign-in, OAuth, or both. API-key sign-in is not supported in the submission portal;
- a website, support, privacy policy and terms of service address, all HTTPS;
- a test account that works at once, without two-step codes, email or SMS codes, or magic links;
- a demo video, and exactly five positive and three negative test cases;
- after publishing: OpenAI scans the server daily, and a new tool stays unavailable until it is approved.

None of this is needed for a custom server in developer mode.
