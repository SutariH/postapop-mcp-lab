# Build your own MCP server for a SaaS product

A 45-minute hands-on lab, plus a 40-minute step on sign-in. You build a Model Context Protocol (MCP) server for a demo of Postapop, a social media scheduling SaaS. When you finish, Claude can read a brand's post calendar, save draft posts and report post results through your server. In the last step, AI tools connect to it through an OAuth sign-in instead of a shared token.

> **This is a teaching demo with mock data.** The server reads and writes an in-memory data set for a made-up plant shop called Moss & Fern. It does not call the real Postapop API, and it needs no account or API key.

## 1. What you will build

You build one MCP server with three tools: `list_scheduled_posts`, `create_draft_post` and `get_post_results`. Claude calls these tools when a user asks things like "What is scheduled for next week?" The server does not hold the product logic. It translates between the model and the product's API. In this lab, a small mock module stands in for that API, so you can see exactly where a real HTTP call would go.

```
+-----------------+    MCP messages    +---------------+    API calls      +-----------------+
|  Claude         | <----------------> |  Your MCP     | <---------------> |  Your product's |
|  (MCP client)   |   stdio or HTTP    |  server       |  (a mock in this  |  API            |
+-----------------+                    +---------------+   lab)            +-----------------+
```

## 2. What MCP is and why it matters

A language model can only work with what is in its context. To act on a product, such as a scheduling app, the model needs a way to ask the product for data and to ask it to do things.

MCP is an open protocol for that connection. An MCP server describes a set of tools: a name, a description, and a JSON Schema for the inputs. An MCP client, such as Claude Desktop or Claude Code, shows those descriptions to the model. When the model decides to use a tool, the client sends the call to the server and gives the result back to the model.

The benefit is reuse. You write one server for your product, and any MCP client can use it. You do not write a separate plugin for each AI app.

A server can offer three kinds of things: tools (actions the model can call), resources (data the client can read) and prompts (templates the user can pick). This lab uses tools, because tools are what most product integrations need first.

Two facts shape everything in this lab:

- **The model reads your tool names, descriptions and input schemas.** They are part of the prompt. Clear text gives better tool use.
- **The model acts on what your tools return.** A clear result or a clear error sentence lets the model take the next step without help.

## 3. Prerequisites and setup

You need:

- **Node.js 22 or later.** Check with `node --version`.
- **An MCP client.** Claude Desktop or Claude Code. You connect it in step 5. Until then, you test with the MCP Inspector, which runs through `npx`.
- **Git**, to move between checkpoints.

Clone the repository and install the dependencies:

```bash
git clone <this-repository-url> postapop-mcp-lab
cd postapop-mcp-lab
npm install
```

Each step of the lab is a Git tag: `step-1` to `step-8`. Every tag is a working checkpoint where the tests pass. You can follow the lab in two ways:

- **Type along.** Start a branch of your own at step 1 with `git switch -c my-lab step-1`, then write the code for each next step yourself. If you get stuck, compare your files with the next tag: `git diff step-3 -- src/`.
- **Read along.** Check out each tag in turn and read what changed: `git checkout step-3`, then `git diff step-2 step-3`.

All steps use the same dependencies, so one `npm install` is enough.

The lab pins exact versions of every dependency, so that the code and the expected output in this README match. Before you use this code for a real product, update the dependencies and run `npm audit`.

## 4. The steps

Each step ends with a checkpoint: "At this point you should see this." The test counts in a checkpoint are for that step's tag. On `main`, which is step 8, `npm test` runs all 69 tests.

| Step | What you add | Minutes |
| --- | --- | --- |
| Setup | Clone and install | 4 |
| 1 | A server with no tools, over stdio | 5 |
| 2 | Mock data and a read-only tool | 9 |
| 3 | A write tool with validation and helpful errors | 9 |
| 4 | Results, and descriptions that models read well | 6 |
| 5 | Build it and connect Claude | 5 |
| 6 | The same server over HTTP | 7 |
| 7 | Remote MCP with sign-in (OAuth) | 40 |
| | **Total** | **85** |
| 8 | After the lab: design notes and challenges | on your own |

### Step 1: A server with no tools (5 minutes)

**Goal:** start an MCP server that a client can connect to, and see it in the MCP Inspector.

An MCP server has two parts: the server object, which knows the tools, and a transport, which moves messages. Keep them apart. In step 6 you connect the same server to a second transport.

`src/server.ts` creates the server. The name and version are what a client sees when it connects.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_INFO = { name: 'postapop-demo', version: '0.1.0' };

export function createServer() {
  const server = new McpServer(SERVER_INFO);

  // Steps 2 to 4 register tools here.

  return server;
}
```

`src/stdio.ts` connects the server to the stdio transport. With stdio, the client starts your server as a child process and talks to it through standard input and standard output.

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
await server.connect(new StdioServerTransport());

// stdout carries the protocol messages. Log to stderr only.
console.error('Postapop demo MCP server is running on stdio.');
```

Note the last line. Standard output belongs to the protocol. If you write `console.log('hello')` in a stdio server, the client receives `hello` where it expects a JSON-RPC message, and the connection breaks. Use `console.error` for all logging.

`test/helpers.ts` connects a real MCP client to the server in memory, with `InMemoryTransport.createLinkedPair()`. The tests use it to call the server without a process or a network.

**At this point you should see this.** Run the tests:

```bash
npm test
```

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Then ask the server for its tools with the Inspector in CLI mode:

```bash
npx @modelcontextprotocol/inspector --cli npx tsx src/stdio.ts --method tools/list
```

```
Postapop demo MCP server is running on stdio.
{
  "tools": []
}
```

The first line is the server's log on stderr. The JSON is the server's answer: no tools yet. To use the Inspector in the browser instead, leave out `--cli` and `--method tools/list`, open the address it prints, and select **Connect**.

### Step 2: Mock data and a read-only tool (9 minutes)

**Goal:** add the product's API (a mock) and a first tool, `list_scheduled_posts`, that answers "What is scheduled next week?"

#### Keep the product out of the MCP layer

Before you write a tool, decide where the product rules live. They do not belong in the MCP server. The server is an adapter: it turns a tool call into an API call, and an API result into text for the model. If the product rules lived in the tools, you would have two copies of them: one in the product and one in the server. They would drift apart.

This step adds three files for the product side:

