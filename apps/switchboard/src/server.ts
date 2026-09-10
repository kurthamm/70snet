import { WebSocketServer, type WebSocket } from "ws"
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http"
import { mkdtemp, stat, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, normalize, sep, extname } from "node:path"
import { Exchange } from "@70snet/exchange/exchange"
import type { LineInterface } from "@70snet/exchange/line"
import { CbbsHost } from "@70snet/cbbs-host/host"
import { BaudPacer } from "@70snet/protocol/pacer"
import type { ClientMessage, ServerMessage } from "@70snet/protocol/client"
import { DESTINATIONS } from "@70snet/registry/data/destinations"
import { ROOM_1980 } from "@70snet/registry/data/rooms"

const BITS_PER_CHAR = 10 // 8N1

/** Content-Type by extension for the handful of file types the room page
 *  and the Apple II emulator's built assets actually use. Anything not
 *  listed here is served as `application/octet-stream` -- a correct,
 *  conservative default for an unrecognized binary extension (disk images,
 *  emulator ROM/symbol files), not a masked error: the byte content is
 *  still served correctly, only the advertised type is generic. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
}

/** Resolve a request path against `root`, refusing anything that would
 *  escape it (`..`, absolute-path tricks, percent-encoded traversal). A
 *  path that escapes the root is a 403, not something silently clamped
 *  back inside it -- clamping would serve a *different*, unrequested file
 *  under the visitor's nose. Returns `null` for a path the caller should
 *  reject as forbidden. */
