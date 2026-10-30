import { config } from "./config.ts";
import { createDeps } from "./container.ts";
import { buildServer } from "./server.ts";

const deps = createDeps(config);
const app = await buildServer(deps);
await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`Brieftaube core on ${config.publicBaseUrl} (chat=${config.chatMode}, mail=${config.mailMode}, llm=${config.llmProvider})`);
