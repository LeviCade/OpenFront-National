// Ephemeral CI-only TLS terminator for the REAL Node Master/Worker TCP socket.
// It does not create a synthetic game, identity provider or websocket server.
// Backend remains on localhost:3001; every actual player uses wss://localhost.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:tls";

export async function startNationalWssBridge(privateDir) {
  const key = join(privateDir, "wss-key.pem");
  const cert = join(privateDir, "wss-cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const sockets = new Set();
  const tls = createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (secure) => {
      sockets.add(secure);
      const backend = connect({ host: "localhost", port: 3001 });
      sockets.add(backend);
      const teardown = () => {
        secure.destroy();
        backend.destroy();
      };
      secure.once("close", () => sockets.delete(secure));
      backend.once("close", () => sockets.delete(backend));
      secure.on("error", teardown);
      backend.on("error", teardown);
      secure.pipe(backend).pipe(secure);
    },
  );
  await new Promise((resolve, reject) => {
    tls.once("error", reject);
    tls.listen(0, "localhost", resolve);
  });
  const address = tls.address();
  assert(address && typeof address !== "string");
  return {
    url: `wss://localhost:${address.port}/`,
    ca: readFileSync(cert),
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => tls.close(resolve));
    },
  };
}

/** Certificate-verified HTTPS through the SAME real TCP/TLS Worker terminator. */
export async function nationalHttpsJson(edge, pathname, options = {}) {
  const url = new URL(pathname, edge.url.replace(/^wss:/, "https:"));
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: options.method ?? "GET",
        ca: edge.ca,
        rejectUnauthorized: true,
        timeout: 5000,
        headers: {
          ...(options.token ? { authorization: "Bearer " + options.token } : {}),
          ...(body === null
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            req.destroy(new Error("HTTPS response exceeded bounded size"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => {
          try {
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch {
            reject(new Error("HTTPS response was not JSON"));
          }
        });
      },
    );
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("HTTPS request timeout")));
    req.end(body ?? undefined);
  });
}
