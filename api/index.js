// src/app.ts
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose3 from "mongoose";

// src/db.ts
import mongoose2 from "mongoose";

// src/errors.ts
var HttpError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
};

// src/models.ts
import mongoose, { Schema, model } from "mongoose";

// src/slow.ts
var SLOW_MS = 200;
function slowQueries(schema, modelName) {
  const started = /* @__PURE__ */ new WeakMap();
  const mark = function() {
    started.set(this, Date.now());
  };
  const report = function() {
    const began = started.get(this);
    if (!began) return;
    const ms = Date.now() - began;
    if (ms >= SLOW_MS) console.info(JSON.stringify({ msg: "slow-query", model: modelName, ms }));
  };
  schema.pre(/^find|^count|^update|^delete/, mark);
  schema.post(/^find|^count|^update|^delete/, report);
  schema.pre("aggregate", mark);
  schema.post("aggregate", report);
}

// src/models.ts
var NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1e3;
var userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    accent: { type: String, default: "#171717" },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    emailVerifiedAt: { type: Date, default: null },
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    googleId: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
var projectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["active", "archived"], default: "active", required: true }
  },
  { timestamps: true }
);
projectSchema.index({ userId: 1, status: 1, updatedAt: -1 });
projectSchema.index(
  { userId: 1, name: "text", description: "text" },
  { weights: { name: 5, description: 1 }, name: "ProjectTextIndex" }
);
var labelSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    color: { type: String, required: true }
  },
  { timestamps: true }
);
labelSchema.index({ userId: 1, name: 1 }, { unique: true });
var taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", required: true },
    labelIds: { type: [{ type: Schema.Types.ObjectId, ref: "Label" }], default: [] },
    plannedFor: { type: String, default: null },
    completedOn: { type: String, default: null },
    order: { type: Number, required: true },
    // Client-generated id so a retried or replayed create returns the same task.
    clientId: { type: String }
  },
  { timestamps: true }
);
taskSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
);
taskSchema.index({ projectId: 1, completed: 1 });
taskSchema.index({ userId: 1, plannedFor: 1 });
taskSchema.index({ userId: 1, completedOn: 1 });
taskSchema.index({ userId: 1, projectId: 1, order: 1, createdAt: 1, _id: 1 });
taskSchema.index({ userId: 1, completed: 1, dueDate: 1 });
taskSchema.index({ userId: 1, title: "text" }, { name: "TaskTextIndex" });
var noteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" }
  },
  { timestamps: true }
);
noteSchema.index({ userId: 1, projectId: 1, updatedAt: -1 });
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index(
  { userId: 1, title: "text", body: "text" },
  { weights: { title: 5, body: 1 }, name: "NoteTextIndex" }
);
var activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    type: { type: String, enum: ["create", "update", "delete", "complete"], required: true },
    summary: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
activitySchema.index({ projectId: 1, createdAt: -1, _id: -1 });
var notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    kind: { type: String, enum: ["due-soon", "overdue"], required: true },
    title: { type: String, required: true },
    projectName: { type: String, required: true },
    dueDate: { type: String, required: true },
    read: { type: Boolean, default: false, required: true },
    key: { type: String, required: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + NINETY_DAYS_MS) }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
notificationSchema.index({ userId: 1, key: 1 }, { unique: true });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
var whiteboardSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    scene: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);
whiteboardSchema.index({ userId: 1, projectId: 1 }, { unique: true });
var sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, default: null },
    rotatedAt: { type: Date, default: null },
    userAgent: { type: String, default: "" },
    lastSeenAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 });
sessionSchema.index({ familyId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
var tokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["verify", "reset"], required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
tokenSchema.index({ tokenHash: 1 }, { unique: true });
tokenSchema.index({ userId: 1, type: 1 });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
var rateLimitSchema = new Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: false }
);
rateLimitSchema.index({ key: 1 }, { unique: true });
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
slowQueries(userSchema, "User");
slowQueries(projectSchema, "Project");
slowQueries(labelSchema, "Label");
slowQueries(taskSchema, "Task");
slowQueries(noteSchema, "Note");
slowQueries(activitySchema, "Activity");
slowQueries(notificationSchema, "Notification");
slowQueries(whiteboardSchema, "Whiteboard");
slowQueries(sessionSchema, "Session");
slowQueries(tokenSchema, "Token");
slowQueries(rateLimitSchema, "RateLimit");
function compile(name, factory) {
  const existing = mongoose.models[name];
  if (existing) return existing;
  return factory();
}
var User = compile("User", () => model("User", userSchema));
var Project = compile("Project", () => model("Project", projectSchema));
var Label = compile("Label", () => model("Label", labelSchema));
var Task = compile("Task", () => model("Task", taskSchema));
var Note = compile("Note", () => model("Note", noteSchema));
var Activity = compile("Activity", () => model("Activity", activitySchema));
var Notification = compile("Notification", () => model("Notification", notificationSchema));
var Whiteboard = compile("Whiteboard", () => model("Whiteboard", whiteboardSchema));
var Session = compile("Session", () => model("Session", sessionSchema));
var AuthToken = compile("AuthToken", () => model("AuthToken", tokenSchema));
var RateLimit = compile("RateLimit", () => model("RateLimit", rateLimitSchema));

// src/db.ts
var globalCache = globalThis;
function cache() {
  globalCache.__alignMongoose ??= { conn: null, promise: null };
  return globalCache.__alignMongoose;
}
var indexesReady = null;
async function dropUnscopedText(collection, name) {
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch {
    return;
  }
  const found = indexes.find((index) => index.name === name);
  if (!found || found.key?.userId === 1) return;
  await collection.dropIndex(name);
}
function ensureIndexes() {
  indexesReady ??= Promise.all([
    dropUnscopedText(Project.collection, "ProjectTextIndex"),
    dropUnscopedText(Task.collection, "TaskTextIndex"),
    dropUnscopedText(Note.collection, "NoteTextIndex")
  ]).then(
    () => Promise.all([
      User.syncIndexes(),
      Project.syncIndexes(),
      Label.syncIndexes(),
      Task.syncIndexes(),
      Note.syncIndexes(),
      Activity.syncIndexes(),
      Notification.syncIndexes(),
      Whiteboard.syncIndexes(),
      Session.syncIndexes(),
      AuthToken.syncIndexes(),
      RateLimit.syncIndexes()
    ])
  ).then(() => void 0).catch((error) => {
    indexesReady = null;
    throw error;
  });
  return indexesReady;
}
function databaseFailure(error) {
  console.error(error);
  return new HttpError(500, "Database connection failed.");
}
function shouldSync(options) {
  return options?.indexes === true || process.env.NODE_ENV === "test";
}
async function connectDb(options) {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri === "memory") {
    throw new HttpError(500, "Database is not configured.");
  }
  const state = cache();
  if (state.conn) {
    if (shouldSync(options)) await ensureIndexes();
    return state.conn;
  }
  if (!state.promise) {
    mongoose2.set("bufferCommands", false);
    state.promise = mongoose2.connect(uri, {
      serverSelectionTimeoutMS: 5e3,
      maxPoolSize: 5,
      minPoolSize: 1,
      maxIdleTimeMS: 6e4,
      socketTimeoutMS: 2e4
    }).then((connection) => {
      state.conn = connection;
      return connection;
    }).catch((error) => {
      state.promise = null;
      throw error;
    });
  }
  try {
    state.conn = await state.promise;
  } catch (error) {
    state.conn = null;
    state.promise = null;
    throw error instanceof HttpError ? error : databaseFailure(error);
  }
  if (shouldSync(options)) await ensureIndexes();
  return state.conn;
}

// src/httpCache.ts
function privateRevalidate() {
  return (_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "private, no-cache");
      return json(body);
    };
    next();
  };
}

// src/middleware.ts
import { ZodError } from "zod";

// src/session.ts
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import "mongoose";
var ACCESS_COOKIE = "token";
var REFRESH_COOKIE = "refresh";
var ACCESS_MS = 15 * 60 * 1e3;
var REFRESH_MS = 30 * 24 * 60 * 60 * 1e3;
var REUSE_GRACE_MS = process.env.NODE_ENV === "test" ? 0 : 15e3;
function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new HttpError(500, "Auth is not configured.");
  return value;
}
function cookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  };
}
function readCookie(header, name = ACCESS_COOKIE) {
  if (!header) return void 0;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return void 0;
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function clearSession(res) {
  res.clearCookie(ACCESS_COOKIE, cookieBase());
  res.clearCookie(REFRESH_COOKIE, cookieBase());
}
function writeCookies(res, userId, sessionId, refresh) {
  const access = jwt.sign({ sub: userId, sid: sessionId, typ: "access" }, secret(), { expiresIn: "15m" });
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), maxAge: ACCESS_MS });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), maxAge: REFRESH_MS });
}
async function startSession(res, userId, userAgent) {
  await issueSession(res, userId, randomBytes(16).toString("hex"), userAgent);
}
async function issueSession(res, userId, familyId, userAgent, previousId) {
  const refresh = randomBytes(32).toString("hex");
  const session = await Session.create({
    userId,
    familyId,
    tokenHash: hashToken(refresh),
    expiresAt: new Date(Date.now() + REFRESH_MS),
    userAgent: (userAgent ?? "").slice(0, 300),
    lastSeenAt: /* @__PURE__ */ new Date()
  });
  if (previousId) {
    await Session.updateOne({ _id: previousId }, { replacedBy: session._id, rotatedAt: /* @__PURE__ */ new Date() });
  }
  writeCookies(res, userId, session.id, refresh);
}
function accessFromRequest(req) {
  const token = readCookie(req.headers.cookie);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === "string" || payload.typ !== "access") return null;
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}
async function rotateRefresh(req, res) {
  const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
  if (!raw) return null;
  const current = await Session.findOne({ tokenHash: hashToken(raw) });
  if (!current || current.revokedAt || current.expiresAt.getTime() <= Date.now()) {
    clearSession(res);
    return null;
  }
  if (current.replacedBy) {
    const rotatedAt = current.rotatedAt?.getTime() ?? 0;
    if (Date.now() - rotatedAt > REUSE_GRACE_MS) {
      await Session.updateMany({ familyId: current.familyId, revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() });
      clearSession(res);
    }
    return null;
  }
  await issueSession(res, current.userId.toString(), current.familyId, current.userAgent, current._id);
  return current.userId.toString();
}
async function revokeRefreshCookie(req) {
  const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
  if (!raw) return;
  await Session.updateOne({ tokenHash: hashToken(raw), revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() });
}
function deviceLabel(userAgent) {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows" : /Mac OS/.test(userAgent) ? "macOS" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Linux/.test(userAgent) ? "Linux" : "Unknown device";
  return `${browser} on ${os}`;
}

