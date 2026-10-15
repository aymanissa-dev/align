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
var userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false }
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
var taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", required: true },
    labelIds: { type: [{ type: Schema.Types.ObjectId, ref: "Label" }], default: [] },
    order: { type: Number, required: true }
  },
  { timestamps: true }
);
taskSchema.index({ projectId: 1, completed: 1 });
taskSchema.index({ userId: 1, projectId: 1 });
taskSchema.index({ userId: 1, dueDate: 1 });
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
noteSchema.index({ projectId: 1 });
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index(
  { title: "text", body: "text" },
  { weights: { title: 5, body: 1 }, name: "NoteTextIndex" }
);
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
    Note.syncIndexes()
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
    state.promise = mongoose2.connect(uri, { serverSelectionTimeoutMS: 1e4 }).then((connection) => {
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
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString()
  };
}
function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}
function publicLabel(label) {
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    createdAt: label.createdAt.toISOString()
  };
}
function publicTask(task) {
  return {
    id: task.id,
    projectId: task.projectId.toString(),
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    order: task.order,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}
function publicNote(note) {
  return {
    id: note.id,
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
var profileSchema = z.object({
  name: text("Name", 80)
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
  labelIds: labelIds.optional()
});
var taskPatchSchema = z.object({
  title: text("Task title", 200).optional(),
  completed: z.boolean({ invalid_type_error: "Completed must be true or false." }).optional(),
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
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
      const user = await User.findByIdAndUpdate(currentUserId(req), { name: input.name }, { new: true });
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
function dashboardRouter() {
  const router = Router2();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const projects = await Project.find({ userId, status: "active" }).sort({ updatedAt: -1 });
      const projectIds = projects.map((project) => project._id);
      const tasks = await Task.find({ userId, projectId: { $in: projectIds } });
      const tasksByProject = /* @__PURE__ */ new Map();
      for (const task of tasks) {
        const key = task.projectId.toString();
        const list = tasksByProject.get(key);
        if (list) list.push(task);
        else tasksByProject.set(key, [task]);
      }
      const names = new Map(projects.map((project) => [project.id, project.name]));
      const openTasks = tasks.filter((task) => !task.completed).map((task) => ({
        id: task.id,
        projectId: task.projectId.toString(),
        projectName: names.get(task.projectId.toString()) ?? "",
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        completed: false
      })).sort((a, b) => {
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        return a.title.localeCompare(b.title);
      });
      res.json({
        projects: projects.map((project) => {
          const projectTasks = tasksByProject.get(project.id) ?? [];
          const completedCount = projectTasks.filter((task) => task.completed).length;
          const taskCount = projectTasks.length;
          return {
            id: project.id,
            name: project.name,
            description: project.description,
            percentComplete: taskCount === 0 ? 0 : Math.round(completedCount / taskCount * 100),
            completedCount,
            taskCount
          };
        }),
        openTasks
      });
    })
  );
  return router;
}

// src/routes/labels.ts
import { Router as Router3 } from "express";

// src/scope.ts
import { Types } from "mongoose";
function objectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return new Types.ObjectId(id);
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
      const labels = await Label.find({ userId: currentUserId(req) }).sort({ name: 1 });
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
      await label.deleteOne();
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
      const notes = await Note.find({ userId: currentUserId(req) }).sort({ updatedAt: -1 });
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
      res.json(publicNote(note));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const note = await requireNote(userId, req.params.id);
      await note.deleteOne();
      await touchProject(note.projectId, userId);
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/projects.ts
import { Router as Router5 } from "express";
function projectsRouter() {
  const router = Router5();
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
      const projects = await Project.find(filter).sort({ updatedAt: -1 });
      res.json(projects.map(publicProject));
    })
  );
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = parseBody(projectCreateSchema, req.body);
      const project = await Project.create({
        userId: currentUserId(req),
        name: input.name,
        description: input.description ?? "",
        status: "active"
      });
      res.status(201).json(publicProject(project));
    })
  );
  router.get(
    "/:id/tasks",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const tasks = await Task.find({ userId, projectId: project._id }).sort({ order: 1, createdAt: 1 });
      res.json(tasks.map(publicTask));
    })
  );
  router.post(
    "/:id/tasks",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const input = parseBody(taskCreateSchema, req.body);
      const dueDate2 = normalizeDueDate(input.dueDate) ?? null;
      const labelIds2 = await ownedLabelIds(userId, input.labelIds ?? []);
      const latest = await Task.findOne({ projectId: project._id }).sort({ order: -1 }).select("order");
      const task = await Task.create({
        userId,
        projectId: project._id,
        title: input.title,
        completed: false,
        dueDate: dueDate2,
        priority: input.priority ?? "medium",
        labelIds: labelIds2,
        order: (latest?.order ?? 0) + 1
      });
      await touchProject(project._id, userId);
      res.status(201).json(publicTask(task));
    })
  );
  router.get(
    "/:id/notes",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      const notes = await Note.find({ userId, projectId: project._id }).sort({ updatedAt: -1 });
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
      res.status(201).json(publicNote(note));
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
      res.json(publicProject(project));
    })
  );
  router.patch(
    "/:id/archive",
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id);
      project.status = project.status === "active" ? "archived" : "active";
      await project.save();
      res.json(publicProject(project));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const project = await requireProject(userId, req.params.id);
      await Task.deleteMany({ userId, projectId: project._id });
      await Note.deleteMany({ userId, projectId: project._id });
      await project.deleteOne();
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/search.ts
import { Router as Router6 } from "express";
var RESULT_LIMIT = 50;
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
async function searchDocs(query, byText, byRegex) {
  const text2 = textSearch(query);
  if (text2) {
    try {
      const hits = await byText(text2);
      if (hits.length > 0) {
        return hits.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
    } catch (error) {
      console.error(error);
    }
  }
  return byRegex();
}
function searchRouter() {
  const router = Router6();
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
      const pattern = escapeRegex(query);
      const contains = { $regex: pattern, $options: "i" };
      const [projects, tasks, notes, ownedProjects] = await Promise.all([
        searchDocs(
          query,
          (text2) => Project.find({ userId, $text: { $search: text2 } }).limit(RESULT_LIMIT),
          () => Project.find({ userId, $or: [{ name: contains }, { description: contains }] }).sort({ updatedAt: -1 }).limit(RESULT_LIMIT)
        ),
        searchDocs(
          query,
          (text2) => Task.find({ userId, $text: { $search: text2 } }).limit(RESULT_LIMIT),
          () => Task.find({ userId, title: contains }).sort({ updatedAt: -1 }).limit(RESULT_LIMIT)
        ),
        searchDocs(
          query,
          (text2) => Note.find({ userId, $text: { $search: text2 } }).limit(RESULT_LIMIT),
          () => Note.find({ userId, $or: [{ title: contains }, { body: contains }] }).sort({ updatedAt: -1 }).limit(RESULT_LIMIT)
        ),
        Project.find({ userId }).select("name")
      ]);
      const names = new Map(ownedProjects.map((project) => [project.id, project.name]));
      res.json({
        projects: projects.map(publicProject),
        tasks: tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString());
          if (!projectName) return [];
          return [
            {
              id: task.id,
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
              id: note.id,
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
import { Router as Router7 } from "express";
function tasksRouter() {
  const router = Router7();
  router.use(requireAuth);
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const task = await requireTask(userId, req.params.id);
      const input = parseBody(taskPatchSchema, req.body);
      if (input.title !== void 0) task.title = input.title;
      if (input.completed !== void 0) task.completed = input.completed;
      if (input.dueDate !== void 0) task.dueDate = normalizeDueDate(input.dueDate) ?? null;
      if (input.priority !== void 0) task.priority = input.priority;
      if (input.labelIds !== void 0) task.labelIds = await ownedLabelIds(userId, input.labelIds);
      if (input.order !== void 0) task.order = input.order;
      await task.save();
      await touchProject(task.projectId, userId);
      res.json(publicTask(task));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const task = await requireTask(userId, req.params.id);
      await task.deleteOne();
      await touchProject(task.projectId, userId);
      res.status(204).send();
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
  app2.use("/api/dashboard", dashboardRouter());
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