function resolveWithinRoot(root: string, requestPath: string): string | null {
  const withoutQuery = requestPath.split(/[?#]/)[0] as string
  const decoded = decodeURIComponent(withoutQuery)
  // Strip only the leading slash(es) -- not normalize()d against a virtual
  // "/" first, which would silently clamp a "../../../etc/passwd" request
  // back inside root and hand it a 404 indistinguishable from a genuine
  // missing file. Instead join the (still relative) request path onto the
  // real root and normalize *that*, so a genuine escape attempt produces a
  // path outside root -- caught below and reported as the 403 it is, not
  // masked as a 404.
  const relative = decoded.replace(/^\/+/, "")
  const full = normalize(join(root, relative))
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (full !== root && !full.startsWith(rootWithSep)) return null
  return full
}

/** Serve one file out of `root`, or the 404/403 that fits what happened.
 *  Directories fall back to `index.html` inside them (so `/` and
 *  `/apple2ts/` resolve the way a static host resolves them); a directory
 *  with no `index.html` is a 404, not a directory listing. */
async function serveStatic(
  root: string,
  requestPath: string,
  res: import("node:http").ServerResponse
): Promise<void> {
  let target: string | null
  try {
    target = resolveWithinRoot(root, requestPath)
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("400 Bad Request: malformed URL")
    return
  }
  if (target === null) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("403 Forbidden: path escapes site root")
    return
  }

  try {
    let info = await stat(target)
    if (info.isDirectory()) {
      target = join(target, "index.html")
      info = await stat(target)
    }
    if (!info.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("404 Not Found")
      return
    }
    const body = await readFile(target)
    const type = MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": type, "Content-Length": body.length })
    res.end(body)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("404 Not Found")
      return
    }
    // A real I/O failure (permissions, etc.) is reported, not swallowed as
    // a 404 that would hide what actually went wrong.
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
    res.end(`500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Runtime validation of what a client actually sent -- `JSON.parse` only
 *  proves the bytes were JSON, not that they are a `ClientMessage`. A caller
 *  that sends garbage gets told so (protocol errors are reported, never
 *  thrown from inside an async event callback where they'd become an
 *  unhandled rejection and can take the whole process down). */
export function isClientMessage(x: unknown): x is ClientMessage {
  if (typeof x !== "object" || x === null || !("kind" in x)) return false
  const kind = (x as { kind: unknown }).kind
  if (kind === "hangup") return true
  if (kind === "dial") return typeof (x as { number?: unknown }).number === "string"
  return false
}

export async function createSwitchboard(opts: { port: number }) {
  const machineDir = new URL("../../../machines/s100-cbbs", import.meta.url).pathname
  // SEVENTIESNET_LINE is an explicit override (tests pin it to a known FIFO
  // pair); otherwise each process gets its own line directory so that two
  // switchboards running side by side never collide on the same FIFOs.
  const lineDir = process.env.SEVENTIESNET_LINE ?? (await mkdtemp(join(tmpdir(), "70snet-line-")))
  const cbbs = new CbbsHost({
    machineDir,
    lineDir,
    inFictionDate: ROOM_1980.date,
  })
  await cbbs.start()

  const exchange = new Exchange({
    destinations: DESTINATIONS,
    hosts: { get: id => (id === "cbbs-host" ? cbbs : undefined) },
  })

  // The room page and the exchange share one origin and one port (spec:
  // single host, single Cloudflare tunnel). `noServer: true` keeps the
  // WebSocketServer from binding its own listener; the HTTP server below
  // owns the socket and hands upgrade requests to it explicitly.
  const wss = new WebSocketServer({ noServer: true })
  const webDistDir = new URL("../../web/dist", import.meta.url).pathname
  const apple2tsDistDir = new URL("../../../vendor/apple2ts/dist", import.meta.url).pathname
  const APPLE2TS_PREFIX = "/apple2ts/"

  const httpServer: HttpServer = createServer((req, res) => {
    void (async () => {
      const requestPath = req.url ?? "/"
      if (requestPath === "/apple2ts" || requestPath.startsWith(APPLE2TS_PREFIX)) {
        const rest = requestPath === "/apple2ts" ? "/" : requestPath.slice(APPLE2TS_PREFIX.length - 1)
        await serveStatic(apple2tsDistDir, rest, res)
        return
      }
      await serveStatic(webDistDir, requestPath, res)
    })()
  })

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req)
    })
  })

  wss.on("connection", (ws: WebSocket) => {
    const callerId = randomUUID()
    let pacer: BaudPacer | null = null
    let line: LineInterface | null = null // whichever destination answered

    const say = (m: ServerMessage) => ws.send(JSON.stringify(m))

    ws.on("message", async (raw, isBinary) => {
      try {
        if (isBinary) {
          // Keystrokes leaving the Apple. The visitor types at human speed, so
          // this direction is not paced.
          if (line === null) throw new Error("bytes sent with no call in progress")
          line.send(new Uint8Array(raw as Buffer))
          return
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(String(raw))
        } catch (err) {
          throw new Error(
            `malformed message: not valid JSON (${err instanceof Error ? err.message : String(err)})`
          )
        }
        if (!isClientMessage(parsed)) {
          throw new Error("malformed message: not a recognized client message")
        }
        const msg: ClientMessage = parsed

        if (msg.kind === "hangup") {
          hangup()
          return
        }

        if (line !== null) {
          // Already on a call -- a second dial on the same socket would
          // replace the pacer in flight and leak the one already running.
          say({ kind: "out-of-service", reason: "already connected; hang up before dialing again" })
          return
        }

        const r = await exchange.dial(callerId, ROOM_1980.date, msg.number)
        switch (r.outcome) {
          case "busy":
            say({ kind: "busy" })
            return
          case "no-answer":
            say({ kind: "no-answer" })
            return
          case "out-of-service":
            say({ kind: "out-of-service", reason: r.reason })
            return
          case "connected":
            // Bytes from the destination arrive as fast as the emulator produces
            // them; the pacer is what makes it 1980 (spec 4.3, 7.5).
            line = r.line
            pacer = new BaudPacer(r.baud, BITS_PER_CHAR, b => ws.send(b, { binary: true }))
            r.line.onData(b => pacer?.push(b))
            r.line.onFailure(err => {
              say({ kind: "out-of-service", reason: err.message })
              hangup()
            })
            say({ kind: "connected", baud: r.baud })
        }
      } catch (err) {
        // A protocol error is reported to the offending client, never
        // thrown from inside this async callback -- an uncaught throw here
        // becomes an unhandled rejection that can take the process down.
        say({ kind: "out-of-service", reason: err instanceof Error ? err.message : String(err) })
      }
    })

    function hangup() {
      pacer?.stop()
      pacer = null
      line = null
      exchange.hangup(callerId)
    }

    ws.on("close", hangup)
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", () => resolve())
    httpServer.once("error", reject)
    httpServer.listen(opts.port)
  })
  const address = httpServer.address()
  if (address === null || typeof address === "string") {
    throw new Error("switchboard did not bind a TCP port")
  }

  return {
    port: address.port,
    async close() {
      await new Promise<void>(res => wss.close(() => res()))
      await new Promise<void>((resolve, reject) => {
        httpServer.close(err => (err ? reject(err) : resolve()))
      })
      await cbbs.stop()
    },
  }
}