- `src/scheduling-api.ts` is the contract. It defines the types (`Channel`, `Post`, `Workspace`), the `SchedulingApi` interface and an `ApiError` class. The tools only know this file.
- `src/demo-data.ts` is the mock data: the Moss & Fern workspace, three channels and thirteen posts. Post times are relative to "now", so the calendar always has upcoming posts.
- `src/demo-api.ts` implements `SchedulingApi` in memory. Each method is where a real client would call your HTTP API. The rules live here too: the default time window, and the 31-day limit.

```ts
export interface SchedulingApi {
  getWorkspace(): Promise<Workspace>;
  listPosts(query: PostListQuery): Promise<PostList>;
}
```

The methods return promises, although the mock answers at once. A real API call is asynchronous, so the tools are ready for one.

`ApiError` is for errors the API reports on purpose, such as a window that is too long. Its message is a plain sentence. In step 3 you see why that matters.

```ts
throw new ApiError(
  'window_too_long',
  `The window is ${days} days long, but the longest allowed window is ${MAX_WINDOW_DAYS} days. Ask for a shorter window, or make one call per month.`,
);
```

#### Register the tool

`src/tools/list-scheduled-posts.ts` registers the tool with `server.registerTool(name, config, handler)`. The config has four parts, and the model reads three of them:

- **`description`** says what the tool does, when to use it, and what it never does. Step 4 covers how to write it.
- **`inputSchema`** is a set of zod schemas. The SDK turns them into JSON Schema for the model, and it checks every call against them before your handler runs.
- **`annotations`** are hints for the client. `readOnlyHint: true` says the tool changes nothing, so a client may decide to run it without asking the user first. (`destructiveHint` and `idempotentHint` describe changes, so they matter only when `readOnlyHint` is `false`. That is why this tool leaves them out.) `openWorldHint: false` says the tool works inside a closed system (one workspace), not the open internet.
- **`title`** is a human-readable name that clients can show in their interface.

```ts
inputSchema: {
  status: z
    .enum(['upcoming', 'drafts', 'published'])
    .default('upcoming')
    .describe('Which posts to list.'),
  from: isoTime
    .optional()
    .describe('Start of the time window, ISO 8601 with an offset, for example 2026-11-02T00:00:00-05:00.'),
  to: isoTime
    .optional()
    .describe('End of the time window (not included), ISO 8601 with an offset.'),
},
```

`isoTime` accepts an ISO 8601 time with an offset, such as `2026-11-02T09:00:00-05:00` or `2026-11-02T09:00:00Z`, and it rejects a time with no offset. Without an offset, "9:00" could mean 9:00 anywhere. The custom `error` text tells the model how to fix a bad value.

`isoTime` is a union of two zod 4 checks: `z.iso.datetime({ offset: true })` and the same check with `precision: -1`, which is a time with minutes but no seconds. Models often leave out the seconds, for example `2026-11-02T09:00-05:00`. Since zod 4.6.6, `z.iso.datetime()` alone refuses that form, so the second check keeps such a request working.

The handler calls the API, shapes the result for the model and catches every error:

```ts
async ({ status, from, to }) => {
  try {
    const [workspace, list] = await Promise.all([
      api.getWorkspace(),
      api.listPosts({ status, from, to }),
    ]);

    return jsonResult({
      workspace: workspace.name,
      time_zone: workspace.timeZone,
      status,
      window: list.window,
      channels: workspace.channels,
      posts: list.posts.map((post) => formatPost(post, workspace)),
      ...(list.posts.length === 0 && { note: `There are no ${status} posts in this window.` }),
    });
  } catch (error) {
    return toErrorResult(error);
  }
},
```

Three choices in this handler help the model:

- The result includes the channel list. The model needs channel ids for `create_draft_post` in step 3, and now it can find them.
- The result includes the workspace time zone. Times are UTC, and the description tells the model to convert them before it talks to the user.
- An empty list comes with a sentence. A model reads "There are no upcoming posts in this window." more reliably than `[]`.

`toErrorResult` lives in `src/tools/results.ts`. It turns an `ApiError` into a result with `isError: true` and the error's sentence. Any other error is a bug, so it logs the details to stderr and gives the model a short sentence with no internals.

Finally, `createServer` now takes the API as an argument, and `src/stdio.ts` passes it `createDemoApi()`. The server does not create its own API client. That is what lets the tests give it a mock with a fixed clock.

**At this point you should see this.** Run the tests:

```bash
npm test
```

```
 Test Files  2 passed (2)
      Tests  12 passed (12)
```

Call the tool with the Inspector:

```bash
npx @modelcontextprotocol/inspector --cli npx tsx src/stdio.ts \
  --method tools/call --tool-name list_scheduled_posts
```

You get JSON with `"workspace": "Moss & Fern"`, the three channels and four upcoming posts. The times depend on today's date. Now try a bad window:

```bash
npx @modelcontextprotocol/inspector --cli npx tsx src/stdio.ts \
  --method tools/call --tool-name list_scheduled_posts \
  --tool-arg from=2026-11-01T00:00:00Z --tool-arg to=2026-12-15T00:00:00Z
```

```
{
  "content": [
    {
      "type": "text",
      "text": "The window is 44 days long, but the longest allowed window is 31 days. Ask for a shorter window, or make one call per month."
    }
  ],
  "isError": true
}
{"error":{"code":"tool_is_error","message":"Tool 'list_scheduled_posts' returned isError:true."}}
```

The Inspector adds the last line and exits with a non-zero code, because the tool reported an error. The error itself is a tool result, not a protocol failure. The model reads the sentence and can try again with a shorter window.

### Step 3: A write tool with validation and helpful errors (9 minutes)

**Goal:** let Claude save a draft post, and make every refusal easy for the model to fix.

A write tool needs more care than a read tool. Ask three questions before you write it:

1. **What is the smallest action that is useful?** Here it is "save a draft". Scheduling and publishing reach real audiences, so they stay out of this tool. The user does those in the product.
2. **What happens if the model calls it twice?** Two drafts. That is harmless, but the description must say so, and the annotations must not claim the tool is idempotent.
3. **What can go wrong, and what should the model do then?** Each answer becomes one error sentence.

#### The API side

`createDraft` is a new method on `SchedulingApi`. The mock in `src/demo-api.ts` checks two product rules. Every channel id must exist, and the text must fit every chosen network. Bluesky allows 300 characters.

```ts
function checkTextLength(text: string, channel: Channel) {
  const limit = TEXT_LIMITS[channel.network];
  const length = countCharacters(text);
  if (length > limit) {
    throw new ApiError(
      'text_too_long',
      `This draft is ${length} characters long, but ${channel.network} allows ${limit}. Cut at least ${length - limit} characters, or leave the ${channel.network} channel (${channel.id}) out of this draft.`,
    );
  }
}
```

