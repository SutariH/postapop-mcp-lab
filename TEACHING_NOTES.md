# Teaching notes

These notes are for an instructor who runs the lab in [README.md](README.md) with a group. They cover timing, the places where people get stuck, and a 5-minute demo you can give to a customer.

## Before the session

- Run the whole lab yourself on the machine you will present from, the day before. Check every tag: `git checkout step-N && npm ci && npm run typecheck && npm test`.
- Run `npx @modelcontextprotocol/inspector --cli npx tsx src/stdio.ts --method tools/list` once. The first run downloads the Inspector, which takes about 30 seconds. Ask learners to do the same before the session.
- Send the prerequisites a few days ahead: Node.js 22 or later, Git, and Claude Desktop or Claude Code. Ask learners to clone the repository and run `npm install` before they arrive.
- Have a second way to connect ready. Some company-managed Claude Desktop installs do not allow local MCP servers. Claude Code, or the Inspector alone, still lets those learners finish the lab.

## Timing

The lab content takes 45 minutes. Plan a 60-minute slot.

| Section | Minutes | What you do |
| --- | --- | --- |
| Welcome and "What MCP is" | 4 | Draw the diagram from section 1. Say that the model reads tool descriptions as part of its prompt. |
| Setup | 4 | Everyone runs `npm install` and `npm test`. Fix Node versions now, not in step 5. |
| Step 1: a server with no tools | 5 | Live-code `src/stdio.ts`. Stop at the `console.error` line and explain why. |
| Step 2: mock data and a read-only tool | 9 | Show `SchedulingApi` first, then the tool. Ask: "Where would the HTTP call go?" |
| Step 3: a write tool with helpful errors | 9 | Trigger the Bluesky error in the Inspector and read the sentence out loud. |
| Step 4: descriptions that models read well | 6 | Show the weak and the better description side by side. |
| Step 5: build and connect Claude | 5 | Connect Claude Desktop on screen, then let learners connect their own client. |
| Step 6: the same server over HTTP | 7 | Run the two `curl` calls: without the token, then with it. |
| Buffer | 6 | Spend it where the group is slow. It is usually step 5. |
| Questions and "Extend it yourself" | 5 | Point to sections 7 and 8 of the README. |
| **Total** | **60** | |

If you have only 45 minutes, skip live coding in step 6. Check out `step-6`, run the tests, and show the `curl` calls.

Step 7 (remote MCP with OAuth) is a second session of about 60 minutes: 40 minutes of content, plus questions. Do not add it to the first slot. Read it along with the group (`git diff step-6 step-7 -- src/`) rather than live-coding it. Show these four moments:

| Moment | Minutes | What you do |
| --- | --- | --- |
| The 401 | 5 | Run `curl -i -X POST http://localhost:3333/mcp -d '{}'` and read the `WWW-Authenticate` header out loud. Say: "This header is what starts the sign-in." |
| The two documents | 5 | Open both `.well-known` addresses in a browser. Point at `client_id_metadata_document_supported` and `"none"`. |
| The consent page | 10 | Connect Claude Code, press Allow, and show the code in the redirect. Then forward the consent link to a second browser and show the refusal. |
| Refresh reuse | 10 | Run `npx vitest run test/oauth-server.test.ts` and read the test "cancel the whole connection when an old refresh token comes back later". |

Step 9 (advanced: pictures from another service) fits in the same second session, or in a third one. Show these moments:

| Moment | Minutes | What you do |
| --- | --- | --- |
| Why not a file | 5 | Ask the group: "How would you send a picture through a tool?" Then explain that Claude cannot pass a file from the chat, and show the two references the tool accepts. |
| The order of checks | 10 | Open `src/pictures/attach-design.ts` and read the numbered comments. Ask which check is the expensive one, and why the hourly limit comes last. |
| Unchanged or not | 5 | Read the test "decides 'unchanged' by the OLDEST picture, not the newest" and ask why `Math.max` would be wrong. |
| Two calls at once | 10 | Remove `withPostLock` from `attachDesign` and run `npx vitest run test/attach-design.test.ts`. "Lets two calls for one post take turns" still passes: the fenced save covers it. "Exports a design once when the same call arrives twice at once" fails: only the queue prevents the double export. Put it back. |

