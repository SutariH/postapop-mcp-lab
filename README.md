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