The message does the arithmetic for the model. "Too long" makes the model guess how much to cut. "Cut at least 112 characters" gives it a target. The message also offers a second way out: leave Bluesky out of the draft.

The unknown-channel error lists the valid ids, so the model can correct itself in one more call:

```
There is no channel with id "ch_twitter". The channel ids in this workspace are ch_instagram (Instagram), ch_linkedin (LinkedIn), and ch_bluesky (Bluesky).
```

`countCharacters` counts what people see as characters (grapheme clusters), not UTF-16 code units. JavaScript's `text.length` counts "é" as two when it is written as "e" plus a combining accent. Bluesky counts it as one. One of the tests checks this.

#### The tool side

`src/tools/create-draft-post.ts` follows the same pattern as step 2. Three parts are new.

The input schema carries its own error messages. If the model sends empty text, the message says what to do. The 2,000-character cap is part of this tool's contract: it keeps inputs to a sane size before any API call. The network limits (300 for Bluesky) are product rules, so they stay in the API.

```ts
text: z
  .string()
  .trim()
  .min(1, 'text is empty. Write the post text, then call the tool again.')
  .max(2000, 'text is longer than 2,000 characters. Shorten it, then call the tool again.')
  .describe('The full post text, 1 to 2,000 characters.'),
channel_ids: z
  .array(z.string().min(1))
  .max(10)
  .default([])
  .describe(
    'The channels the post is meant for, for example ["ch_linkedin"]. Leave it out to save a draft with no channel yet.',
  ),
```

The annotations describe a write tool:

```ts
annotations: {
  readOnlyHint: false,    // it changes data
  destructiveHint: false, // it only adds; it never deletes or overwrites
  idempotentHint: false,  // a second call creates a second draft
  openWorldHint: false,   // it stays inside the workspace
},
```

A client can use these hints to decide when to ask the user for permission. They are hints, not security. A client must not trust annotations from a server it does not trust, and your API must enforce its own rules either way.

The result ends with a note: "Saved as a draft. It is not scheduled and will not be published." Without it, a model may tell the user "Your post is scheduled", which is false.

**At this point you should see this.** Run the tests:

```bash
npm test
```

```
 Test Files  3 passed (3)
      Tests  22 passed (22)
```

Save a draft with the Inspector:

```bash
npx @modelcontextprotocol/inspector --cli npx tsx src/stdio.ts \
  --method tools/call --tool-name create_draft_post \
  --tool-arg 'text=Our autumn repotting workshop is back.' \
  --tool-arg 'channel_ids=["ch_linkedin"]'
```

The text of the result, unescaped, is:

```json
{
  "id": "post_101",
  "status": "draft",
  "text": "Our autumn repotting workshop is back.",
  "channels": [
    {
      "id": "ch_linkedin",
      "network": "LinkedIn"
    }
  ],
  "note": "Saved as a draft. It is not scheduled and will not be published. The user can review and schedule it in the app."
}
```

Then try `channel_ids=["ch_twitter"]` and read the error sentence. Each Inspector CLI call starts a new server process, and the data lives in memory, so every call starts from the same mock data. That is why the draft id is `post_101` every time.

### Step 4: Results, and descriptions that models read well (6 minutes)

**Goal:** add `get_post_results`, and learn to write tool text for the model, not for a developer.

#### The tool

`get_post_results` takes one input, `days`, which must be 7, 30 or 90. In zod 4, `z.literal([7, 30, 90])` accepts any of the three, and the SDK sends it to the model as a JSON Schema `enum`:

```ts
days: z
  .literal([7, 30, 90], { error: 'days must be 7, 30 or 90.' })
  .default(30)
  .describe('How many days to look back: 7, 30 or 90.'),
```

The API method `getResults` returns one row per post and channel. Some numbers are `null`. Bluesky does not report impressions, and the newest posts have numbers that the networks have not reported yet.

This is the trap. A model that sees `"impressions": null` may say "this post had no impressions". A model that sees numbers from three networks may add them up into one total. Both answers are wrong. Instagram, LinkedIn and Bluesky count in different ways, so a sum means nothing. The tool guards against both mistakes in two places:

- the description: "Never treat null as zero: say the number is not reported." and "never add numbers across networks";
- the result itself, in a `how_to_read` field, next to the numbers the model reads.

```json
{
  "workspace": "Moss & Fern",
  "period": { "days": 7, "from": "2026-10-26T12:00:00.000Z", "to": "2026-11-02T12:00:00.000Z" },
  "how_to_read": "null means the network has not reported this number. It is not zero. Each network counts differently, so compare posts within one network and never add numbers across networks.",
  "posts": [
    {
      "id": "post_006",
      "published_at": "2026-11-01T17:00:00.000Z",
      "text": "Rainy day at the shop. The kettle is on and the calatheas look happy. Open unti…",
      "results": [
        { "channel_id": "ch_bluesky", "network": "Bluesky", "impressions": null, "likes": 21, "comments": 3, "shares": null }
      ]
    }
  ]
}
```

Why say it twice? The description is read when the model chooses a tool. The result is read when the model writes its answer, often many turns later. Put a warning where the model needs it.

#### Writing descriptions that models read well

The model decides which tool to call, and with which inputs, from the name, the description and the input schema. Nothing else. Write them as you would write instructions for a new colleague who cannot ask you questions.

Use this checklist for every tool:

1. **Name: verb plus noun, in snake_case.** `list_scheduled_posts` says what it does. `posts` or `query` does not. Tool names share one list with tools from other servers, so make them specific.
2. **First sentence: what the tool does.** "Saves a new draft post in the workspace's calendar."
3. **When to use it, in the user's words.** "Use it to answer questions such as "What is scheduled next week?"" This helps the model match a request to a tool.
4. **What it never does.** "It never schedules or publishes anything." This sentence prevents the most expensive mistake, and it lets the model reassure the user.
5. **The limits.** 31 days, 300 characters for Bluesky, 7, 30 or 90 days. If the model knows a limit, it does not have to learn it from an error.
6. **How to read the result.** Times are UTC; `null` is not zero.
7. **How the tools fit together.** "Get them from the channels list in a list_scheduled_posts result."
8. **Each parameter: format and one example.** "ISO 8601 with an offset, for example 2026-11-02T00:00:00-05:00."
9. **Short.** Every tool description goes into the model's context on every turn. Cut sentences that do not change what the model does.