## Where people get stuck

**Setup**

- *`npm install` fails or is slow.* A company proxy or an old npm is the usual cause. Ask the learner to pair with a neighbor for the first steps and to fix the install during a break.
- *Wrong Node.js version.* `node --version` shows 18 or 20. With nvm, run `nvm install 22 && nvm use 22`. The repository has an `.nvmrc`, so `nvm use` alone also works.

**Step 1**

- *"The tool list is empty. Did I break it?"* No. Step 1 has no tools on purpose. The empty list proves that the connection works.
- *The Inspector web page does not open.* Port 6274 or 6277 is in use. Use CLI mode (`--cli`) for the rest of the lab.

**Step 2**

- *`Relative import paths need explicit file extensions`.* The project uses Node.js ES modules, so imports end in `.js`, even in `.ts` files: `import { createServer } from './server.js'`. TypeScript maps `.js` to the `.ts` file.
- *A valid-looking time is rejected.* `2026-11-02T09:00:00` has no offset. Add `Z` or `-05:00`. This is on purpose: without an offset, the time is ambiguous.
- *"Why is there an interface? It is only a mock."* Ask the learner to imagine the real API client. The interface is the line between "MCP work" and "product work".

**Step 3**

- *"Why does the model see my `ApiError` message, but not other errors?"* `toErrorResult` passes through only errors the API raises on purpose. Anything else is a bug, so the details go to stderr and the model gets a generic sentence. Show `src/tools/results.ts`.
- *A test expects `post_101`, but gets `post_102`.* The test reused an API from another test. Each test must call `connectClient()`, which creates a fresh mock API.

**Step 4**

- *"Is this description too long?"* Use the checklist in the README. Each sentence must change what the model does. If it does not, cut it.
- *Learners want to turn `null` into `0` to "clean up" the data.* Ask them what a user would conclude from "0 impressions" on a post that Bluesky never measured.

**Step 5**

This is the step where most groups lose time.

- *Claude Desktop does not show the server.* Check four things, in this order:
  1. Did the learner quit Claude Desktop completely, not only close the window?
  2. Is the path absolute, and does `dist/stdio.js` exist? (`npm run build`.)
  3. Is the JSON valid? A missing comma breaks the whole file. On Windows, backslashes in paths must be doubled: `"C:\\Users\\you\\postapop-mcp-lab\\dist\\stdio.js"`.
  4. Does Claude Desktop find the right `node`? Use the absolute path from `which node` (on Windows: `where node`).

  Then read the server log: `~/Library/Logs/Claude/mcp-server-postapop-demo.log` on macOS, `%APPDATA%\Claude\logs\` on Windows.
- *Claude Code says the server failed.* Run `claude mcp list` to see the error. If the learner added the server in another folder with a relative path, remove it (`claude mcp remove postapop-demo`) and add it again with an absolute path.

**Step 6**

- *`LAB_DEMO_TOKEN is missing`.* The learner did not create `.env`, or created it in another folder. Run `ls -a` in the lab folder.
- *`406 Not Acceptable` from `curl`.* The `Accept` header is missing. Copy the full command from the README.
- *`curl` on Windows mangles the JSON.* Use Git Bash or WSL for this step, or call the server from the tests instead (`npm test`).
- *`EADDRINUSE`.* Another program uses port 3333. Set `LAB_HTTP_PORT=3334` in `.env`.

**Step 7**

- *"This app is not on the list".* The learner connected an app that is not in `src/oauth/clients.ts`, often claude.ai in the browser. The server prints the refused `client_id`. Use Claude Code for the session.
- *The client refuses `http://localhost`.* Some clients accept only `https` for a sign-in server. Use a tunnel (README, step 7, "Try it") and set `LAB_ISSUER` to its address.
- *"Started in another browser".* The learner opened the consent link in a different browser or a private window. Start the sign-in again from the AI tool.
- *Every connection is gone.* The server keeps everything in memory, so a restart ends every connection. This is on purpose for the lab.