// src/middleware.ts
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
var requireAuth = (req, _res, next) => {
  const access = accessFromRequest(req);
  if (!access) {
    next(new HttpError(401, "Sign in to continue."));
    return;
  }
  Promise.all([User.findById(access.userId), Session.findById(access.sid)]).then(([user, session]) => {
    if (!user || !session || session.revokedAt || session.replacedBy || session.userId.toString() !== user.id) {
      next(new HttpError(401, "Sign in to continue."));
      return;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      next(new HttpError(401, "Sign in to continue."));
      return;
    }
    req.userId = user.id;
    req.sessionId = session.id;
    if (Date.now() - session.lastSeenAt.getTime() > 6e4) {
      void Session.updateOne({ _id: session._id }, { lastSeenAt: /* @__PURE__ */ new Date() }).catch(() => void 0);
    }
    next();
  }).catch(next);
};
function currentUserId(req) {
  if (!req.userId) throw new HttpError(401, "Sign in to continue.");
  return req.userId;
}
function isRecord(error) {
  return typeof error === "object" && error !== null;
}
var errorHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid input." });
    return;
  }
  if (isRecord(error) && error.type === "entity.too.large") {
    res.status(413).json({ error: "Request is too large." });
    return;
  }
  if (error instanceof SyntaxError && isRecord(error) && error.status === 400) {
    res.status(400).json({ error: "Invalid JSON." });
    return;
  }
  if (isRecord(error) && error.code === 11e3) {
    const pattern = isRecord(error.keyPattern) ? error.keyPattern : null;
    if (!pattern || "email" in pattern) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    res.status(409).json({ error: "That record already exists." });
    return;
  }
  if (isRecord(error) && error.name === "CastError") {
    res.status(404).json({ error: "Not found." });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Something went wrong. Try again." });
};

// src/security.ts
var EXTRA_ORIGINS = /* @__PURE__ */ new Set([
  "https://align-hazel-kappa.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
function allowed(origin, host) {
  if (EXTRA_ORIGINS.has(origin)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
var guardOrigin = (req, res, next) => {
  const header = req.headers.origin;
  const origin = typeof header === "string" && header !== "null" ? header : "";
  res.setHeader("Access-Control-Expose-Headers", "X-Next-Cursor");
  if (origin) {
    if (!allowed(origin, req.get("host"))) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    const referer = req.get("referer");
    const source = origin || (referer ? originOf(referer) : "");
    if (source && !allowed(source, req.get("host"))) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
  }
  next();
};

// src/version.ts
var APP_VERSION = 2;
var MINIMUM_CLIENT_VERSION = 2;

// src/routes/auth.ts
import { randomBytes as randomBytes3 } from "node:crypto";
import { Router } from "express";
import jwt2 from "jsonwebtoken";

// src/mail.ts
async function deliverMail(input) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) {
      console.error(JSON.stringify({ msg: "mail-failed", status: response.status }));
      return false;
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

// src/password.ts
var loaded = null;
function bcrypt() {
  loaded ??= import("bcryptjs").then((mod) => {
    const api = "default" in mod && mod.default && typeof mod.default.hash === "function" ? mod.default : mod;
    return api;
  });
  return loaded;
}
function bcryptRounds() {
  const configured = process.env.BCRYPT_ROUNDS;
  if (configured && /^\d+$/.test(configured)) return Number(configured);
  return process.env.NODE_ENV === "test" ? 4 : 12;
}
async function hashPassword(password2) {
  const api = await bcrypt();
  return api.hash(password2, bcryptRounds());
}
async function checkPassword(password2, hash) {
  const started = Date.now();
  const api = await bcrypt();
  const matches = await api.compare(password2, hash);
  if (process.env.NODE_ENV !== "test") {
    console.info(JSON.stringify({ msg: "bcrypt-compare", ms: Date.now() - started, rounds: bcryptRounds() }));
  }
  return matches;
}
var dummyHash = null;
function dummyPasswordHash() {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash;
}

// src/rateLimit.ts
var WINDOW_MS = 15 * 60 * 1e3;
var PRODUCTION_MAX = {
  login: 10,
  register: 5,
  forgot: 5,
  reset: 10
};
function duplicateKey(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11e3;
}
async function hit(key, max) {
  const now = Date.now();
  const expiresAt = new Date(now + WINDOW_MS);
  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true }
    );
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    doc = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true });
  }
  if (doc && doc.expiresAt.getTime() <= now) {
    doc = await RateLimit.findOneAndUpdate({ key }, { $set: { count: 1, expiresAt } }, { new: true });
  }
  return (doc?.count ?? 1) > max;
}
async function enforceAuthLimit(route, ip, email2) {
  const max = process.env.NODE_ENV === "production" ? PRODUCTION_MAX[route] : 1e3;
  const keys = [`${route}:ip:${ip || "unknown"}`];
  if (email2) keys.push(`${route}:email:${email2}`);
  const blocked = await Promise.all(keys.map((key) => hit(key, max)));
  if (blocked.some(Boolean)) throw new HttpError(429, "Too many attempts. Try again later.");
}

// src/serialize.ts
function docId(doc) {
  return doc.id || doc._id.toString();
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accent: user.accent || "#171717",
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString()
  };
}
function publicProject(project) {
  return {
    id: docId(project),
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}
function publicLabel(label) {
  return {
    id: docId(label),
    name: label.name,
    color: label.color,
    createdAt: label.createdAt.toISOString()
  };
}
function publicTask(task) {
  return {
    id: docId(task),
    projectId: task.projectId.toString(),
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    plannedFor: task.plannedFor ?? null,
    completedOn: task.completedOn ?? null,
    order: task.order,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}
function publicActivity(item) {
  return {
    id: docId(item),
    projectId: item.projectId ? item.projectId.toString() : "",
    type: item.type,
    summary: item.summary,
    createdAt: item.createdAt.toISOString()
  };
}
function publicNotification(item) {
  return {
    id: docId(item),
    projectId: item.projectId.toString(),
    taskId: item.taskId.toString(),
    kind: item.kind,
    title: item.title,
    projectName: item.projectName,
    dueDate: item.dueDate,
    read: item.read,
    createdAt: item.createdAt.toISOString()
  };
}
function publicNote(note) {
  return {
    id: docId(note),
    projectId: note.projectId.toString(),
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString()
  };
}

// src/tokens.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var HOUR_MS = 60 * 60 * 1e3;
async function issueAuthToken(userId, type) {
  const token = randomBytes2(32).toString("hex");
  const ttl = type === "verify" ? 24 * HOUR_MS : HOUR_MS;
  await AuthToken.deleteMany({ userId, type, usedAt: null });
  await AuthToken.create({
    userId,
    type,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttl)
  });
  return token;
}
async function consumeAuthToken(token, type) {
  const found = await AuthToken.findOne({
    tokenHash: hashToken(token),
    type,
    usedAt: null,
    expiresAt: { $gt: /* @__PURE__ */ new Date() }
  });
  if (!found) return null;
  found.usedAt = /* @__PURE__ */ new Date();
  await found.save();
  return found.userId.toString();
}

// ../shared/schemas.ts
import { z } from "zod";

// ../shared/passwordPolicy.ts
var COMMON = /* @__PURE__ */ new Set([
  "password",
  "password1",
  "qwerty",
  "qwerty123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "letmein",
  "admin",
  "welcome",
  "iloveyou",
  "abc123",
  "monkey",
  "dragon",
  "master",
  "login",
  "passw0rd",
  "trustno1",
  "sunshine",
  "princess",
  "football",
  "shadow",
  "111111",
  "000000",
  "654321",
  "superman",
  "batman",
  "access",
  "hello",
  "charlie"
]);
var MEDIUM_PASSWORD_MESSAGE = "Use at least 10 characters, or a stronger mix of letters, numbers, and symbols.";
function passwordScore(password2) {
  if (!password2) return 0;
  const lower = password2.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password2)) return 0;
  let score2 = 0;
  if (password2.length >= 8) score2 += 1;
  if (password2.length >= 12) score2 += 1;
  const classes = Number(/[a-z]/.test(password2)) + Number(/[A-Z]/.test(password2)) + Number(/\d/.test(password2)) + Number(/[^A-Za-z0-9]/.test(password2));
  if (classes >= 2) score2 += 1;
  if (classes >= 3) score2 += 1;
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|qwer|asdf|zxcv|abcd)/i.test(password2) && password2.length < 12) {
    score2 = Math.min(score2, 1);
  }
  return Math.min(4, score2);
}
function isMediumPassword(password2) {
  if (password2.length < 1 || password2.length > 128) return false;
  if (password2.length >= 10) return true;
  return passwordScore(password2) >= 2;
}