Compare a weak description with the one in this lab:

| Weak | Better |
| --- | --- |
| "Gets post analytics." | "Returns the numbers (impressions, likes, comments, shares) for posts published in the last 7, 30 or 90 days, one row per post and channel, newest post first. Use it when the user asks how posts performed or which post did best. A null number means the network has not reported it yet, or does not report it at all. Never treat null as zero: say the number is not reported. Networks count in different ways, so never add numbers across networks. Compare posts within one network. This tool only reads." |

The server also sends **instructions** when a client connects. They apply to all tools, so they hold the advice that spans tools. Some clients show them to the model; treat them as a helpful extra, and keep each tool description complete on its own.

```ts
const INSTRUCTIONS = [
  'This server connects to a demo workspace for Moss & Fern, a small plant shop, in a social media scheduling app. All data is mock data.',
  'Read before you write: call list_scheduled_posts to see the calendar and the channel ids before you create a draft.',
  'These tools never schedule or publish a post. The user does that in the app.',
].join(' ');

const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
```

`test/tool-contract.test.ts` checks the text the model reads: every tool has a title, a description of a useful length that says when to use it, and explicit annotations. If you add a tool and forget one of these, the test fails.

**At this point you should see this.** Run the tests:

```bash
npm test
```

```
 Test Files  5 passed (5)
      Tests  32 passed (32)
```

List the tools with the Inspector and read them as the model would:

```bash
npx @modelcontextprotocol/inspector --cli npx tsx src/stdio.ts --method tools/list
```

You see three tools. Each has a `description`, an `inputSchema` in JSON Schema and `annotations`. For `get_post_results`, the schema of `days` is `{ "default": 30, "type": "number", "enum": [7, 30, 90] }`.

### Step 5: Build it and connect Claude (5 minutes)

**Goal:** compile the server, test it as a child process, and connect Claude Desktop or Claude Code.

Until now, `tsx` ran the TypeScript directly. That is good for development. For a client that starts your server many times, use compiled JavaScript: it starts faster and does not need `tsx`.

`tsconfig.build.json` compiles only `src/` into `dist/`:

```bash
npm run build
```

This writes `dist/stdio.js` and the files it imports.

Next, test the server the way a client uses it: as a child process that talks over stdin and stdout. `scripts/smoke-stdio.ts` starts the server with `StdioClientTransport` from the SDK and calls each tool once:

```bash
npm run smoke              # runs src/stdio.ts through tsx
npm run smoke -- --built   # runs dist/stdio.js
```

`test/stdio.test.ts` does the same inside the test suite. It catches the most common stdio bug: a `console.log` that writes to stdout and breaks the protocol.

Then connect a client. Section 5, "Connecting to Claude Desktop and Claude Code", has the full instructions. In short:

- **Claude Desktop:** add the server to `claude_desktop_config.json` with the absolute path to `dist/stdio.js`, then quit and restart Claude Desktop.
- **Claude Code:** from the lab folder, run `claude mcp add postapop-demo -- node dist/stdio.js`.

**At this point you should see this.** Run the smoke test:

```bash
npm run smoke
```

```
Postapop demo MCP server is running on stdio.
Tools: list_scheduled_posts, create_draft_post, get_post_results
list_scheduled_posts: ok: 4 posts
create_draft_post: ok: draft post_101
create_draft_post: error: This draft is 320 characters long, but Bluesky allows 300. Cut at least 20 characters, or leave the Bluesky channel (ch_bluesky) out of this draft.
get_post_results: ok: 3 posts
```

The first line is the server's stderr, which the smoke script passes through. `npm test` now reports `Test Files  6 passed (6)` and `Tests  33 passed (33)`.

In Claude, ask: "What's scheduled for Moss & Fern next week?" Claude asks for permission to use `list_scheduled_posts` (unless you allowed it before), calls it, and lists the upcoming posts.

### Step 6: The same server over HTTP (7 minutes)

**Goal:** serve the same tools over Streamable HTTP, protected by a token and an Origin check.

stdio works when the client and the server run on the same machine and the client starts the server. HTTP works when the server runs on its own, for example as part of your product. MCP's HTTP transport is called Streamable HTTP. The client sends each JSON-RPC message as a `POST` request, and the server answers with JSON or with a stream of events.

You do not change a single tool. `createServer(api)` is the same function that `src/stdio.ts` calls. Only the transport is new. This is why you kept the server and the transport apart.

#### Stateless: one server per request

`src/http-server.ts` uses the simplest mode: stateless. The server keeps no session between requests. For every `POST /mcp`, it creates a new MCP server and a new transport, handles that one request, and closes both:

```ts
const server = createServer(api);
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless: no session ids
  enableJsonResponse: true,      // answer with plain JSON, not an event stream
});
res.on('close', () => {
  void transport.close();
  void server.close();
});

await server.connect(transport);
await transport.handleRequest(req, res, body);
```

The `api` object is created once, outside the request handler. The MCP server is stateless, but the product is not: a draft that one request saves is there for the next request. One of the tests checks this. In a real product, the state lives in your database, behind your API.

Stateless mode fits tools that answer one request at a time. You need sessions only for features such as server-to-client notifications. Stateless servers are also easy to scale, because any instance can answer any request.

#### Three checks before any tool runs

The handler checks each request in this order:

1. **Origin.** A web page that you open in a browser can try to send requests to `127.0.0.1`. This is called DNS rebinding. Browsers always send an `Origin` header with such requests. Command-line clients and desktop apps do not. So the rule is: if a request has an `Origin` header, the origin must be in `LAB_ALLOWED_ORIGINS`, or the server answers `403`.
2. **Token.** The request must carry `Authorization: Bearer <token>`, and the token must equal `LAB_DEMO_TOKEN`. Otherwise the server answers `401` with a `WWW-Authenticate: Bearer` header. The comparison runs in constant time (`timingSafeEqual` on two SHA-256 hashes), so response times do not reveal how much of a guess was right.
3. **Method.** A stateless server accepts only `POST`. `GET` (to open a stream) and `DELETE` (to end a session) get `405`.

The server also binds to `127.0.0.1`, not `0.0.0.0`. Other machines on your network cannot reach it. A production server should also check the `Host` header against the host names it expects; this lab keeps to the Origin and token checks.

**The token is a demo shortcut.** One shared token means every client is the same user, and anyone with the token has full access. A real product needs per-user authorization, so that each request acts for one user with that user's permissions. For a remote MCP server, use OAuth as the MCP authorization specification describes. Step 7 does this.