## A 5-minute demo for a customer

**Goal:** show a customer how an MCP server lets Claude work with their product, safely, using their own API.

**Set up before the meeting:**

- Build the server (`npm run build`) and connect it to Claude Desktop (README section 5).
- Quit and reopen Claude Desktop right before the demo. The data is in memory, so a restart gives you a clean calendar with no drafts from your rehearsal.
- In a rehearsal chat, allow `list_scheduled_posts` and `get_post_results` with "Always allow". Leave `create_draft_post` on "ask", so the audience sees Claude ask before it writes.
- Open a new chat. Have `src/tools/create-draft-post.ts` open in an editor, in a second window.

**Minute 0 to 1: the setup**

Say: "This is Claude Desktop with a small MCP server connected. The server is a demo for a social media scheduling product, with mock data for a made-up plant shop called Moss & Fern. It has three tools: one reads the calendar, one saves drafts, and one reads post results. It never schedules or publishes. That stays with the user, in the product."

Open the tools menu and show the three tools.

**Minute 1 to 2: read the calendar**

Type:

> What's scheduled for Moss & Fern next week?

Point out the tool call to `list_scheduled_posts`. Say: "Claude chose the tool from its description. The answer comes from the product's data, not from the model's memory. The times come back in UTC with the shop's time zone, and Claude converts them."

**Minute 2 to 3: write a draft**

Type:

> Draft a LinkedIn post about our autumn repotting workshop.

Claude may first call `list_scheduled_posts` to find the LinkedIn channel id. Then it asks for permission to use `create_draft_post`. Approve it. Say: "This is the only tool that changes anything, and all it does is save a draft. The result tells Claude that the post is not scheduled, so Claude does not tell you that it is."

**Minute 3 to 4: a refusal, and the recovery**

Type:

> Also save this exact text as a Bluesky draft, word for word: "Our autumn repotting workshop is back on Saturday at 10 am. Bring one plant that has outgrown its pot, and we will help you choose the right soil, the right pot size and the right spot at home. Every guest leaves with a new terracotta pot, a bag of peat-free mix and a printed care card. Coffee and cake are on us. Ten seats left, so book at the counter or reply to this post."

The text is 376 characters. Bluesky allows 300. The tool refuses with: "This draft is 376 characters long, but Bluesky allows 300. Cut at least 76 characters, or leave the Bluesky channel (ch_bluesky) out of this draft."

Watch what Claude does next. Usually it shortens the text and tries again, or it asks you whether a shorter version is acceptable. Both are good outcomes. Say: "The product enforced its own rule. The error was one plain sentence with a number in it, so Claude could fix the problem without a developer."

Switch to the editor for 15 seconds and show the `ApiError` sentence in `src/demo-api.ts`.

**Minute 4 to 5: numbers, read correctly**

Type:

> How did our posts do in the last 7 days? Which one did best?

Point out two things in the answer. First, Claude says that some numbers are not reported yet, instead of calling them zero. Second, Claude compares posts within one network and does not add Instagram and Bluesky numbers into one total. Say: "Those two rules are in the tool description, and again next to the numbers in the result. That is where the model needs them."

Close with: "Your product's API stays the source of truth. The MCP server is a thin layer: tool names and descriptions written for the model, honest annotations, and errors written as sentences. The same server runs over stdio for desktop apps and over HTTP for hosted use."

**If something goes wrong during the demo**

- If Claude answers without calling a tool, say "Use the Postapop demo tools" and ask again.
- If the server does not appear, show the same calls with the Inspector CLI: `npx @modelcontextprotocol/inspector --cli node dist/stdio.js --method tools/call --tool-name list_scheduled_posts`.
- Model output varies from run to run. Rehearse twice, and describe what the tools do, not the exact words Claude will say.