// ../shared/schemas.ts
function text(label, max) {
  return z.string({ required_error: `${label} is required.`, invalid_type_error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
}
function password(label = "Password") {
  return z.string({
    required_error: MEDIUM_PASSWORD_MESSAGE,
    invalid_type_error: MEDIUM_PASSWORD_MESSAGE
  }).max(128, `${label} is too long.`).refine((value) => isMediumPassword(value), MEDIUM_PASSWORD_MESSAGE);
}
var email = z.string({ required_error: "Enter a valid email.", invalid_type_error: "Enter a valid email." }).trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email.").max(254, "Enter a valid email.");
var description = z.string({ invalid_type_error: "Description must be text." }).trim().max(2e3, "Description is too long.");
var dueDate = z.union([z.string({ invalid_type_error: "Use a valid due date." }), z.null()]);
var registerSchema = z.object({
  name: text("Name", 80),
  email,
  password: password()
});
var forgotSchema = z.object({
  email
});
var resetSchema = z.object({
  token: z.string({ required_error: "This reset link is invalid or has expired." }).trim().min(20, "This reset link is invalid or has expired.").max(200, "This reset link is invalid or has expired."),
  password: password()
});
var loginSchema = z.object({
  email: z.string({
    required_error: "Email or password is incorrect.",
    invalid_type_error: "Email or password is incorrect."
  }).trim().toLowerCase().min(1, "Email or password is incorrect.").max(254, "Email or password is incorrect."),
  password: z.string({
    required_error: "Email or password is incorrect.",
    invalid_type_error: "Email or password is incorrect."
  }).min(1, "Email or password is incorrect.").max(128, "Email or password is incorrect.")
});
var accentColor = z.string({ invalid_type_error: "Choose a color." }).trim().regex(/^#[0-9a-fA-F]{6}$/, "Choose a color.");
var profileSchema = z.object({
  name: text("Name", 80).optional(),
  accent: accentColor.optional()
}).refine((value) => value.name !== void 0 || value.accent !== void 0, {
  message: "Nothing to update."
});
var verifySchema = z.object({
  token: z.string({ required_error: "This verification link is invalid or has expired." }).trim().min(20, "This verification link is invalid or has expired.").max(200, "This verification link is invalid or has expired.")
});
var passwordSchema = z.object({
  currentPassword: z.string({
    required_error: "Current password is incorrect.",
    invalid_type_error: "Current password is incorrect."
  }).min(1, "Current password is incorrect."),
  newPassword: password("New password")
});
var projectCreateSchema = z.object({
  name: text("Project name", 120),
  description: description.optional()
});
var projectPatchSchema = z.object({
  name: text("Project name", 120).optional(),
  description: description.optional()
});
var priorities = ["low", "medium", "high", "urgent"];
var priority = z.enum(priorities, {
  errorMap: () => ({ message: "Priority must be low, medium, high, or urgent." })
});
var labelIds = z.array(z.string({ invalid_type_error: "Unknown label." }), { invalid_type_error: "Unknown label." }).max(12, "Too many labels.");
var labelColor = z.string({ required_error: "Choose a color.", invalid_type_error: "Choose a color." }).trim().regex(/^#[0-9a-fA-F]{6}$/, "Choose a color.");
var taskCreateSchema = z.object({
  title: text("Task title", 200),
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
  plannedFor: dueDate.optional(),
  clientId: z.string().uuid("clientId must be a uuid.").optional()
});
var taskPatchSchema = z.object({
  title: text("Task title", 200).optional(),
  completed: z.boolean({ invalid_type_error: "Completed must be true or false." }).optional(),
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
  plannedFor: dueDate.optional(),
  completedOn: dueDate.optional(),
  order: z.number({ invalid_type_error: "Order must be a number." }).finite("Order must be a number.").optional()
});
var labelCreateSchema = z.object({
  name: text("Label name", 40),
  color: labelColor
});
var labelPatchSchema = z.object({
  name: text("Label name", 40).optional(),
  color: labelColor.optional()
});
var noteCreateSchema = z.object({
  title: z.string({ invalid_type_error: "Title is required." }).trim().max(160, "Title is too long.").optional(),
  body: z.string({ invalid_type_error: "Note is too long." }).max(1e5, "Note is too long.").optional()
});
var notePatchSchema = z.object({
  title: text("Title", 160).optional(),
  body: z.string({ invalid_type_error: "Note is too long." }).max(1e5, "Note is too long.").optional()
});
var finite = z.number({ invalid_type_error: "Whiteboard is invalid." }).finite();
var hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Whiteboard is invalid.");
var point = z.object({ x: finite, y: finite });
var whiteboardSceneSchema = z.object({
  strokes: z.array(
    z.object({
      id: z.string().min(1).max(40),
      tool: z.enum(["pen", "eraser"]),
      points: z.array(point).min(1).max(1500),
      color: hex,
      width: finite.min(1).max(64)
    })
  ).max(400),
  shapes: z.array(
    z.object({
      id: z.string().min(1).max(40),
      kind: z.enum(["rect", "ellipse"]),
      x: finite,
      y: finite,
      w: finite,
      h: finite,
      color: hex
    })
  ).max(200),
  texts: z.array(
    z.object({
      id: z.string().min(1).max(40),
      x: finite,
      y: finite,
      text: z.string().max(280),
      color: hex
    })
  ).max(200),
  viewport: z.object({
    x: finite,
    y: finite,
    scale: finite.min(0.2).max(4)
  })
});
var emptyScene = {
  strokes: [],
  shapes: [],
  texts: [],
  viewport: { x: 0, y: 0, scale: 1 }
};

// src/validate.ts
function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid input.");
  }
  return result.data;
}
function normalizeDueDate(value) {
  if (value === void 0) return void 0;
  if (value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Use a valid due date.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "Use a valid due date.");
  }
  return value;
}

// src/routes/auth.ts
var LOCK_AFTER = 5;
function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}
function appOrigin(req) {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}
function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
async function sendOrReveal(email2, subject, text2) {
  return deliverMail({ to: email2, subject, text: text2 });
}
function lockDelay(failures) {
  const steps = Math.min(6, Math.max(1, failures - LOCK_AFTER + 1));
  return Math.min(60, 2 ** steps) * 60 * 1e3;
}
function authRouter(limiter) {
  const router = Router();
  router.get("/providers", (_req, res) => {
    res.json({ google: googleConfigured() });
  });
  router.post(
    "/register",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(registerSchema, req.body);
      await enforceAuthLimit("register", clientIp(req), input.email);
      const existing = await User.findOne({ email: input.email });
      if (existing) throw new HttpError(409, "An account with this email already exists.");
      const user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: null
      });
      const verifyToken = await issueAuthToken(user.id, "verify");
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(verifyToken)}`;
      const mailed = await sendOrReveal(
        user.email,
        "Verify your Align email",
        `Confirm your email by opening this link within 24 hours:
${link}`
      );
      await startSession(res, user.id, req.get("user-agent"));
      res.status(201).json(mailed ? publicUser(user) : { ...publicUser(user), verifyToken });
    })
  );
  router.post(
    "/login",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body);
      const [, user] = await Promise.all([
        enforceAuthLimit("login", clientIp(req), input.email),
        User.findOne({ email: input.email }).select("+passwordHash")
      ]);
      if (user?.lockUntil && user.lockUntil.getTime() > Date.now()) {
        throw new HttpError(429, "Too many attempts. Try again later.");
      }
      const hash = user?.passwordHash ?? await dummyPasswordHash();
      const matches = await checkPassword(input.password, hash);
      if (!user || !matches) {
        if (user) {
          user.failedLogins = (user.failedLogins ?? 0) + 1;
          if (user.failedLogins >= LOCK_AFTER) user.lockUntil = new Date(Date.now() + lockDelay(user.failedLogins));
          await user.save();
        }
        throw new HttpError(401, "Email or password is incorrect.");
      }
      if (user.failedLogins || user.lockUntil) {
        user.failedLogins = 0;
        user.lockUntil = null;
        await user.save();
      }
      await startSession(res, user.id, req.get("user-agent"));
      res.json(publicUser(user));
    })
  );
  router.get(
    "/session",
    asyncHandler(async (req, res) => {
      const access = accessFromRequest(req);
      if (access) {
        const session = await Session.findById(access.sid);
        const current = session && !session.revokedAt && !session.replacedBy && session.expiresAt.getTime() > Date.now() && session.userId.toString() === access.userId;
        if (current) {
          const user2 = await User.findById(access.userId);
          res.json({ user: user2 ? publicUser(user2) : null });
          return;
        }
      }
      const userId = await rotateRefresh(req, res);
      if (!userId) {
        res.json({ user: null });
        return;
      }
      const user = await User.findById(userId);
      res.json({ user: user ? publicUser(user) : null });
    })
  );
  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const userId = await rotateRefresh(req, res);
      if (!userId) throw new HttpError(401, "Sign in to continue.");
      const user = await User.findById(userId);
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json(publicUser(user));
    })
  );
  router.post(
    "/forgot",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(forgotSchema, req.body);
      await enforceAuthLimit("forgot", clientIp(req), input.email);
      const user = await User.findOne({ email: input.email });
      const body = {
        message: "If an account exists for that email, a reset link is ready."
      };
      if (user) {
        const resetToken = await issueAuthToken(user.id, "reset");
        const link = `${appOrigin(req)}/reset?token=${encodeURIComponent(resetToken)}`;
        const mailed = await sendOrReveal(
          user.email,
          "Reset your Align password",
          `Reset your password by opening this link within one hour:
${link}`
        );
        if (!mailed) body.resetToken = resetToken;
      }
      res.json(body);
    })
  );
  router.post(
    "/reset",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(resetSchema, req.body);
      await enforceAuthLimit("reset", clientIp(req));
      const userId = await consumeAuthToken(input.token, "reset");
      const user = userId ? await User.findById(userId).select("+passwordHash") : null;
      if (!user) throw new HttpError(400, "This reset link is invalid or has expired.");
      user.passwordHash = await hashPassword(input.password);
      user.failedLogins = 0;
      user.lockUntil = null;
      await user.save();
      await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() });
      await startSession(res, user.id, req.get("user-agent"));
      res.json(publicUser(user));
    })
  );
  router.post(
    "/verify",
    asyncHandler(async (req, res) => {
      const input = parseBody(verifySchema, req.body);
      const userId = await consumeAuthToken(input.token, "verify");
      const user = userId ? await User.findById(userId) : null;
      if (!user) throw new HttpError(400, "This verification link is invalid or has expired.");
      if (!user.emailVerifiedAt) user.emailVerifiedAt = /* @__PURE__ */ new Date();
      await user.save();
      res.json(publicUser(user));
    })
  );
  router.post(
    "/verify/send",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await User.findById(currentUserId(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      if (user.emailVerifiedAt) {
        res.json({ message: "This email is already verified." });
        return;
      }
      const verifyToken = await issueAuthToken(user.id, "verify");
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(verifyToken)}`;
      const mailed = await sendOrReveal(
        user.email,
        "Verify your Align email",
        `Confirm your email by opening this link within 24 hours:
${link}`
      );
      res.json(mailed ? { message: "Verification link sent." } : { message: "Verification link ready.", verifyToken });
    })
  );
  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      try {
        await revokeRefreshCookie(req);
      } catch {
      }
      clearSession(res);
      res.status(204).send();
    })
  );
  router.get(
    "/sessions",
    requireAuth,
    asyncHandler(async (req, res) => {
      const sessions = await Session.find({
        userId: currentUserId(req),
        revokedAt: null,
        replacedBy: null,
        expiresAt: { $gt: /* @__PURE__ */ new Date() }
      }).select("userAgent lastSeenAt createdAt").sort({ lastSeenAt: -1 }).lean();
      res.json(
        sessions.map((session) => ({
          id: session._id.toString(),
          current: session._id.toString() === req.sessionId,
          device: deviceLabel(session.userAgent || ""),
          lastSeenAt: session.lastSeenAt.toISOString(),
          createdAt: session.createdAt.toISOString()
        }))
      );
    })
  );
  router.delete(
    "/sessions/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = await Session.findOne({
        _id: req.params.id,
        userId: currentUserId(req),
        revokedAt: null
      });
      if (!session || session.replacedBy) throw new HttpError(404, "Session not found.");
      session.revokedAt = /* @__PURE__ */ new Date();
      await session.save();
      if (session.id === req.sessionId) clearSession(res);
      res.status(204).send();
    })
  );
  router.post(
    "/sessions/revoke-all",
    requireAuth,
    asyncHandler(async (req, res) => {
      await Session.updateMany({ userId: currentUserId(req), revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() });
      clearSession(res);
      res.status(204).send();
    })
  );
  router.get(
    "/google",
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) throw new HttpError(404, "Google sign-in is not configured.");
      const state = jwt2.sign({ typ: "google" }, process.env.JWT_SECRET ?? "", { expiresIn: "10m" });
      const redirect = `${appOrigin(req)}/api/auth/google/callback`;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
      url.searchParams.set("redirect_uri", redirect);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "select_account");
      res.redirect(url.toString());
    })
  );
  router.get(
    "/google/callback",
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) throw new HttpError(404, "Google sign-in is not configured.");
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const fail = () => {
        res.redirect("/login?error=google");
      };
      try {
        const payload = jwt2.verify(state, process.env.JWT_SECRET ?? "");
        if (typeof payload === "string" || payload.typ !== "google" || !code) {
          fail();
          return;
        }
      } catch {
        fail();
        return;
      }
      const redirect = `${appOrigin(req)}/api/auth/google/callback`;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID ?? "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          redirect_uri: redirect,
          grant_type: "authorization_code"
        }),
        signal: AbortSignal.timeout(8e3)
      });
      if (!tokenResponse.ok) {
        fail();
        return;
      }
      const tokenBody = await tokenResponse.json();
      if (!tokenBody.access_token) {
        fail();
        return;
      }
      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        signal: AbortSignal.timeout(8e3)
      });
      if (!profileResponse.ok) {
        fail();
        return;
      }
      const profile = await profileResponse.json();
      const email2 = profile.email?.trim().toLowerCase();
      if (!profile.sub || !email2 || profile.email_verified !== true) {
        fail();
        return;
      }
      let user = await User.findOne({ googleId: profile.sub });
      if (!user) user = await User.findOne({ email: email2 });
      if (user) {
        if (!user.googleId) user.googleId = profile.sub;
        if (!user.emailVerifiedAt) user.emailVerifiedAt = /* @__PURE__ */ new Date();
        await user.save();
      } else {
        user = await User.create({
          name: (profile.name || email2.split("@")[0] || "Align").slice(0, 80),
          email: email2,
          passwordHash: await hashPassword(randomBytes3(32).toString("hex")),
          emailVerifiedAt: /* @__PURE__ */ new Date(),
          googleId: profile.sub
        });
      }
      await startSession(res, user.id, req.get("user-agent"));
      res.redirect("/");
    })
  );
  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await User.findById(currentUserId(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json(publicUser(user));
    })
  );
  router.patch(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(profileSchema, req.body);
      const update = {};
      if (input.name !== void 0) update.name = input.name;
      if (input.accent !== void 0) update.accent = input.accent.toLowerCase();
      const user = await User.findByIdAndUpdate(currentUserId(req), update, { new: true });
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json(publicUser(user));
    })
  );
  router.post(
    "/password",
    limiter,
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(passwordSchema, req.body);
      const user = await User.findById(currentUserId(req)).select("+passwordHash");
      if (!user?.passwordHash) throw new HttpError(401, "Sign in to continue.");
      const matches = await checkPassword(input.currentPassword, user.passwordHash);
      if (!matches) throw new HttpError(400, "Current password is incorrect.");
      user.passwordHash = await hashPassword(input.newPassword);
      await user.save();
      await Session.updateMany(
        { userId: user._id, _id: { $ne: req.sessionId }, revokedAt: null },
        { revokedAt: /* @__PURE__ */ new Date() }
      );
      await rotateRefresh(req, res);
      res.status(204).send();
    })
  );
  router.delete(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      await Task.deleteMany({ userId });
      await Note.deleteMany({ userId });
      await Label.deleteMany({ userId });
      await Activity.deleteMany({ userId });
      await Notification.deleteMany({ userId });
      await Whiteboard.deleteMany({ userId });
      await Project.deleteMany({ userId });
      await Session.deleteMany({ userId });
      await AuthToken.deleteMany({ userId });
      await User.deleteOne({ _id: userId });
      clearSession(res);
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/bench.ts
import { Router as Router2 } from "express";
var BENCH_EMAIL = "bench-depth@align.test";
function scans(plan, found = []) {
  if (!plan) return found;
  if (plan.stage === "IXSCAN" || plan.stage === "COLLSCAN") found.push(plan);
  if (plan.inputStage) scans(plan.inputStage, found);
  if (plan.inputStages) plan.inputStages.forEach((stage) => scans(stage, found));
  if (plan.shards) Object.values(plan.shards).forEach((shard) => scans(shard.winningPlan, found));
  return found;
}
async function summarize(name, query, limit = 50) {
  const explained = await query.limit(limit).explain("executionStats");
  const plan = explained;
  const found = scans(plan.queryPlanner?.winningPlan);
  const stats = plan.executionStats;
  return {
    name,
    stages: found.map((scan) => scan.stage),
    indexes: found.map((scan) => scan.indexName).filter(Boolean),
    keysExamined: stats?.totalKeysExamined ?? null,
    docsExamined: stats?.totalDocsExamined ?? null,
    returned: stats?.nReturned ?? null
  };
}
async function requireBench(userId) {
  const user = await User.findById(userId).select("email");
  if (!user || user.email !== BENCH_EMAIL) throw new HttpError(404, "Not found.");
  return user;
}
function benchRouter() {
  const router = Router2();
  router.use(requireAuth);
  router.post(
    "/seed",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      await requireBench(userId);
      const existing = await Task.countDocuments({ userId });
      if (existing >= 1e3) {
        res.json(await counts(userId));
        return;
      }
      await Promise.all([
        Project.deleteMany({ userId }),
        Task.deleteMany({ userId }),
        Note.deleteMany({ userId }),
        Activity.deleteMany({ userId }),
        Notification.deleteMany({ userId })
      ]);
      const now = Date.now();
      const projects = await Project.insertMany(
        Array.from({ length: 20 }, (_, index) => ({
          userId,
          name: index === 0 ? "Launch checklist" : `Project ${String(index + 1).padStart(2, "0")}`,
          description: index % 5 === 0 ? "Notes about the launch and beeswax samples." : "A realistic project used for query measurement.",
          status: index === 19 ? "archived" : "active",
          createdAt: new Date(now - index * 864e5),
          updatedAt: new Date(now - index * 36e5)
        }))
      );
      const active = projects.filter((project) => project.status === "active");
      const tasks = await Task.insertMany(
        Array.from({ length: 1e3 }, (_, index) => {
          const due = index < 250 ? "2026-10-14" : index < 300 ? "2026-10-17" : index < 400 ? "2026-10-16" : index < 500 ? "2026-11-02" : null;
          return {
            userId,
            projectId: active[index % active.length]?._id,
            title: index % 17 === 0 ? `Cut the wick ${index}` : `Task ${String(index + 1).padStart(4, "0")}`,
            completed: index >= 700,
            dueDate: due,
            priority: ["low", "medium", "high", "urgent"][index % 4],
            labelIds: [],
            plannedFor: index < 80 ? "2026-10-15" : index < 120 ? "2026-10-16" : null,
            completedOn: index >= 700 ? "2026-10-16" : null,
            order: index,
            createdAt: new Date(now - index * 6e4),
            updatedAt: new Date(now - index * 3e4)
          };
        })
      );
      await Note.insertMany(
        Array.from({ length: 200 }, (_, index) => ({
          userId,
          projectId: active[index % active.length]?._id,
          title: index % 11 === 0 ? "Materials" : `Note ${index + 1}`,
          body: index % 11 === 0 ? "Use beeswax, not paraffin." : `Body for note ${index + 1} about the launch.`,
          createdAt: new Date(now - index * 12e4),
          updatedAt: new Date(now - index * 6e4)
        }))
      );
      await Activity.insertMany(
        Array.from({ length: 500 }, (_, index) => ({
          userId,
          projectId: active[index % active.length]?._id,
          type: ["create", "update", "complete"][index % 3],
          summary: `Activity ${index + 1}`,
          createdAt: new Date(now - index * 2e4)
        }))
      );
      await Notification.insertMany(
        tasks.slice(0, 300).map((task, index) => {
          const dueDate2 = task.dueDate ?? "2026-10-14";
          const kind = dueDate2 < "2026-10-16" ? "overdue" : "due-soon";
          return {
            userId,
            projectId: task.projectId,
            taskId: task._id,
            kind,
            title: task.title,
            projectName: "Launch checklist",
            dueDate: dueDate2,
            read: index % 4 === 0,
            key: `${task._id.toString()}:${kind}:${dueDate2}`,
            expireAt: new Date(now + 90 * 864e5),
            createdAt: new Date(now - index * 1e4)
          };
        })
      );
      res.status(201).json(await counts(userId));
    })
  );
  router.get(
    "/explain",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      await requireBench(userId);
      const project = await Project.findOne({ userId, status: "active" }).select("_id");
      if (!project) throw new HttpError(404, "Not found.");
      const projectId = project._id;
      const plans = await Promise.all([
        summarize("projects", Project.find({ userId, status: "active" }).sort({ updatedAt: -1 })),
        summarize("tasks", Task.find({ userId, projectId }).sort({ order: 1, createdAt: 1, _id: 1 })),
        summarize(
          "tasks-due",
          Task.find({
            userId,
            completed: false,
            $or: [
              { dueDate: { $gte: "0000-01-01", $lt: "2026-10-16" } },
              { dueDate: { $gt: "2026-10-16", $lte: "2026-10-17" } }
            ]
          }),
          1e3
        ),
        summarize("tasks-open", Task.find({ userId, completed: false })),
        summarize("tasks-planned", Task.find({ userId, plannedFor: "2026-10-16" })),
        summarize("notes", Note.find({ userId }).sort({ updatedAt: -1 })),
        summarize("notes-project", Note.find({ userId, projectId }).sort({ updatedAt: -1 })),
        summarize("activity", Activity.find({ projectId }).sort({ createdAt: -1, _id: -1 })),
        summarize("notifications", Notification.find({ userId, key: { $in: ["000000000000000000000000:overdue:2026-10-14"] } }))
      ]);
      let text2 = null;
      try {
        text2 = await summarize("tasks-text", Task.find({ userId, $text: { $search: "wick" } }));
      } catch (error) {
        text2 = { name: "tasks-text", error: error instanceof Error ? error.message : "text search failed" };
      }
      res.json({ plans: [...plans, text2] });
    })
  );
  return router;
}
async function counts(userId) {
  const [projects, tasks, notes, activity, notifications] = await Promise.all([
    Project.countDocuments({ userId }),
    Task.countDocuments({ userId }),
    Note.countDocuments({ userId }),
    Activity.countDocuments({ userId }),
    Notification.countDocuments({ userId })
  ]);
  return { projects, tasks, notes, activity, notifications };
}