#### Configuration from the environment

`src/http.ts` is the entry point. It reads its settings from environment variables, and it loads `.env` if one exists (`process.loadEnvFile()`, built into Node.js). If `LAB_DEMO_TOKEN` is missing, it stops with a sentence that says how to fix it. It never prints the token.

Create your `.env` from the example. `.env` is in `.gitignore`, so you cannot commit it by accident.

```bash
cp .env.example .env
openssl rand -hex 32   # paste the output after LAB_DEMO_TOKEN= in .env
npm run start:http
```

```
Postapop demo MCP server is listening on http://127.0.0.1:3333/mcp
```

**At this point you should see this.** Run the tests:

```bash
npm test
```

```
 Test Files  7 passed (7)
      Tests  43 passed (43)
```

`test/http.test.ts` starts the HTTP server on port 0, which means "any free port", so the tests never clash with a server you run yourself.

With the server running, open a second terminal in the lab folder and load the token into your shell: `export $(grep '^LAB_DEMO_TOKEN=' .env)`. Then call a tool without the token:

```bash
curl -i -X POST http://127.0.0.1:3333/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_post_results","arguments":{"days":7}}}'
```

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
...
{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized. Send the header Authorization: Bearer <token>."},"id":null}
```

Now add the token:

```bash
curl -i -X POST http://127.0.0.1:3333/mcp \
  -H "Authorization: Bearer $LAB_DEMO_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_post_results","arguments":{"days":7}}}'
```

You get `HTTP/1.1 200 OK` and a JSON-RPC result. Its `content[0].text` is the same JSON that the tool returns over stdio. Add `-H "Origin: https://example.com"` to the same command, and the answer is `403 Forbidden`.

To connect Claude Code to the HTTP server, pass the token as a header:

```bash
claude mcp add --transport http postapop-demo-http http://127.0.0.1:3333/mcp \
  --header "Authorization: Bearer $LAB_DEMO_TOKEN"
```

Claude Code stores this header in its configuration file on your machine. That is fine for a local demo token. Do not do it with a real credential that other people share.

### Step 7: Remote MCP with sign-in (40 minutes)

**Goal:** replace the shared demo token with OAuth 2.1, so that Claude Code, ChatGPT and other AI tools connect through a sign-in page, and each connection gets its own keys.

In step 6, everyone who knows the token is the same user, and the token never expires. A real remote server gives each connection its own short-lived keys, and the person decides on a consent page. The MCP authorization specification uses OAuth 2.1 for this. The tools do not change at all. Only the door in front of `/mcp` changes.

One process now plays two roles:

- the **authorization server**: discovery, `/authorize`, the consent page and `/token`;
- the **protected resource**: `/mcp`, which accepts only keys that the authorization server issued.

This is the whole sign-in, from Claude's side:

```
1. Claude  -> POST /mcp (no key)
   server  <- 401, WWW-Authenticate: Bearer resource_metadata="…", scope="posts"
2. Claude  -> GET /.well-known/oauth-protected-resource/mcp     "sign in at <issuer>"
3. Claude  -> GET /.well-known/oauth-authorization-server       "these are my endpoints and rules"
4. Browser -> GET /authorize?client_id=…&code_challenge=…        -> consent page
5. Person  -> presses Allow                                      -> redirect with a one-time code
6. Claude  -> POST /token (code + PKCE verifier)                 <- access key (1 hour) + refresh key
7. Claude  -> POST /mcp, Authorization: Bearer <access key>     <- the tools, as before
```

The new files:

```
src/oauth/metadata.ts      the two discovery documents and the 401 header
src/oauth/clients.ts       the apps that may connect, and how to match their return addresses
src/oauth/tokens.ts        random secrets, hashing, the PKCE check
src/oauth/oauth-server.ts  the sign-in logic, without HTTP, so tests can drive it
src/oauth/consent-page.ts  the Allow / Deny page
src/remote-server.ts       the HTTP routes: discovery, /authorize, /consent, /token, /mcp
src/remote.ts              entry point: npm run start:remote
```

#### 1. The 401 starts everything

`src/remote-server.ts` checks the key **before** any MCP code runs. Without a valid key, it answers with a real HTTP `401` and this header:

```
WWW-Authenticate: Bearer resource_metadata="http://localhost:3333/.well-known/oauth-protected-resource/mcp", scope="posts"
```

Claude starts a sign-in, or refreshes its key, only on this answer. A tool error inside a normal `200` answer never starts it. `scope` matters too: without it, Claude asks for every scope that the metadata lists.

#### 2. Two discovery documents

`src/oauth/metadata.ts` builds both:

- **Protected Resource Metadata** (RFC 9728) says "this server is protected, and you sign in there". Its `resource` must equal the address the person typed, path included. Clients use only the first entry of `authorization_servers`.
- **Authorization Server Metadata** (RFC 8414) lists the endpoints and the rules: PKCE with `S256` only, no client secrets (`token_endpoint_auth_methods_supported: ["none"]`), and an `iss` value in every answer to the app (RFC 9207), so the app can check which server answered.

Look at these two lines:

```ts
token_endpoint_auth_methods_supported: ['none'],
client_id_metadata_document_supported: true,
```

Claude uses Client ID Metadata Documents (the next part) only when **both** are present. Without them, it falls back to dynamic client registration, which this server does not offer, and the sign-in fails.

#### 3. Who is the app? Client ID Metadata Documents

There is no "register your app" step. The app's `client_id` is an https address, and that address serves a small JSON document with the app's name and return addresses (its `redirect_uris`). These are real ones, read on 2026-10-28:

| App | `client_id` | Return addresses |
| --- | --- | --- |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `http://localhost/callback`, `http://127.0.0.1/callback` |
| ChatGPT | `https://chatgpt.com/oauth/client.json` | `https://chatgpt.com/connector_platform_oauth_redirect` |

`src/oauth/clients.ts` keeps this list. Three rules come with it:

1. **The return address must match exactly.** The one exception is an app on your own computer (a loopback address). It picks a free port at run time, so the port is not compared (RFC 8252).
2. **The name on the consent page comes from your list**, never from the document's `client_name`. Anyone can write "Claude" in their own document.
3. **Errors before the app is known are shown, never redirected.** If the `client_id` or the return address is wrong, the browser shows an error page. Redirecting to an address you could not check would send the person anywhere.

