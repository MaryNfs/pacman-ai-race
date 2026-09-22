import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createJevService } from "./jev-service.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const jev = createJevService();

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (request.method === "GET" && pathname === "/api/jev/status") {
    sendJson(response, 200, { configured: jev.configured, model: jev.model });
    return;
  }

  if (request.method === "POST" && pathname === "/api/jev/decide") {
    try {
      const result = await jev.decide(await readJson(request));
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
      if (statusCode >= 500 && error.code !== "JEV_NOT_CONFIGURED") {
        console.error(`[Jev] ${error.name}: ${error.message}`);
      }
      sendJson(response, statusCode, {
        code: error.code || "JEV_REQUEST_FAILED",
        message: statusCode >= 500 && error.code !== "JEV_NOT_CONFIGURED"
          ? "Jev could not make a decision."
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
  console.log(`Jev pilot: ${jev.configured ? `ready (${jev.model})` : "not configured — set TYPESAFE_API_KEY"}`);
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
