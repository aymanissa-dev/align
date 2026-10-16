// src/app.ts
import express from "express";
import rateLimit from "express-rate-limit";

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
    resetTokenExpires: { type: Date, select: false }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
var projectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["active", "archived"], default: "active", required: true }
  },
  { timestamps: true }
);
projectSchema.index({ userId: 1, status: 1 });
projectSchema.index({ userId: 1, name: 1 });
projectSchema.index(
  { name: "text", description: "text" },
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
labelSchema.index({ userId: 1 });
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
taskSchema.index({ userId: 1, projectId: 1 });
taskSchema.index({ userId: 1, projectId: 1, completed: 1, dueDate: 1 });
taskSchema.index({ userId: 1, plannedFor: 1 });
taskSchema.index({ userId: 1, completedOn: 1 });
taskSchema.index({ userId: 1, projectId: 1, order: 1, createdAt: 1, _id: 1 });
taskSchema.index({ userId: 1, dueDate: 1 });
taskSchema.index({ userId: 1, title: 1 });
taskSchema.index({ title: "text" }, { name: "TaskTextIndex" });
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
noteSchema.index({ userId: 1, title: 1 });
noteSchema.index(
  { title: "text", body: "text" },
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
activitySchema.index({ userId: 1, projectId: 1 });
activitySchema.index({ userId: 1, createdAt: -1 });
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
notificationSchema.index({ userId: 1, createdAt: -1 });
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
slowQueries(userSchema, "User");
slowQueries(projectSchema, "Project");
slowQueries(labelSchema, "Label");
slowQueries(taskSchema, "Task");
slowQueries(noteSchema, "Note");
slowQueries(activitySchema, "Activity");
slowQueries(notificationSchema, "Notification");
slowQueries(whiteboardSchema, "Whiteboard");
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

// src/db.ts
var globalCache = globalThis;
function cache() {
  globalCache.__alignMongoose ??= { conn: null, promise: null };
  return globalCache.__alignMongoose;
}
var indexesReady = null;
function ensureIndexes() {
  indexesReady ??= Promise.all([
    User.syncIndexes(),
    Project.syncIndexes(),
    Label.syncIndexes(),
    Task.syncIndexes(),
    Note.syncIndexes(),
    Activity.syncIndexes(),
    Notification.syncIndexes(),
    Whiteboard.syncIndexes()
  ]).then(() => void 0).catch((error) => {
    indexesReady = null;
    throw error;
  });
  return indexesReady;
}
function databaseFailure(error) {
  console.error(error);
  return new HttpError(500, "Database connection failed.");
}
async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri === "memory") {
    throw new HttpError(500, "Database is not configured.");
  }
  const state = cache();
  if (state.conn) {
    try {
      await ensureIndexes();
    } catch (error) {
      throw error instanceof HttpError ? error : databaseFailure(error);
    }
    return state.conn;
  }
  if (!state.promise) {
    mongoose2.set("bufferCommands", false);
    state.promise = mongoose2.connect(uri, {
      serverSelectionTimeoutMS: 5e3,
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 1e4,
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
    await ensureIndexes();
  } catch (error) {
    state.conn = null;
    state.promise = null;
    throw error instanceof HttpError ? error : databaseFailure(error);
  }
  return state.conn;
}

// src/middleware.ts
import { ZodError } from "zod";

// src/session.ts
import jwt from "jsonwebtoken";
var COOKIE = "token";
var WEEK_MS = 7 * 24 * 60 * 60 * 1e3;
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
function readCookie(header, name = COOKIE) {
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
function setSession(res, userId) {
  const token = jwt.sign({ sub: userId }, secret(), { expiresIn: "7d" });
  res.cookie(COOKIE, token, { ...cookieBase(), maxAge: WEEK_MS });
}
function clearSession(res) {
  res.clearCookie(COOKIE, cookieBase());
}
function userIdFromRequest(req) {
  const token = readCookie(req.headers.cookie);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === "string" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// src/middleware.ts
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
var requireAuth = (req, _res, next) => {
  const userId = userIdFromRequest(req);
  if (!userId) {
    next(new HttpError(401, "Sign in to continue."));
    return;
  }
  User.findById(userId).then((user) => {
    if (!user) {
      next(new HttpError(401, "Sign in to continue."));
      return;
    }
    req.userId = user.id;
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
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }
  if (isRecord(error) && error.name === "CastError") {
    res.status(404).json({ error: "Not found." });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Something went wrong. Try again." });
};

// src/routes/auth.ts
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";

// src/password.ts
import bcrypt from "bcryptjs";
function bcryptRounds() {
  const configured = process.env.BCRYPT_ROUNDS;
  if (configured && /^\d+$/.test(configured)) return Number(configured);
  return process.env.NODE_ENV === "test" ? 4 : 10;
}
function hashPassword(password2) {
  return bcrypt.hash(password2, bcryptRounds());
}
function checkPassword(password2, hash) {
  return bcrypt.compare(password2, hash);
}
var dummyHash = null;
function dummyPasswordHash() {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash;
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

// src/validate.ts
import { z } from "zod";
function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid input.");
  }
  return result.data;
}
function text(label, max) {
  return z.string({ required_error: `${label} is required.`, invalid_type_error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
}
function password(label = "Password") {
  return z.string({
    required_error: `${label} must be at least 8 characters.`,
    invalid_type_error: `${label} must be at least 8 characters.`
  }).min(8, `${label} must be at least 8 characters.`).max(128, `${label} is too long.`);
}
var email = z.string({ required_error: "Enter a valid email.", invalid_type_error: "Enter a valid email." }).trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email.").max(254, "Enter a valid email.");
var description = z.string({ invalid_type_error: "Description must be text." }).trim().max(2e3, "Description is too long.");
var dueDate = z.union([
  z.string({ invalid_type_error: "Use a valid due date." }),
  z.null()
]);
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
function hashResetToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function authRouter(limiter) {
  const router = Router();
  router.post(
    "/register",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(registerSchema, req.body);
      const existing = await User.findOne({ email: input.email });
      if (existing) throw new HttpError(409, "An account with this email already exists.");
      const user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password)
      });
      setSession(res, user.id);
      res.status(201).json(publicUser(user));
    })
  );
  router.post(
    "/login",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body);
      const user = await User.findOne({ email: input.email }).select("+passwordHash");
      const hash = user?.passwordHash ?? await dummyPasswordHash();
      const matches = await checkPassword(input.password, hash);
      if (!user || !matches) throw new HttpError(401, "Email or password is incorrect.");
      setSession(res, user.id);
      res.json(publicUser(user));
    })
  );
  router.get(
    "/session",
    asyncHandler(async (req, res) => {
      const userId = userIdFromRequest(req);
      if (!userId) {
        res.json({ user: null });
        return;
      }
      const user = await User.findById(userId);
      res.json({ user: user ? publicUser(user) : null });
    })
  );
  router.post(
    "/forgot",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(forgotSchema, req.body);
      const user = await User.findOne({ email: input.email }).select("+resetTokenHash +resetTokenExpires");
      const body = {
        message: "If an account exists for that email, a reset link is ready."
      };
      if (user) {
        const resetToken = randomBytes(32).toString("hex");
        user.resetTokenHash = hashResetToken(resetToken);
        user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1e3);
        await user.save();
        if (!process.env.SMTP_HOST) body.resetToken = resetToken;
      }
      res.json(body);
    })
  );
  router.post(
    "/reset",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(resetSchema, req.body);
      const user = await User.findOne({
        resetTokenHash: hashResetToken(input.token),
        resetTokenExpires: { $gt: /* @__PURE__ */ new Date() }
      }).select("+passwordHash +resetTokenHash +resetTokenExpires");
      if (!user) throw new HttpError(400, "This reset link is invalid or has expired.");
      user.passwordHash = await hashPassword(input.password);
      user.set("resetTokenHash", void 0);
      user.set("resetTokenExpires", void 0);
      await user.save();
      setSession(res, user.id);
      res.json(publicUser(user));
    })
  );
  router.post(
    "/logout",
    asyncHandler(async (_req, res) => {
      clearSession(res);
      res.status(204).send();
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
      if (!user) throw new HttpError(401, "Sign in to continue.");
      const matches = await checkPassword(input.currentPassword, user.passwordHash);
      if (!matches) throw new HttpError(400, "Current password is incorrect.");
      user.passwordHash = await hashPassword(input.newPassword);
      await user.save();
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
      await User.deleteOne({ _id: userId });
      clearSession(res);
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/dashboard.ts
import { Router as Router2 } from "express";
import { Types } from "mongoose";
function dashboardRouter() {
  const router = Router2();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = new Types.ObjectId(currentUserId(req));
      const rows = await Project.aggregate([
        { $match: { userId, status: "active" } },
        { $sort: { updatedAt: -1 } },
        {
          $lookup: {
            from: "tasks",
            let: { projectId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$projectId", "$$projectId"] }, { $eq: ["$userId", userId] }]
                  }
                }
              },
              { $project: { title: 1, dueDate: 1, priority: 1, completed: 1, projectId: 1 } }
            ],
            as: "tasks"
          }
        },
        {
          $project: {
            name: 1,
            description: 1,
            taskCount: { $size: "$tasks" },
            completedCount: {
              $size: { $filter: { input: "$tasks", as: "task", cond: { $eq: ["$$task.completed", true] } } }
            },
            openTasks: {
              $map: {
                input: { $filter: { input: "$tasks", as: "task", cond: { $eq: ["$$task.completed", false] } } },
                as: "task",
                in: {
                  _id: "$$task._id",
                  title: "$$task.title",
                  dueDate: "$$task.dueDate",
                  priority: "$$task.priority",
                  projectId: "$_id",
                  projectName: "$name"
                }
              }
            }
          }
        }
      ]);
      const openTasks = rows.flatMap((row) => row.openTasks).sort((a, b) => {
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        return a.title.localeCompare(b.title);
      }).map((task) => ({
        id: task._id.toString(),
        projectId: task.projectId.toString(),
        projectName: task.projectName,
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        completed: false
      }));
      res.json({
        projects: rows.map((project) => ({
          id: project._id.toString(),
          name: project.name,
          description: project.description,
          percentComplete: project.taskCount === 0 ? 0 : Math.round(project.completedCount / project.taskCount * 100),
          completedCount: project.completedCount,
          taskCount: project.taskCount
        })),
        openTasks
      });
    })
  );
  return router;
}

