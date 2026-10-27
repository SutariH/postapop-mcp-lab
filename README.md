# Build your own MCP server for a SaaS product

A 45-minute hands-on lab. You build a Model Context Protocol (MCP) server for a demo of Postapop, a social media scheduling SaaS. When you finish, Claude can read a brand's post calendar, save draft posts and report post results through your server.

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

Each step of the lab is a Git tag: `step-1` to `step-7`. Every tag is a working checkpoint where the tests pass. You can follow the lab in two ways:

- **Type along.** Check out `step-1`, then write the code for each next step yourself. If you get stuck, compare with the tag: `git diff step-3 -- src/`.
- **Read along.** Check out each tag in turn and read what changed: `git checkout step-3`, then `git diff step-2 step-3`.

After you check out a tag, run `npm install` again. The dependencies can change between steps.

The lab pins exact versions of every dependency, so that the code and the expected output in this README match. Before you use this code for a real product, update the dependencies and run `npm audit`.

## 4. The steps

| Step | What you add | Minutes |
| --- | --- | --- |
| Setup | Clone and install | 4 |
| 1 | A server with no tools, over stdio | 5 |
| 2 | Mock data and a read-only tool | 9 |
| 3 | A write tool with validation and helpful errors | 9 |
| 4 | Results, and descriptions that models read well | 6 |
| 5 | Build it and connect Claude | 5 |
| 6 | The same server over HTTP | 7 |
| | **Total** | **45** |

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
- **`annotations`** are hints for the client. `readOnlyHint: true` says the tool changes nothing, so a client can run it without asking the user first. `openWorldHint: false` says the tool works inside a closed system (one workspace), not the open internet.
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

The input schema carries its own error messages. If the model sends empty text, the message says what to do:

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

You do not change a single tool. `createServer(api)` from step 1 is the same. Only the transport is new. This is why you kept the server and the transport apart.

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

The server also binds to `127.0.0.1`, not `0.0.0.0`. Other machines on your network cannot reach it.

**The token is a demo shortcut.** One shared token means every client is the same user, and anyone with the token has full access. A real product needs per-user authorization, so that each request acts for one user with that user's permissions. For a remote MCP server, use OAuth as the MCP authorization specification describes. "Extend it yourself" has a challenge for this.

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

With the server running, open a second terminal in the lab folder and load the token into your shell: `export $(grep LAB_DEMO_TOKEN .env)`. Then call a tool without the token:

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

Check the connection with `claude mcp list`, or type `/mcp` inside a Claude Code session. Claude Code starts the server when a session starts, so start a new session after you change the server.