// src/routes/dashboard.ts
import { Router as Router3 } from "express";
import { Types as Types2 } from "mongoose";
var OPEN_LIMIT = 40;
function dashboardRouter() {
  const router = Router3();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = new Types2.ObjectId(currentUserId(req));
      const [projects, counts2, dated, undated] = await Promise.all([
        Project.find({ userId, status: "active" }).select("name description").sort({ updatedAt: -1 }).lean(),
        Task.aggregate([
          { $match: { userId } },
          { $group: { _id: { projectId: "$projectId", completed: "$completed" }, n: { $sum: 1 } } }
        ]),
        Task.find({ userId, completed: false, dueDate: { $gte: "0000-01-01" } }).select("title dueDate priority projectId").sort({ dueDate: 1, title: 1 }).limit(OPEN_LIMIT).lean(),
        Task.find({ userId, completed: false, dueDate: null }).select("title dueDate priority projectId").sort({ title: 1 }).limit(OPEN_LIMIT).lean()
      ]);
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]));
      const tally = /* @__PURE__ */ new Map();
      for (const row of counts2) {
        const id = row._id.projectId.toString();
        const bucket = tally.get(id) ?? { total: 0, done: 0 };
        bucket.total += row.n;
        if (row._id.completed) bucket.done += row.n;
        tally.set(id, bucket);
      }
      let openTaskCount = 0;
      for (const [id, bucket] of tally) {
        if (!names.has(id)) continue;
        openTaskCount += bucket.total - bucket.done;
      }
      const open = [...dated, ...undated].slice(0, OPEN_LIMIT).flatMap((task) => {
        const projectName = names.get(task.projectId.toString());
        if (!projectName) return [];
        return [
          {
            id: task._id.toString(),
            projectId: task.projectId.toString(),
            projectName,
            title: task.title,
            dueDate: task.dueDate,
            priority: task.priority,
            completed: false
          }
        ];
      });
      res.json({
        projects: projects.map((project) => {
          const bucket = tally.get(project._id.toString()) ?? { total: 0, done: 0 };
          return {
            id: project._id.toString(),
            name: project.name,
            description: project.description,
            percentComplete: bucket.total === 0 ? 0 : Math.round(bucket.done / bucket.total * 100),
            completedCount: bucket.done,
            taskCount: bucket.total
          };
        }),
        openTasks: open,
        openTaskCount
      });
    })
  );
  return router;
}

// src/routes/labels.ts
import { Router as Router4 } from "express";

// src/activity.ts
function quoteTitle(title) {
  return `\u201C${title.replaceAll("\u201C", "").replaceAll("\u201D", "")}\u201D`;
}
async function recordActivity(input) {
  await Activity.create({
    userId: input.userId,
    projectId: input.projectId ?? null,
    type: input.type,
    summary: input.summary.slice(0, 240)
  });
}

// src/scope.ts
import { Types as Types3 } from "mongoose";
function objectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return new Types3.ObjectId(id);
}
async function requireProject(userId, id) {
  const projectId = objectId(id);
  if (!projectId) throw new HttpError(404, "Project not found.");
  const project = await Project.findOne({ _id: projectId, userId });
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}
async function requireTask(userId, id) {
  const taskId = objectId(id);
  if (!taskId) throw new HttpError(404, "Task not found.");
  const task = await Task.findOne({ _id: taskId, userId });
  if (!task) throw new HttpError(404, "Task not found.");
  return task;
}
async function requireNote(userId, id) {
  const noteId = objectId(id);
  if (!noteId) throw new HttpError(404, "Note not found.");
  const note = await Note.findOne({ _id: noteId, userId });
  if (!note) throw new HttpError(404, "Note not found.");
  return note;
}
async function ownedLabelIds(userId, ids) {
  const unique = [...new Set(ids)];
  const objectIds = unique.map(objectId);
  if (objectIds.some((id) => !id)) throw new HttpError(400, "Unknown label.");
  const found = await Label.find({ userId, _id: { $in: objectIds } }).select("_id");
  if (found.length !== objectIds.length) throw new HttpError(400, "Unknown label.");
  return objectIds.filter((id) => id !== null);
}
async function touchProject(projectId, userId) {
  await Project.updateOne({ _id: projectId, userId }, { $currentDate: { updatedAt: true } });
}