// src/routes/labels.ts
import { Router as Router3 } from "express";

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
import { Types as Types2 } from "mongoose";
function objectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return new Types2.ObjectId(id);
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
  const router = Router3();
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
import { Router as Router4 } from "express";
function notesRouter() {
  const router = Router4();
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
import { Router as Router5 } from "express";
import { Types as Types4 } from "mongoose";

// src/page.ts
import { Types as Types3 } from "mongoose";
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
  return new Types3.ObjectId(value);
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

// src/dates.ts
function shiftISODate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// src/routes/notifications.ts
var NINETY_DAYS_MS2 = 90 * 24 * 60 * 60 * 1e3;
function notificationsRouter() {
  const router = Router5();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const todayParam = typeof req.query.today === "string" ? req.query.today : "";
      const today = normalizeDueDate(todayParam);
      if (!today) throw new HttpError(400, "Use a valid date.");
      const tomorrow = shiftISODate(today, 1);
      const tasks = await Task.find({ userId, completed: false, dueDate: { $ne: null } }).select("title dueDate projectId").lean();
      const projects = await Project.find({ userId }).select("name").lean();
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]));
      const expireAt = new Date(Date.now() + NINETY_DAYS_MS2);
      const userObjectId = new Types4.ObjectId(userId);
      const writes = tasks.flatMap((task) => {
        if (!task.dueDate) return [];
        const kind = task.dueDate < today ? "overdue" : task.dueDate <= tomorrow ? "due-soon" : null;
        if (!kind) return [];
        const key = `${task._id.toString()}:${kind}:${task.dueDate}`;
        return [
          {
            updateOne: {
              filter: { userId: userObjectId, key },
              update: {
                $setOnInsert: {
                  userId: userObjectId,
                  projectId: task.projectId,
                  taskId: task._id,
                  kind,
                  dueDate: task.dueDate,
                  read: false,
                  key,
                  expireAt
                },
                $set: {
                  title: task.title,
                  projectName: names.get(task.projectId.toString()) ?? "Project"
                }
              },
              upsert: true
            }
          }
        ];
      });
      await Notification.bulkWrite([
        ...writes,
        {
          updateMany: {
            filter: { userId: userObjectId, expireAt: { $exists: false } },
            update: { $set: { expireAt } }
          }
        }
      ]);
      const limit = pageLimit(req.query.limit);
      const cursor = beforeCursor(req.query.cursor);
      const filter = cursor ? { $and: [{ userId }, beforeFilter(cursor)] } : { userId };
      const items = await Notification.find(filter).select("projectId taskId kind title projectName dueDate read createdAt").sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
      const next = nextDateCursor(items, limit);
      if (next) res.set("X-Next-Cursor", next);
      res.json(items.slice(0, limit).map(publicNotification));
    })
  );
  router.post(
    "/read-all",
    asyncHandler(async (req, res) => {
      await Notification.updateMany({ userId: currentUserId(req), read: false }, { read: true });
      res.status(204).send();
    })
  );
  router.post(
    "/:id/read",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const id = objectId(req.params.id);
      if (!id) throw new HttpError(404, "Notification not found.");
      const item = await Notification.findOneAndUpdate({ _id: id, userId }, { read: true }, { new: true });
      if (!item) throw new HttpError(404, "Notification not found.");
      res.json(publicNotification(item));
    })
  );
  return router;
}

