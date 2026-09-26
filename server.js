import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecisionProviders, PROVIDER_IDS } from "./ai-service.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const providers = createDecisionProviders();

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (request.method === "GET" && pathname === "/api/ai/status") {
    const statuses = await Promise.all(Object.entries(providers).map(async ([id, provider]) => [id, {
      id,
      name: provider.name,
      configured: provider.configured,
      available: await provider.isAvailable(),
      model: provider.model,
      selfHosted: provider.selfHosted,
    }]));
    sendJson(response, 200, {
      providers: Object.fromEntries(statuses),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/ai/decide") {
    try {
      const payload = await readJson(request);
      if (!PROVIDER_IDS.has(payload?.provider)) {
        const error = new Error("provider must be either jev or laya.");
        error.statusCode = 400;
        error.code = "INVALID_AI_PROVIDER";
        throw error;
      }
      const provider = providers[payload.provider];
      const result = await provider.decide(payload);
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
      if (statusCode >= 500 && error.code !== "AI_PROVIDER_NOT_CONFIGURED") {
        console.error(`[AI] ${error.name}: ${error.message}`);
      }
      sendJson(response, statusCode, {
        code: error.code || "AI_REQUEST_FAILED",
        message: statusCode >= 500 && error.code !== "AI_PROVIDER_NOT_CONFIGURED"
          ? "The selected AI provider could not make a decision."
          : error.message,
      });
    }
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { code: "NOT_FOUND", message: "API route not found." });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Pacman is running at http://localhost:${port}`);
  console.log(`Jev pilot: ${providers.jev.configured ? `ready (${providers.jev.model})` : "not configured — set TYPESAFE_API_KEY"}`);
  console.log(`Laya pilot: ${providers.laya.configured ? `configured (${providers.laya.model}); readiness is checked at /api/ai/status` : "not configured — set LAYA_BASE_URL"}`);
});

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) {
      const error = new Error("The request body is too large.");
      error.statusCode = 413;
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The request body must contain valid JSON.");
    error.statusCode = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