// src/routes/labels.ts
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function labelsRouter() {
  const router = Router4();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const labels = await Label.find({ userId: currentUserId(req) }).select("name color createdAt").sort({ name: 1 }).lean();
      res.json(labels.map(publicLabel));
    })
  );
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const input = parseBody(labelCreateSchema, req.body);
      const duplicate = await Label.findOne({
        userId,
        name: new RegExp(`^${escapeRegExp(input.name)}$`, "i")
      });
      if (duplicate) throw new HttpError(409, "A label with that name already exists.");
      const label = await Label.create({
        userId,
        name: input.name,
        color: input.color.toLowerCase()
      });
      await recordActivity({
        userId,
        type: "create",
        summary: `Created label ${quoteTitle(label.name)}`
      });
      res.status(201).json(publicLabel(label));
    })
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const labelId = objectId(req.params.id);
      if (!labelId) throw new HttpError(404, "Label not found.");
      const label = await Label.findOne({ _id: labelId, userId });
      if (!label) throw new HttpError(404, "Label not found.");
      const input = parseBody(labelPatchSchema, req.body);
      if (input.name !== void 0 && input.name.toLowerCase() !== label.name.toLowerCase()) {
        const duplicate = await Label.findOne({
          userId,
          name: new RegExp(`^${escapeRegExp(input.name)}$`, "i")
        });
        if (duplicate) throw new HttpError(409, "A label with that name already exists.");
        label.name = input.name;
      }
      if (input.color !== void 0) label.color = input.color.toLowerCase();
      await label.save();
      await recordActivity({
        userId,
        type: "update",
        summary: `Updated label ${quoteTitle(label.name)}`
      });
      res.json(publicLabel(label));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const labelId = objectId(req.params.id);
      if (!labelId) throw new HttpError(404, "Label not found.");
      const label = await Label.findOne({ _id: labelId, userId });
      if (!label) throw new HttpError(404, "Label not found.");
      await Task.updateMany({ userId, labelIds: label._id }, { $pull: { labelIds: label._id } });
      const name = label.name;
      await label.deleteOne();
      await recordActivity({
        userId,
        type: "delete",
        summary: `Deleted label ${quoteTitle(name)}`
      });
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/notes.ts
import { Router as Router5 } from "express";
function notesRouter() {
  const router = Router5();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const notes = await Note.find({ userId: currentUserId(req) }).select("projectId title body createdAt updatedAt").sort({ updatedAt: -1 }).lean();
      res.json(notes.map(publicNote));
    })
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const note = await requireNote(currentUserId(req), req.params.id);
      res.json(publicNote(note));
    })
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const note = await requireNote(userId, req.params.id);
      const input = parseBody(notePatchSchema, req.body);
      if (input.title !== void 0) note.title = input.title;
      if (input.body !== void 0) note.body = input.body;
      await note.save();
      await touchProject(note.projectId, userId);
      await recordActivity({
        userId,
        projectId: note.projectId,
        type: "update",
        summary: `Updated note ${quoteTitle(note.title)}`
      });
      res.json(publicNote(note));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const note = await requireNote(userId, req.params.id);
      const projectId = note.projectId;
      const title = note.title;
      await note.deleteOne();
      await touchProject(projectId, userId);
      await recordActivity({
        userId,
        projectId,
        type: "delete",
        summary: `Deleted note ${quoteTitle(title)}`
      });
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/notifications.ts
import { Router as Router6 } from "express";
import { Types as Types5 } from "mongoose";

// src/dates.ts
function shiftISODate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// src/page.ts
import { Types as Types4 } from "mongoose";
var PAGE_SIZE = 50;
function pageLimit(value, fallback = PAGE_SIZE) {
  const parsed = typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}
function encodeCursor(parts) {
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}
function decodeCursor(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const text2 = Buffer.from(value, "base64url").toString("utf8");
    const parts = text2.split("|");
    return parts.length > 0 && parts.every((part) => part.length > 0) ? parts : null;
  } catch {
    return null;
  }
}
function objectIdFromCursor(value) {
  if (!/^[a-f\d]{24}$/i.test(value)) return null;
  return new Types4.ObjectId(value);
}
function beforeCursor(value) {
  const parts = decodeCursor(value);
  if (!parts || parts.length !== 2) return null;
  const createdAt = new Date(parts[0] ?? "");
  const id = objectIdFromCursor(parts[1] ?? "");
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}
function beforeFilter(cursor) {
  return {
    $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }]
  };
}
function nextDateCursor(items, limit) {
  if (items.length <= limit) return null;
  const last = items[limit - 1];
  if (!last) return null;
  return encodeCursor([last.createdAt.toISOString(), last._id.toString()]);
}
function afterTaskCursor(value) {
  const parts = decodeCursor(value);
  if (!parts || parts.length !== 3) return null;
  const order = Number(parts[0]);
  const createdAt = new Date(parts[1] ?? "");
  const id = objectIdFromCursor(parts[2] ?? "");
  if (!Number.isInteger(order) || Number.isNaN(createdAt.getTime()) || !id) return null;
  return { order, createdAt, id };
}
function afterTaskFilter(cursor) {
  return {
    $or: [
      { order: { $gt: cursor.order } },
      { order: cursor.order, createdAt: { $gt: cursor.createdAt } },
      { order: cursor.order, createdAt: cursor.createdAt, _id: { $gt: cursor.id } }
    ]
  };
}
function nextTaskCursor(items, limit) {
  if (items.length <= limit) return null;
  const last = items[limit - 1];
  if (!last) return null;
  return encodeCursor([String(last.order), last.createdAt.toISOString(), last._id.toString()]);
}

// src/routes/notifications.ts
var NINETY_DAYS_MS2 = 90 * 24 * 60 * 60 * 1e3;
var KEY = /^([a-f\d]{24}):(overdue|due-soon):(\d{4}-\d{2}-\d{2})$/i;
function requireToday(value) {
  const today = typeof value === "string" ? normalizeDueDate(value) : null;
  if (!today) throw new HttpError(400, "Use a valid date.");
  return today;
}
async function dueRows(userId, today) {
  const tomorrow = shiftISODate(today, 1);
  const tasks = await Task.find({
    userId,
    completed: false,
    $or: [{ dueDate: { $gte: "0000-01-01", $lt: today } }, { dueDate: { $gt: today, $lte: tomorrow } }]
  }).select("title dueDate projectId").lean();
  const projectIds = [...new Set(tasks.map((task) => task.projectId.toString()))];
  const keys = tasks.flatMap((task) => {
    if (!task.dueDate || task.dueDate === today) return [];
    const kind = task.dueDate < today ? "overdue" : "due-soon";
    return [`${task._id.toString()}:${kind}:${task.dueDate}`];
  });
  const [projects, stored] = await Promise.all([
    projectIds.length === 0 ? Promise.resolve([]) : Project.find({ userId, _id: { $in: projectIds } }).select("name").lean(),
    keys.length === 0 ? Promise.resolve([]) : Notification.find({ userId, key: { $in: keys } }).select("key read createdAt").lean()
  ]);
  const names = new Map(projects.map((project) => [project._id.toString(), project.name]));
  const flags = new Map(stored.map((item) => [item.key, item]));
  return tasks.flatMap((task) => {
    if (!task.dueDate || task.dueDate === today || task.dueDate > tomorrow) return [];
    const projectName = names.get(task.projectId.toString());
    if (!projectName) return [];
    const kind = task.dueDate < today ? "overdue" : "due-soon";
    const key = `${task._id.toString()}:${kind}:${task.dueDate}`;
    const saved = flags.get(key);
    return [
      {
        key,
        taskId: task._id,
        projectId: task.projectId,
        kind,
        title: task.title,
        projectName,
        dueDate: task.dueDate,
        read: saved?.read ?? false,
        createdAt: saved?.createdAt.toISOString() ?? `${task.dueDate}T00:00:00.000Z`
      }
    ];
  });
}
function present(row) {
  return {
    id: row.key,
    projectId: row.projectId.toString(),
    taskId: row.taskId.toString(),
    kind: row.kind,
    title: row.title,
    projectName: row.projectName,
    dueDate: row.dueDate,
    read: row.read,
    createdAt: row.createdAt
  };
}
function notificationsRouter() {
  const router = Router6();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const today = requireToday(req.query.today);
      const rows = await dueRows(currentUserId(req), today);
      rows.sort((a, b) => a.createdAt === b.createdAt ? a.key < b.key ? 1 : -1 : a.createdAt < b.createdAt ? 1 : -1);
      const cursor = decodeCursor(req.query.cursor);
      const filtered = cursor && cursor.length === 2 ? rows.filter((row) => row.createdAt < cursor[0] || row.createdAt === cursor[0] && row.key < cursor[1]) : rows;
      const limit = pageLimit(req.query.limit);
      const page = filtered.slice(0, limit);
      const last = page[limit - 1];
      if (filtered.length > limit && last) res.set("X-Next-Cursor", encodeCursor([last.createdAt, last.key]));
      res.json(page.map(present));
    })
  );
  router.post(
    "/read-all",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const today = typeof req.query.today === "string" && req.query.today ? requireToday(req.query.today) : null;
      if (today) {
        const rows = await dueRows(userId, today);
        const userObjectId = new Types5.ObjectId(userId);
        const expireAt = new Date(Date.now() + NINETY_DAYS_MS2);
        if (rows.length > 0) {
          await Notification.bulkWrite(
            rows.map((row) => ({
              updateOne: {
                filter: { userId: userObjectId, key: row.key },
                update: {
                  $set: { read: true, title: row.title, projectName: row.projectName },
                  $setOnInsert: {
                    userId: userObjectId,
                    projectId: row.projectId,
                    taskId: row.taskId,
                    kind: row.kind,
                    dueDate: row.dueDate,
                    key: row.key,
                    expireAt
                  }
                },
                upsert: true
              }
            }))
          );
        }
      }
      await Notification.updateMany({ userId, read: false }, { read: true });
      res.status(204).send();
    })
  );
  router.post(
    "/:id/read",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const id = objectId(req.params.id);
      if (id) {
        const item2 = await Notification.findOneAndUpdate({ _id: id, userId }, { read: true }, { new: true });
        if (!item2) throw new HttpError(404, "Notification not found.");
        res.json(publicNotification(item2));
        return;
      }
      const match = KEY.exec(req.params.id);
      if (!match) throw new HttpError(404, "Notification not found.");
      const taskId = match[1] ?? "";
      const kind = match[2];
      const dueDate2 = match[3] ?? "";
      const task = await Task.findOne({ _id: taskId, userId, completed: false, dueDate: dueDate2 }).select("title projectId dueDate");
      if (!task?.dueDate) throw new HttpError(404, "Notification not found.");
      const project = await Project.findOne({ _id: task.projectId, userId }).select("name");
      if (!project) throw new HttpError(404, "Notification not found.");
      const item = await Notification.findOneAndUpdate(
        { userId, key: req.params.id },
        {
          $set: { read: true, title: task.title, projectName: project.name },
          $setOnInsert: {
            userId,
            projectId: task.projectId,
            taskId: task._id,
            kind,
            dueDate: dueDate2,
            key: req.params.id,
            expireAt: new Date(Date.now() + NINETY_DAYS_MS2)
          }
        },
        { new: true, upsert: true }
      );
      if (!item) throw new HttpError(404, "Notification not found.");
      res.json({ ...publicNotification(item), id: req.params.id });
    })
  );
  return router;
}