`claude.ai` in the browser and Claude Desktop also connect this way, with the return address `https://claude.ai/api/mcp/auth_callback`. Anthropic does not publish their `client_id` address, so it is not on the list. When such an app tries to connect, the server prints the `client_id` it refused. For your own test, add an entry with that id, the return address above, `loopback: false` and `startHosts: ['claude.ai']`.

##### Fetching client documents

This lab keeps a copy of each app's return addresses, so it never fetches a document. A production server fetches the document behind the `client_id` instead, and that fetch is a classic way to attack a server (server-side request forgery). A safe fetch:

- accepts `https` only, and checks that the address's IP is public, not `127.0.0.1` or a private network, using the same IP for the connection (no second DNS lookup);
- follows no redirects, and stops after a few kilobytes and a few seconds;
- accepts JSON only, and checks that the document's own `client_id` equals its address;
- keeps the result for a few minutes, with one fetch per app at a time.

#### 4. The consent page

`GET /authorize` checks the request, then sets a cookie and sends the browser to `/consent/<id>`. The cookie ties the sign-in to the browser that started it. If someone forwards the consent link to another person, that person's browser has no cookie, and the page refuses. The same check runs when Allow is pressed.

Three more rules protect the page:

- The Allow press must come from this server's own page (the `Origin` header).
- The page cannot load inside another site's frame (`Content-Security-Policy: frame-ancestors 'none'`).
- `/authorize` refuses a sign-in link that was clicked on a website the app does not use (the `Referer` header). This is only a weak extra check. A website can hide its address, and the server must accept a missing `Referer`, because Claude Code opens the browser without one.

The real protection is that the code goes only to the app's own return address. Someone who tricks another person into pressing Allow does not get the code.

The page tells the person to press Allow only if they started the connection just now. This lab has one demo user and no login. A real product signs the person in first, with two-step sign-in where it is on, and sends an email for every new connection.

#### 5. PKCE and the one-time code

Before the sign-in, the app makes a random `code_verifier` and sends only its SHA-256 hash, the `code_challenge`. At `/token`, it sends the verifier itself. `matchesChallenge` in `src/oauth/tokens.ts` checks that the two belong together. A code stolen on the way is useless without the verifier.

The code is tied to the app, the return address and the challenge. It lives 60 seconds and works once. If it arrives a second time, someone else may have it, so the server cancels everything the first use made.

#### 6. Access keys and refresh keys

`/token` returns an access key that works for 1 hour, only at this server's `/mcp` (RFC 8707), and a refresh key. The server stores only hashes of both.

The refresh key changes at every use: each refresh returns a new pair, and the old refresh key is replaced. If a replaced refresh key comes back later, it was copied or stolen, so the server cancels the whole connection (RFC 9700). The server remembers every replaced key while the connection lives, not only the last one. Otherwise a key that was replaced twice could slip through.

One exception: an app sometimes sends the same refresh twice within a moment, for example after a timeout. Within 10 seconds, the server refuses the duplicate but keeps the connection. It never hands out a second pair. The trade-off: if a thief uses a stolen refresh key first, and the real app comes back within those 10 seconds, the thief keeps the connection and the real app must sign in again.

#### 7. Limits that never block a good request

Claude's and ChatGPT's servers send requests for many people from the same IP addresses. A limit on all requests per IP would block every user at once. So `/token` counts only **failed** requests per IP. After 20 failures in 10 minutes, it answers further failures with `429`, but a request that would succeed always succeeds.

Behind a tunnel or a proxy, every request seems to come from `127.0.0.1`, so the limit counts all callers together. A real server reads the caller's address from a header that its own proxy sets, and trusts that header only from that proxy.

#### 8. The key stops at the door

The tools call the API in the same process, so the access key never travels further. Never pass a client's access key on to another service ("token passthrough"). If your tools call a separate API, that API needs its own credentials.

**At this point you should see this.** Run the tests:

```bash
npm test
```

```
 Test Files  9 passed (9)
      Tests  69 passed (69)
```

The server keeps everything in memory and forgets expired sign-ins, codes and keys as it goes. A real server stores them in a database and deletes expired rows on a schedule.

`test/oauth-server.test.ts` drives the sign-in logic with a fake clock, so it can test the 60-second code and the 10-second grace without waiting. `test/remote.test.ts` runs the whole sign-in over HTTP with the MCP SDK's own client: it gets the 401, reads both documents, opens the consent page, presses Allow, swaps the code, and calls a tool.

#### Try it

Start the server:

```bash
npm run start:remote
```

```
Postapop demo MCP server with OAuth is listening on http://localhost:3333/mcp
```

Call `/mcp` without a key and look at the header:

```bash
curl -i -X POST http://localhost:3333/mcp -d '{}'
curl http://localhost:3333/.well-known/oauth-authorization-server
```

To connect **Claude Code**, add the server and sign in from inside Claude Code:

```bash
claude mcp add --transport http postapop-demo-oauth http://localhost:3333/mcp
```

Then type `/mcp` in a Claude Code session, choose `postapop-demo-oauth`, and choose to authenticate. Your browser opens the consent page. Some clients accept only `https` for a sign-in server. If yours refuses `http://localhost`, use a tunnel, as below.

To connect **ChatGPT or claude.ai**, the server needs a public `https` address, because their servers call it from the internet. A tunnel gives your local server one for a while. For example, with Cloudflare's free quick tunnel:

```bash
cloudflared tunnel --url http://localhost:3333
```

Put the `https://…` address it prints in `.env` as `LAB_ISSUER`, restart `npm run start:remote`, and add `<that address>/mcp` as a custom connector in the app. Claude's servers connect from `160.79.104.0/21` and need an IPv4 address. Claude keeps the discovery documents for about 5 minutes, so a change there takes a few minutes to show. Stop the tunnel when you are done. This lab has no login, so while the tunnel runs, anyone with the address can press Allow and connect to the demo data.

### Step 8: Make it yours (after the lab)

The `step-8` tag adds no code. It adds `TEACHING_NOTES.md` for instructors who run this lab, and the license. You now have a complete server. Here is the map:

```
src/
  scheduling-api.ts    the contract: types, the SchedulingApi interface, ApiError
  demo-data.ts         mock data for Moss & Fern
  demo-api.ts          the mock API: where real HTTP calls would go
  server.ts            createServer(api): server instructions and tool registration
  tools/               one file per tool, plus helpers for results and errors
  stdio.ts             entry point for stdio
  http-server.ts       Streamable HTTP: Origin check, token check, stateless transport
  http.ts              entry point for HTTP: reads the environment, binds 127.0.0.1
  oauth/               step 7: discovery documents, known apps, PKCE, the sign-in logic, the consent page
  remote-server.ts     step 7: the same tools behind OAuth instead of a shared token
  remote.ts            entry point for the OAuth server
scripts/smoke-stdio.ts calls each tool through a real child process
test/                  in-memory, stdio, HTTP and OAuth tests (69 in total)
examples/              a Claude Desktop config block
```

