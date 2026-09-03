# Research: `@earendil-works/pi-ai` API (v0.84.4)

> Verified by reading `dist/*.d.ts` of the installed package. Signatures trimmed to
> what Ob Pi uses.

## Models runtime (modern API)

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { defaultProviderAuthContext } from "@earendil-works/pi-ai";

const models = builtinModels({
  credentials: myCredentialStore,          // CredentialStore (see below)
  authContext: defaultProviderAuthContext(), // env/file access abstraction
});
```

`builtinModels()` returns a `MutableModels` with **all builtin providers registered**
(anthropic, openai, google, bedrock, openrouter, groq, mistral, … ~40 `KnownProvider`s).
No network at construction; static providers ship their catalog inline.

```ts
interface Models {
  getProviders(): readonly Provider[];
  getModels(provider?: string): readonly Model[];          // sync, last-known
  getModel(provider: string, id: string): Model | undefined; // sync lookup
  refresh(options?): Promise<ModelsRefreshResult>;          // dynamic providers only
  checkAuth(providerId): Promise<AuthCheck | undefined>;    // auth configured? (no OAuth refresh)
  getAvailable(providerId?): Promise<readonly Model[]>;     // models with auth configured
  getAuth(modelOrProvider): Promise<AuthResult | undefined>; // resolve headers/keys per request
  stream(model, context, options?): AssistantMessageEventStream;
  complete(model, context, options?): Promise<AssistantMessage>;
  streamSimple(model, context, options?): AssistantMessageEventStream;
  completeSimple(model, context, options?): Promise<AssistantMessage>;
  login/logout(...)  // OAuth + api-key flows, persist via CredentialStore
}
```

Ob Pi uses `getAvailable()` for the settings dropdown and `models.stream` as the
`streamFn` for the agent loop. Auth resolution per request happens inside
`Models.stream` → `getAuth`.

## Core request types

```ts
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;   // typebox schema
  constrainedSampling?: false | ConstrainedSamplingConfig;
}

interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api; /* … stopReason, usage, errorMessage, etc. */
}
```

Streaming event protocol (`AssistantMessageEventStream`, an EventStream):

```ts
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_delta"; delta: string; /* partial */ }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolcall_delta"; … }
  | { type: "usage"; … }
  | { type: "done"; message: AssistantMessage }   // terminal success
  | { type: "error"; message: AssistantMessage }; // stopReason "error" | "aborted"
```

(The exact union is in `dist/types.d.ts`; the agent loop consumes this stream for us —
Ob Pi does not drive it directly.)

## Auth

```ts
interface CredentialStore {
  read(providerId, options?): Promise<Credential | undefined>;
  list(options?): Promise<readonly CredentialInfo[]>;        // { providerId, type }
  modify(providerId, fn, options?): Promise<Credential | undefined>; // ONLY write path
  delete(providerId, options?): Promise<void>;
}

type Credential = ApiKeyCredential | OAuthCredential;

interface ApiKeyCredential {
  type: "api_key";
  key?: string;             // a literal key…
  env?: ProviderEnv;        // …or "run this command to get one"
}
```

- `pi-ai` only ships `InMemoryCredentialStore` as a concrete store.
- The **file-backed** store (`AuthStorage`, reads/writes `auth.json`) lives in
  `pi-coding-agent/dist/core/auth-storage` — deliberately not imported here.
  Ob Pi ships its own ~50-line read-only store (`src/agent/auth.ts`) that parses
  `~/.pi/agent/auth.json` (format: `{ "<providerId>": credential }`).
- Env-var fallback is provider-defined (`envApiKeyAuth(name, envVars)`) and resolved
  through `AuthContext.env` — `defaultProviderAuthContext()` reads `process.env`, which
  exists in Obsidian's Electron renderer.

## Deprecated-but-working compat surface

`import … from "@earendil-works/pi-ai/compat"` gives the old globals
(`getModel`, `getModels`, `stream`, `complete`, api-registry). Marked for deletion
("deleted with the coding-agent ModelManager migration") — **do not use in new code**;
use `builtinModels()` + `Models.getModel()` as we do.