// src/routes/projects.ts
import { Router as Router7 } from "express";
function isDuplicateKey(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11e3;
}
function projectsRouter() {
  const router = Router7();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const status = req.query.status;
      const filter = { userId: currentUserId(req) };
      if (status !== void 0) {
        if (status !== "active" && status !== "archived") {
          res.status(400).json({ error: "Status must be active or archived." });
          return;
        }
        filter.status = status;
      }
      const projects = await Project.find(filter).select("name description status createdAt updatedAt").sort({ updatedAt: -1 }).lean();
      res.json(projects.map(publicProject));
    })
  );
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = parseBody(projectCreateSchema, req.body);
      const userId = currentUserId(req);
      const project = await Project.create({
        userId,
        name: input.name,
        description: input.description ?? "",
        status: "active"
      });
      await recordActivity({
        userId,
        projectId: project._id,
        type: "create",
        summary: `Created project ${quoteTitle(project.name)}`
      });
      res.status(201).json(publicProject(project));
    })
  );
  router.get(
    "/:id/tasks",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const limit = pageLimit(req.query.limit);
      const cursor = afterTaskCursor(req.query.cursor);
      const base = { userId, projectId: project._id };
      const tasks = await Task.find(cursor ? { $and: [base, afterTaskFilter(cursor)] } : base).select("projectId title completed dueDate priority labelIds plannedFor completedOn order createdAt updatedAt").sort({ order: 1, createdAt: 1, _id: 1 }).limit(limit + 1).lean();
      const next = nextTaskCursor(tasks, limit);
      if (next) res.set("X-Next-Cursor", next);
      res.json(tasks.slice(0, limit).map(publicTask));
    })
  );
  router.post(
    "/:id/tasks",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const input = parseBody(taskCreateSchema, req.body);
      if (input.clientId) {
        const existing = await Task.findOne({ userId, clientId: input.clientId });
        if (existing) {
          res.json(publicTask(existing));
          return;
        }
      }
      const project = await requireProject(userId, req.params.id);
      const dueDate2 = normalizeDueDate(input.dueDate) ?? null;
      const labelIds2 = await ownedLabelIds(userId, input.labelIds ?? []);
      const latest = await Task.findOne({ projectId: project._id }).sort({ order: -1 }).select("order");
      try {
        const task = await Task.create({
          userId,
          projectId: project._id,
          title: input.title,
          completed: false,
          dueDate: dueDate2,
          priority: input.priority ?? "medium",
          labelIds: labelIds2,
          plannedFor: normalizeDueDate(input.plannedFor) ?? null,
          order: (latest?.order ?? 0) + 1,
          ...input.clientId ? { clientId: input.clientId } : {}
        });
        await touchProject(project._id, userId);
        await recordActivity({
          userId,
          projectId: project._id,
          type: "create",
          summary: `Created task ${quoteTitle(task.title)}`
        });
        res.status(201).json(publicTask(task));
      } catch (error) {
        if (input.clientId && isDuplicateKey(error)) {
          const existing = await Task.findOne({ userId, clientId: input.clientId });
          if (existing) {
            res.json(publicTask(existing));
            return;
          }
        }
        throw error;
      }
    })
  );
  router.get(
    "/:id/notes",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const notes = await Note.find({ userId, projectId: project._id }).select("projectId title body createdAt updatedAt").sort({ updatedAt: -1 }).lean();
      res.json(notes.map(publicNote));
    })
  );
  router.post(
    "/:id/notes",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const input = parseBody(noteCreateSchema, req.body);
      const note = await Note.create({
        userId,
        projectId: project._id,
        title: input.title ? input.title : "Untitled",
        body: input.body ?? ""
      });
      await touchProject(project._id, userId);
      await recordActivity({
        userId,
        projectId: project._id,
        type: "create",
        summary: `Created note ${quoteTitle(note.title)}`
      });
      res.status(201).json(publicNote(note));
    })
  );
  router.get(
    "/:id/whiteboard",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const board = await Whiteboard.findOne({ userId, projectId: project._id }).select("scene").lean();
      res.json({ scene: board?.scene ?? emptyScene });
    })
  );
  router.put(
    "/:id/whiteboard",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const scene = parseBody(whiteboardSceneSchema, req.body?.scene ?? req.body);
      const board = await Whiteboard.findOneAndUpdate(
        { userId, projectId: project._id },
        { userId, projectId: project._id, scene },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      res.json({ scene: board?.scene ?? scene });
    })
  );
  router.get(
    "/:id/activity",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const limit = pageLimit(req.query.limit);
      const cursor = beforeCursor(req.query.cursor);
      const scope = { userId, $or: [{ projectId: project._id }, { projectId: null }] };
      const items = await Activity.find(cursor ? { $and: [scope, beforeFilter(cursor)] } : scope).select("projectId type summary createdAt").sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
      const next = nextDateCursor(items, limit);
      if (next) res.set("X-Next-Cursor", next);
      res.json(items.slice(0, limit).map(publicActivity));
    })
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id);
      res.json(publicProject(project));
    })
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id);
      const input = parseBody(projectPatchSchema, req.body);
      if (input.name !== void 0) project.name = input.name;
      if (input.description !== void 0) project.description = input.description;
      await project.save();
      await recordActivity({
        userId: currentUserId(req),
        projectId: project._id,
        type: "update",
        summary: `Updated project ${quoteTitle(project.name)}`
      });
      res.json(publicProject(project));
    })
  );
  router.patch(
    "/:id/archive",
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id);
      project.status = project.status === "active" ? "archived" : "active";
      await project.save();
      await recordActivity({
        userId: currentUserId(req),
        projectId: project._id,
        type: "update",
        summary: project.status === "archived" ? `Archived project ${quoteTitle(project.name)}` : `Restored project ${quoteTitle(project.name)}`
      });
      res.json(publicProject(project));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const taskIds = await Task.find({ userId, projectId: project._id }).distinct("_id");
      await Notification.deleteMany({ userId, taskId: { $in: taskIds } });
      await Activity.deleteMany({ userId, projectId: project._id });
      await Whiteboard.deleteMany({ userId, projectId: project._id });
      await Task.deleteMany({ userId, projectId: project._id });
      await Note.deleteMany({ userId, projectId: project._id });
      await project.deleteOne();
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/search.ts
import { Router as Router8 } from "express";
var RESULT_LIMIT = 20;
var TIME_MS = 800;
function queryText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 200);
}
function textSearch(value) {
  const cleaned = value.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}