Next, read "Design notes" (section 8), then pick a challenge from "Extend it yourself" (section 7).

## 5. Connecting to Claude Desktop and Claude Code

Both clients start your server as a child process over stdio. They need the command to run and its arguments. Build first, so the command can be plain `node`:

```bash
npm run build
```

Find the two absolute paths you need:

```bash
pwd            # the lab folder, for example /Users/you/code/postapop-mcp-lab
which node     # the Node.js binary, for example /usr/local/bin/node
```

### Claude Desktop

1. In Claude Desktop, open **Settings**, then **Developer**, then **Edit Config**. This opens `claude_desktop_config.json`. On macOS it is in `~/Library/Application Support/Claude/`. On Windows it is in `%APPDATA%\Claude\`.
2. Add the server. `examples/claude_desktop_config.json` has this block:

   ```json
   {
     "mcpServers": {
       "postapop-demo": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/TO/postapop-mcp-lab/dist/stdio.js"]
       }
     }
   }
   ```

   Replace `/ABSOLUTE/PATH/TO/postapop-mcp-lab` with the output of `pwd`. If the file already has an `mcpServers` object, add `postapop-demo` inside it. Do not create a second `mcpServers` key.
3. Quit Claude Desktop completely and open it again. Closing the window is not enough. Claude Desktop reads the config file only at startup.
4. Open the tools menu in the chat box. You see `postapop-demo` with three tools.

Claude Desktop does not start the server from your shell, so it may not find `node` on your `PATH`, especially if you use a version manager such as nvm. If the server does not start, set `"command"` to the full output of `which node`.

### Claude Code

From the lab folder, run:

```bash
claude mcp add postapop-demo -- node dist/stdio.js
```

Everything after `--` is the command that starts the server. Claude Code starts it from the folder you run `claude` in, so the relative path works when you work in this folder. To use the server from any folder, add it at user scope with an absolute path:

```bash
claude mcp add --scope user postapop-demo -- node /ABSOLUTE/PATH/TO/postapop-mcp-lab/dist/stdio.js
```

While you change the code, you can skip the build step and run the TypeScript directly:

```bash
claude mcp add postapop-demo -- npx tsx src/stdio.ts
```

Each command adds a server named `postapop-demo`, so use one of them. To switch, remove the old entry first with `claude mcp remove postapop-demo`.

Check the connection with `claude mcp list`, or type `/mcp` inside a Claude Code session. Claude Code starts the server when a session starts, so start a new session after you change the server.

To connect Claude Code to the HTTP transport instead, see the end of step 6.

## 6. Common errors and fixes

**The client disconnects at once, or reports invalid JSON, over stdio.**
Something wrote to stdout. Over stdio, stdout carries only protocol messages, so one `console.log` breaks the connection. Use `console.error` for all logs. Check your dependencies too: a library that prints a banner to stdout causes the same failure. Do not start the server with `npm start` in a client config either, because npm prints its own lines to stdout. Use `node dist/stdio.js`. `test/stdio.test.ts` catches this problem.

**Claude Desktop shows no tools, and its log says "Cannot find module".**
The path in `claude_desktop_config.json` is wrong. It must be absolute: `~` and relative paths do not work there. Check that `dist/stdio.js` exists; if it does not, run `npm run build`. Claude Desktop writes a log for each server. On macOS, read `~/Library/Logs/Claude/mcp-server-postapop-demo.log`. On Windows, look in `%APPDATA%\Claude\logs\`.

**The server fails with a syntax error, or npm warns about an unsupported engine.**
Your Node.js is older than version 22. Run `node --version`. Claude Desktop can find a different `node` than your terminal does, for example an old system version. Put the absolute path from `which node` in `"command"`.

**`TypeError: Cannot read properties of undefined (reading 'datetime')`.**
The code uses the zod 4 API, but zod 3 is installed. `z.iso.datetime()`, `z.literal([7, 30, 90])` and the `error` option exist only in zod 4. Run `npm ls zod`; it must show `zod@4.6.6`. In zod 3 tutorials you see `z.string().datetime()` and `{ message: '...' }` instead.

**`npm run start:http` stops with "LAB_DEMO_TOKEN is missing".**
The HTTP server needs a token. Copy `.env.example` to `.env` and set `LAB_DEMO_TOKEN` to a long random value: `openssl rand -hex 32`. Variables that you set in the shell win over `.env`. Claude Desktop and Claude Code do not read your shell profile, so pass variables to a stdio server in the client config (`"env"` in Claude Desktop, `-e NAME=value` in `claude mcp add`).

**The HTTP server answers `401 Unauthorized`.**
The request has no `Authorization` header, the header lacks the `Bearer ` prefix, or the token does not match. Look for quotes or spaces around the value in `.env`. Some clients react to a `401` by starting an OAuth sign-in, which the step 6 server does not support. The Inspector, for example, reports `auth_required`. Pass the header explicitly: `--header "Authorization: Bearer <token>"`, or use the step 7 server, which supports the sign-in.

**The sign-in page says "This app is not on the list of apps that may connect to this server".**
The app's `client_id` is not in `src/oauth/clients.ts`. The server prints the refused `client_id` in its terminal. claude.ai in the browser and Claude Desktop are not on the list, because Anthropic does not publish their `client_id` address (see step 7). For your own test, add an entry with the printed id, the return address `https://claude.ai/api/mcp/auth_callback`, `loopback: false` and `startHosts: ['claude.ai']`.

**The client says the resource does not match, or it never finds the sign-in.**
Use the same host everywhere. If the server's `LAB_ISSUER` is `http://localhost:3333`, add `http://localhost:3333/mcp` to your client, not `http://127.0.0.1:3333/mcp`. The `resource` in the discovery document must equal the address you typed.

**The sign-in page says "This sign-in has expired or was started in another browser".**
The consent page works only in the browser that opened the sign-in link, for 10 minutes. Start the connection again in your AI tool. If you restarted `npm run start:remote`, every sign-in and connection is gone, because the server keeps them in memory.

