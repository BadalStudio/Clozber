const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 1e6,
  connectionStateRecovery: { maxDisconnectionDuration: 10000 }
});
const PORT = process.env.PORT || 3000;
const sessions = new Map();
const sockets = new Map();
const TOKEN_TTL_MS = 10 * 60 * 1000;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=()");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0 }));
app.get("/health", (_req, res) => res.json({ ok: true }));

function randomToken() { return crypto.randomBytes(24).toString("base64url"); }
function safeName(v) {
  if (typeof v !== "string") return "Cloudzer user";
  return v.replace(/[<>\\u0000-\\u001f]/g, "").trim().slice(0, 40) || "Cloudzer user";
}
function cleanSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  for (const sid of [s.requesterSocket, s.receiverSocket]) {
    if (sid) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.leave(id);
      sockets.delete(sid);
    }
  }
  sessions.delete(id);
}
function emitTo(sid, event, payload) {
  if (sid && io.sockets.sockets.has(sid)) io.to(sid).emit(event, payload);
}

io.on("connection", socket => {
  socket.on("create-request", ({ name } = {}, cb = () => {}) => {
    const id = randomToken();
    const secret = randomToken();
    sessions.set(id, {
      id, secret, requesterName: safeName(name), requesterSocket: socket.id,
      receiverSocket: null, state: "waiting", createdAt: Date.now()
    });
    socket.join(id); sockets.set(socket.id, id);
    cb({ ok: true, id, secret, url: `${getBaseUrl(socket)}?session=${encodeURIComponent(id)}&role=receiver` });
  });

  socket.on("join-request", ({ id, name } = {}, cb = () => {}) => {
    const s = sessions.get(String(id || ""));
    if (!s || Date.now() - s.createdAt > TOKEN_TTL_MS || s.state !== "waiting" || s.receiverSocket) {
      cb({ ok: false, error: "This request has expired or already has a receiver." }); return;
    }
    s.receiverSocket = socket.id;
    s.receiverName = safeName(name);
    s.state = "pending-consent";
    socket.join(s.id); sockets.set(socket.id, s.id);
    emitTo(s.requesterSocket, "receiver-arrived", { name: s.receiverName });
    socket.emit("consent-request", { requesterName: s.requesterName, expiresInSeconds: Math.floor((TOKEN_TTL_MS - (Date.now() - s.createdAt))/1000) });
    cb({ ok: true });
  });

  socket.on("consent-response", ({ id, accepted } = {}, cb = () => {}) => {
    const s = sessions.get(String(id || ""));
    if (!s || s.receiverSocket !== socket.id || s.state !== "pending-consent") {
      cb({ ok: false, error: "Request is no longer active." }); return;
    }
    if (accepted !== true) {
      emitTo(s.requesterSocket, "request-declined", {});
      cleanSession(s.id);
      cb({ ok: true }); return;
    }
    s.state = "accepted";
    emitTo(s.requesterSocket, "request-accepted", { receiverName: s.receiverName });
    cb({ ok: true });
  });

  socket.on("media-ready", ({ id } = {}, cb = () => {}) => {
    const s = sessions.get(String(id || ""));
    if (!s || s.receiverSocket !== socket.id || s.state !== "accepted") {
      cb({ ok: false, error: "Consent is required before connecting media." }); return;
    }
    s.state = "sharing";
    emitTo(s.requesterSocket, "media-ready", {});
    cb({ ok: true });
  });

  socket.on("signal", ({ id, data } = {}) => {
    const s = sessions.get(String(id || ""));
    if (!s || s.state !== "sharing" || !data || typeof data !== "object") return;
    if (socket.id === s.requesterSocket) emitTo(s.receiverSocket, "signal", data);
    else if (socket.id === s.receiverSocket) emitTo(s.requesterSocket, "signal", data);
  });

  socket.on("stop-session", ({ id } = {}) => {
    const s = sessions.get(String(id || ""));
    if (!s || ![s.requesterSocket, s.receiverSocket].includes(socket.id)) return;
    emitTo(s.requesterSocket, "session-stopped", {});
    emitTo(s.receiverSocket, "session-stopped", {});
    cleanSession(s.id);
  });

  socket.on("disconnect", () => {
    const id = sockets.get(socket.id);
    if (!id) return;
    const s = sessions.get(id);
    if (s) {
      emitTo(s.requesterSocket === socket.id ? s.receiverSocket : s.requesterSocket, "session-stopped", {});
      cleanSession(id);
    }
    sockets.delete(socket.id);
  });
});
function getBaseUrl(socket) {
  const proto = socket.request.headers["x-forwarded-proto"] || (socket.request.secure ? "https" : "http");
  const host = socket.request.headers["x-forwarded-host"] || socket.request.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > TOKEN_TTL_MS) {
    emitTo(s.requesterSocket, "session-stopped", {});
    emitTo(s.receiverSocket, "session-stopped", {});
    cleanSession(id);
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`Cloudzer listening on ${PORT}`));