var score = { score: { $meta: "textScore" } };
var projectFields = { name: 1, description: 1, status: 1, createdAt: 1, updatedAt: 1, ...score };
var taskFields = { projectId: 1, title: 1, completed: 1, ...score };
var noteFields = { projectId: 1, title: 1, body: 1, ...score };
function searchRouter() {
  const router = Router8();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const text2 = textSearch(queryText(req.query.q));
      if (!text2) {
        res.json({ projects: [], tasks: [], notes: [] });
        return;
      }
      const userId = currentUserId(req);
      const search = { $search: text2 };
      const [projects, tasks, notes] = await Promise.all([
        Project.find({ userId, $text: search }).select(projectFields).sort({ score: { $meta: "textScore" } }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean(),
        Task.find({ userId, $text: search }).select(taskFields).sort({ score: { $meta: "textScore" } }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean(),
        Note.find({ userId, $text: search }).select(noteFields).sort({ score: { $meta: "textScore" } }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
      ]);
      const projectIds = [...new Set([...tasks, ...notes].map((item) => item.projectId.toString()))];
      const named = projectIds.length === 0 ? [] : await Project.find({ userId, _id: { $in: projectIds } }).select("name").maxTimeMS(TIME_MS).lean();
      const names = new Map(named.map((project) => [project._id.toString(), project.name]));
      res.json({
        projects: projects.map(publicProject),
        tasks: tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString());
          if (!projectName) return [];
          return [
            {
              id: task._id.toString(),
              projectId: task.projectId.toString(),
              projectName,
              title: task.title,
              completed: task.completed
            }
          ];
        }),
        notes: notes.flatMap((note) => {
          const projectName = names.get(note.projectId.toString());
          if (!projectName) return [];
          return [
            {
              id: note._id.toString(),
              projectId: note.projectId.toString(),
              projectName,
              title: note.title,
              body: note.body
            }
          ];
        })
      });
    })
  );
  return router;
}

// src/routes/tasks.ts
import { Router as Router9 } from "express";
function tasksRouter() {
  const router = Router9();
  router.use(requireAuth);
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const task = await requireTask(userId, req.params.id);
      const input = parseBody(taskPatchSchema, req.body);
      const wasCompleted = task.completed;
      const planningOnly = input.plannedFor !== void 0 && input.title === void 0 && input.completed === void 0 && input.dueDate === void 0 && input.priority === void 0 && input.labelIds === void 0 && input.order === void 0 && input.completedOn === void 0;
      if (input.title !== void 0) task.title = input.title;
      if (input.completed !== void 0) {
        task.completed = input.completed;
        if (input.completed) {
          task.completedOn = normalizeDueDate(input.completedOn) ?? task.completedOn ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        } else {
          task.completedOn = null;
        }
      }
      if (input.dueDate !== void 0) task.dueDate = normalizeDueDate(input.dueDate) ?? null;
      if (input.priority !== void 0) task.priority = input.priority;
      if (input.labelIds !== void 0) task.labelIds = await ownedLabelIds(userId, input.labelIds);
      if (input.plannedFor !== void 0) task.plannedFor = normalizeDueDate(input.plannedFor) ?? null;
      if (input.order !== void 0) task.order = input.order;
      await task.save();
      await touchProject(task.projectId, userId);
      const finished = !wasCompleted && task.completed;
      if (!planningOnly) await recordActivity({
        userId,
        projectId: task.projectId,
        type: finished ? "complete" : "update",
        summary: finished ? `Completed task ${quoteTitle(task.title)}` : `Updated task ${quoteTitle(task.title)}`
      });
      if (task.completed) await Notification.deleteMany({ userId, taskId: task._id, kind: "overdue" });
      res.json(publicTask(task));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const task = await requireTask(userId, req.params.id);
      const projectId = task.projectId;
      const title = task.title;
      await Notification.deleteMany({ userId, taskId: task._id });
      await task.deleteOne();
      await touchProject(projectId, userId);
      await recordActivity({
        userId,
        projectId,
        type: "delete",
        summary: `Deleted task ${quoteTitle(title)}`
      });
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/today.ts
import { Router as Router10 } from "express";
var FIELDS = "projectId title completed dueDate priority labelIds plannedFor completedOn order createdAt updatedAt";
function present2(task, projectName) {
  return {
    id: task._id.toString(),
    projectId: task.projectId.toString(),
    projectName,
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    plannedFor: task.plannedFor,
    completedOn: task.completedOn,
    order: task.order,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}
function todayRouter() {
  const router = Router10();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const date = typeof req.query.date === "string" ? normalizeDueDate(req.query.date) : null;
      if (!date) throw new HttpError(400, "Use a valid date.");
      const userId = currentUserId(req);
      const [open, plannedDone, finishedOn, projects] = await Promise.all([
        Task.find({ userId, completed: false }).select(FIELDS).lean(),
        Task.find({ userId, completed: true, plannedFor: date }).select(FIELDS).lean(),
        Task.find({ userId, completed: true, completedOn: date }).select(FIELDS).lean(),
        Project.find({ userId, status: "active" }).select("name").lean()
      ]);
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]));
      const merged = /* @__PURE__ */ new Map();
      for (const task of [...open, ...plannedDone, ...finishedOn]) merged.set(task._id.toString(), task);
      const visible = [...merged.values()].filter((task) => names.has(task.projectId.toString())).sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime());
      const show = (task) => present2(task, names.get(task.projectId.toString()) ?? "");
      const plannedForDate = visible.filter((task) => task.plannedFor === date);
      const dueToday = visible.filter((task) => !task.completed && task.dueDate === date && task.plannedFor !== date);
      const planned = [...plannedForDate, ...dueToday];
      const overdue = visible.filter(
        (task) => !task.completed && Boolean(task.dueDate) && (task.dueDate ?? "") < date && task.plannedFor !== date
      );
      const overdueIds = new Set(overdue.map((task) => task._id.toString()));
      const carried = visible.filter(
        (task) => !task.completed && task.plannedFor != null && task.plannedFor < date && !overdueIds.has(task._id.toString()) && task.dueDate !== date && !(task.dueDate && task.dueDate > date)
      );
      const taken = new Set([...planned, ...overdue, ...carried].map((task) => task._id.toString()));
      const available = visible.filter((task) => !task.completed && !taken.has(task._id.toString()));
      const finished = visible.filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date);
      res.json({
        date,
        planned: planned.map(show),
        carried: carried.map(show),
        overdue: overdue.map(show),
        available: available.map(show),
        finished: finished.map(show)
      });
    })
  );
  return router;
}

// src/app.ts
function createApp(options = {}) {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.set("trust proxy", 1);
  app2.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app2.use(compression());
  app2.use(privateRevalidate());
  app2.use(express.json({ limit: "1mb" }));
  app2.use(guardOrigin);
  app2.use((_req, res, next) => {
    res.setHeader("X-Align-Minimum", String(MINIMUM_CLIENT_VERSION));
    next();
  });
  app2.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: APP_VERSION, minimum: MINIMUM_CLIENT_VERSION });
  });
  app2.get("/api/health", (_req, res) => {
    const started = Date.now();
    connectDb().then(async () => {
      const db = mongoose3.connection.db;
      if (!db) throw new Error("Database is not connected.");
      await db.command({ ping: 1 });
    }).then(() => {
      const body = { ok: true, db: "up", latencyMs: Date.now() - started };
      res.json(body);
    }).catch(() => {
      const body = { ok: false, db: "down", latencyMs: Date.now() - started };
      res.status(503).json(body);
    });
  });
  app2.use((req, _res, next) => {
    const logout = req.method === "POST" && req.path === "/api/auth/logout";
    connectDb().then(
      () => next(),
      (error) => {
        if (logout) next();
        else next(error);
      }
    );
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: options.authRateLimitMax ?? 1e3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again later." }
  });
  app2.use("/api/auth", authRouter(authLimiter));
  app2.use("/api/bench", benchRouter());
  app2.use("/api/labels", labelsRouter());
  app2.use("/api/projects", projectsRouter());
  app2.use("/api/tasks", tasksRouter());
  app2.use("/api/notes", notesRouter());
  app2.use("/api/notifications", notificationsRouter());
  app2.use("/api/dashboard", dashboardRouter());
  app2.use("/api/today", todayRouter());
  app2.use("/api/search", searchRouter());
  app2.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });
  app2.use(errorHandler);
  return app2;
}

// src/requestPath.ts
var ORIGINAL_PATH_HEADERS = [
  "x-vercel-original-path",
  "x-forwarded-uri",
  "x-invoke-path",
  "x-original-url"
];
function pathOnly(value) {
  const query = value.indexOf("?");
  return query === -1 ? value : value.slice(0, query);
}
function originalApiUrl(header) {
  for (const name of ORIGINAL_PATH_HEADERS) {
    const value = header(name)?.trim();
    if (!value) continue;
    let candidate = value;
    if (value.startsWith("http://") || value.startsWith("https://")) {
      const url = new URL(value);
      candidate = `${url.pathname}${url.search}`;
    }
    const path = pathOnly(candidate);
    if (path === "/api" || path.startsWith("/api/")) return candidate;
  }
  return void 0;
}
function resolveRequestUrl(url, header) {
  const raw = url && url.length > 0 ? url : "/";
  const path = pathOnly(raw);
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  if (path === "/api" || path.startsWith("/api/")) {
    const original2 = originalApiUrl(header);
    if ((path === "/api" || path === "/api/") && original2 && pathOnly(original2).startsWith("/api/")) {
      return original2.includes("?") || search.length === 0 ? original2 : `${original2}${search}`;
    }
    return raw;
  }
  const original = originalApiUrl(header);
  if (original) return original.includes("?") || search.length === 0 ? original : `${original}${search}`;
  if (path === "/") return `/api${search}`;
  return `/api${path.startsWith("/") ? path : `/${path}`}${search}`;
}

// src/vercel.ts
var app = createApp();
void connectDb({ indexes: true }).catch((error) => {
  console.error(error);
});
function handler(req, res) {
  req.url = resolveRequestUrl(req.url, (name) => {
    const value = req.headers[name];
    if (Array.isArray(value)) return value[0];
    return value;
  });
  app(req, res);
}
export {
  handler as default
};