**The consent page says the sign-in "was started in another browser", but you used only one browser.**
The cookie that ties the sign-in to your browser belongs to one host. If a router, a redirect rule or a separate marketing site sends the consent page to another host, for example from `app.example.com` to `example.com`, the browser does not send the cookie there, and the page refuses. The AI tool then shows the connection as not connected yet. Serve `/authorize`, the consent page and the cookie on one origin: the issuer's. To check, watch the address bar: the consent page's host must equal the host of `issuer` in `/.well-known/oauth-authorization-server`. If you have redirect rules, add the consent path to the rules for the app's host.

**The HTTP server answers `403 Forbidden. The origin ... is not allowed`.**
The request came from a web page, so it has an `Origin` header that is not in the allowed list. If you trust that page, for example a local tool at `http://localhost:6274`, add its exact origin to `LAB_ALLOWED_ORIGINS` and restart the server.

**The HTTP server answers `406 Not Acceptable`.**
The request lacks `Accept: application/json, text/event-stream`. The Streamable HTTP transport requires both types, even when the server answers with plain JSON. MCP clients send this header for you; add it to `curl`.

**`EADDRINUSE` when the HTTP server starts.**
Another program uses port 3333. Set `LAB_HTTP_PORT` to another port.

**A new tool, or a changed description, does not appear in the client.**
Clients read the tool list when they start the server. Quit Claude Desktop completely and open it again. In Claude Code, start a new session. If the client runs `dist/stdio.js`, run `npm run build` first, or the client still runs the old code.

**The tool result says "Input validation error".**
The model sent arguments that do not match the input schema. The SDK checks them before your handler runs, and it returns the problem to the model with your custom zod message inside. If this happens often, the tool description or a parameter description is unclear. Improve the text, not only the schema.

## 7. Extend it yourself

Each challenge practices one idea from the lab. Start each one with a test.

1. **Add `schedule_post`, with a confirmation step.** Scheduling reaches a real audience, so treat it as a bigger action than a draft. Design it in two calls: the first returns a preview and a short-lived confirmation id; the second, with that id, schedules the post. Then decide its annotations. It is not read-only. Is it destructive? It deletes no data, but nobody can take a published post back from the people who saw it. Should `openWorldHint` be `true`, because the post goes to public networks? Write your reasons into the description.
2. **Add `find_next_free_slot`, with time zones.** Given a channel and a day, return the next hour with no scheduled post, in the workspace time zone (`America/New_York`). Accept and return ISO 8601 times with offsets. Test a day when daylight saving time starts or ends: the offset changes between `-04:00` and `-05:00`.
3. **Replace the mock with a real HTTP client.** Write `src/http-api.ts` that implements `SchedulingApi` with `fetch`, reads `DEMO_API_URL` and `DEMO_API_KEY` from the environment, and stops each request after a few seconds with `AbortSignal.timeout()`. Turn each HTTP error into an `ApiError` with a sentence the model can act on. The tools do not change.
4. **Make the OAuth server ready for real users.** Step 7 has one demo user and keeps everything in memory. Add a real login, store connections in a database (hashes only), and map each access token to one user and their workspace. Let the HTTP handler give each request an API client that acts for that one user. Then fetch client documents instead of keeping a list, with every rule from "Fetching client documents", and test each rule: an `http` address, a private IP, a redirect, a 1 MB answer, a slow answer.
5. **Add a resource or a prompt.** Expose the brand's style guide as a resource, for example `demo://workspace/style-guide`, so a client can attach it to a conversation. Or add a `weekly_report` prompt that tells the model to call `get_post_results` with `days: 7` and to summarize each network on its own.
6. **Make an action safe to repeat with an idempotency key.** Add an optional `idempotency_key` to `create_draft_post`. If the same key arrives twice, the API returns the first draft and does not create a second one. This matters when a client retries after a timeout. Then decide whether `idempotentHint` can become `true`.
7. **Return structured results.** Add an `outputSchema` to `get_post_results` and return `structuredContent` next to the text. Clients that understand structured output can then use the numbers directly.

## 8. Design notes

**The server holds no business logic.** The product rules, such as the 31-day window and the Bluesky limit, live behind `SchedulingApi`. The MCP layer checks the shape of the inputs, calls the API and shapes the results for the model. If the rules lived in the tools, the product's web app and the MCP server could disagree about what is allowed. With the rules behind one API, there is one source of truth, and you can replace the mock with a real client without touching a tool.

**Errors are sentences.** A model cannot act on a stack trace, and a stack trace can leak internals. Each expected error returns `isError: true` and a short sentence that says what went wrong and what to do next: "Cut at least 76 characters, or leave the Bluesky channel (ch_bluesky) out of this draft." With that, the model usually fixes the call by itself, or asks the user one clear question. Unexpected errors go to stderr with full details for you, and the model gets a short, safe sentence.

**Read tools and action tools are separate.** `list_scheduled_posts` and `get_post_results` only read, and `readOnlyHint: true` tells the client so. A client can let the user approve them once and run them freely after that. `create_draft_post` is the only action, and it is small: it saves a draft and nothing else. A small action surface makes mistakes cheap. Each action tool you add should do one thing, say in its description what it never does, and carry honest annotations.

**Annotations are hints, not security.** A client uses them to decide when to ask the user. A server can lie in its annotations, so a client must not trust them from an unknown server, and your API must enforce every rule itself.

**Security notes.**

- Secrets come only from environment variables. `.env.example` lists the names with no values. `.env` is in `.gitignore`.
- Never log a secret. The HTTP server reports a missing token, but it never prints one.
- Over stdio, stdout is the protocol. Log to stderr.
- The HTTP server binds to `127.0.0.1`, checks `Origin` against an allow list, and compares tokens in constant time.
- A shared token is for demos only. A real remote server needs per-user authorization, such as the OAuth sign-in in step 7.
- The OAuth server stores only hashes of codes and keys, and it never passes an access key on to another service.
- Treat tool inputs as untrusted. The model writes them, and a user, or text the model has read, can steer the model. Check inputs in the schema, and again in the API.
- Treat tool results as data, not instructions. A post text could contain words that look like instructions to the model. Keep that in mind when a tool returns text that users or third parties wrote.

## Changes

- 2026-10-28: the steps were rebuilt. A fix for times without seconds (zod 4.6.6) now comes right after step 2. Step 7 is new and teaches remote MCP with OAuth. The former step 7 is now step 8. If you cloned the lab before this date, clone it again.

## License

MIT. See [LICENSE](LICENSE). Moss & Fern and all data in this repository are made up.
