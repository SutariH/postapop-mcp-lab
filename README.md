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