// src/routes/projects.ts
import { Router as Router6 } from "express";
function isDuplicateKey(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11e3;
}
function projectsRouter() {
  const router = Router6();
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
import { Router as Router7 } from "express";
var RESULT_LIMIT = 20;
var TIME_MS = 800;
function queryText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 200);
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function textSearch(value) {
  const cleaned = value.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}
async function settle(query) {
  try {
    return await query;
  } catch (error) {
    console.error(error);
    return [];
  }
}
function mergeById(groups, idOf) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of group) {
      const id = idOf(item);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
      if (merged.length >= RESULT_LIMIT) return merged;
    }
  }
  return merged;
}
async function whenText(text2, query) {
  if (!text2) return [];
  return settle(query());
}
function searchRouter() {
  const router = Router7();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const query = queryText(req.query.q);
      if (!query) {
        res.json({ projects: [], tasks: [], notes: [] });
        return;
      }
      const userId = currentUserId(req);
      const prefix = { $regex: `^${escapeRegex(query)}`, $options: "i" };
      const text2 = textSearch(query);
      const projectFields = "name description status createdAt updatedAt";
      const [projectText, projectName, taskText, taskTitle, noteText, noteTitle, ownedProjects] = await Promise.all([
        whenText(
          text2,
          () => Project.find({ userId, $text: { $search: text2 ?? "" } }).select(projectFields).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
        ),
        settle(
          Project.find({ userId, name: prefix }).select(projectFields).sort({ updatedAt: -1 }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
        ),
        whenText(
          text2,
          () => Task.find({ userId, $text: { $search: text2 ?? "" } }).select("projectId title completed").limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
        ),
        settle(
          Task.find({ userId, title: prefix }).select("projectId title completed").sort({ updatedAt: -1 }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
        ),
        whenText(
          text2,
          () => Note.find({ userId, $text: { $search: text2 ?? "" } }).select("projectId title body").limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
        ),
        settle(
          Note.find({ userId, title: prefix }).select("projectId title body").sort({ updatedAt: -1 }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS).lean()
        ),
        Project.find({ userId }).select("name").maxTimeMS(TIME_MS).lean()
      ]);
      const projects = mergeById([projectText, projectName], (item) => item._id.toString());
      const tasks = mergeById([taskText, taskTitle], (item) => item._id.toString());
      const notes = mergeById([noteText, noteTitle], (item) => item._id.toString());
      const names = new Map(ownedProjects.map((project) => [project._id.toString(), project.name]));
      res.json({
        projects: projects.map(publicProject),
        tasks: tasks.flatMap((task) => {
          const projectName2 = names.get(task.projectId.toString());
          if (!projectName2) return [];
          return [
            {
              id: task._id.toString(),
              projectId: task.projectId.toString(),
              projectName: projectName2,
              title: task.title,
              completed: task.completed
            }
          ];
        }),
        notes: notes.flatMap((note) => {
          const projectName2 = names.get(note.projectId.toString());
          if (!projectName2) return [];
          return [
            {
              id: note._id.toString(),
              projectId: note.projectId.toString(),
              projectName: projectName2,
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
import { Router as Router8 } from "express";
function tasksRouter() {
  const router = Router8();
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
import { Router as Router9 } from "express";
import { Types as Types5 } from "mongoose";
function present(task) {
  return {
    id: task._id.toString(),
    projectId: task.projectId.toString(),
    projectName: task.projectName,
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
  const router = Router9();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const date = typeof req.query.date === "string" ? normalizeDueDate(req.query.date) : null;
      if (!date) throw new HttpError(400, "Use a valid date.");
      const userId = new Types5.ObjectId(currentUserId(req));
      const visible = await Task.aggregate([
        { $match: { userId } },
        { $sort: { order: 1, createdAt: 1 } },
        {
          $lookup: {
            from: "projects",
            let: { projectId: "$projectId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$_id", "$$projectId"] }, { $eq: ["$userId", userId] }, { $eq: ["$status", "active"] }]
                  }
                }
              },
              { $project: { name: 1 } }
            ],
            as: "project"
          }
        },
        { $unwind: "$project" },
        {
          $project: {
            projectId: 1,
            projectName: "$project.name",
            title: 1,
            completed: 1,
            dueDate: 1,
            priority: 1,
            labelIds: 1,
            plannedFor: 1,
            completedOn: 1,
            order: 1,
            createdAt: 1,
            updatedAt: 1
          }
        }
      ]);
      const planned = visible.filter((task) => task.plannedFor === date);
      const overdue = visible.filter(
        (task) => !task.completed && Boolean(task.dueDate) && (task.dueDate ?? "") < date && task.plannedFor !== date
      );
      const overdueIds = new Set(overdue.map((task) => task._id.toString()));
      const carried = visible.filter(
        (task) => !task.completed && task.plannedFor != null && task.plannedFor < date && !overdueIds.has(task._id.toString()) && !(task.dueDate && task.dueDate > date)
      );
      const taken = new Set([...planned, ...overdue, ...carried].map((task) => task._id.toString()));
      const available = visible.filter((task) => !task.completed && !taken.has(task._id.toString()));
      const finished = visible.filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date);
      res.json({
        date,
        planned: planned.map(present),
        carried: carried.map(present),
        overdue: overdue.map(present),
        available: available.map(present),
        finished: finished.map(present)
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
  app2.use(express.json({ limit: "1mb" }));
  app2.use((req, _res, next) => {
    if (req.method === "POST" && req.path === "/api/auth/logout") {
      next();
      return;
    }
    connectDb().then(() => next(), next);
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: options.authRateLimitMax ?? (process.env.NODE_ENV === "production" ? 20 : 1e3),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again later." }
  });
  app2.use("/api/auth", authRouter(authLimiter));
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
