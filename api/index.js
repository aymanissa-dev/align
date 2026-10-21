// src/app.ts
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose5 from "mongoose";

// src/csrf.ts
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";

// src/session.ts
import { createHash, randomBytes } from "node:crypto";
import "mongoose";

// src/authz.ts
var ROLES = ["owner", "admin", "member", "viewer"];
var RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
function roleAtLeast(role, minimum) {
  return RANK[role] >= RANK[minimum];
}
function isRole(value) {
  return ROLES.includes(value);
}

// src/models.ts
import mongoose, { Schema, model } from "mongoose";

// ../shared/search.ts
function searchTokens(value) {
  const cleaned = value.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (cleaned.replace(/\s/g, "").length < 3) return null;
  const tokens = cleaned.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  return tokens.length > 0 ? tokens : null;
}
function wordList(...parts) {
  const words = /* @__PURE__ */ new Set();
  for (const part of parts) {
    if (!part) continue;
    for (const word of part.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word) words.add(word);
    }
  }
  return [...words];
}
function relevanceScore(tokens, fields) {
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      for (const word of wordList(field.text)) {
        if (word === token) best = Math.max(best, 10 * field.weight);
        else if (word.startsWith(token)) best = Math.max(best, 4 * field.weight + Math.min(token.length, 8));
      }
    }
    score += best;
  }
  return score;
}

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
    googleId: { type: String },
    personalWorkspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", default: null },
    membershipVersion: { type: Number, default: 0 },
    totpSecret: { type: String, select: false, default: null },
    totpEnabledAt: { type: Date, default: null },
    recoveryCodes: {
      type: [{ hash: { type: String, required: true }, usedAt: { type: Date, default: null } }],
      default: [],
      select: false
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
var projectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["active", "archived"], default: "active", required: true },
    deletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
    searchWords: { type: [String] }
  },
  { timestamps: true, optimisticConcurrency: true }
);
projectSchema.pre("save", function() {
  this.searchWords = wordList(this.name, this.description);
});
projectSchema.index({ userId: 1, status: 1, updatedAt: -1 });
projectSchema.index({ workspaceId: 1, status: 1, deletedAt: 1, updatedAt: -1 }, { name: "ProjectWorkspace" });
projectSchema.index(
  { purgeAt: 1 },
  { name: "ProjectPurge", expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: "date" } } }
);
projectSchema.index({ userId: 1, searchWords: 1 }, { name: "ProjectSearchWords" });
projectSchema.index(
  { userId: 1, name: "text", description: "text" },
  { weights: { name: 5, description: 1 }, name: "ProjectTextIndex" }
);
var labelSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    name: { type: String, required: true },
    color: { type: String, required: true }
  },
  { timestamps: true, optimisticConcurrency: true }
);
labelSchema.index({ userId: 1, name: 1 }, { unique: true });
labelSchema.index({ workspaceId: 1, name: 1 }, { name: "LabelWorkspace" });
var taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true },
    deletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
    deletedWithProject: { type: Boolean, default: false },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", required: true },
    labelIds: { type: [{ type: Schema.Types.ObjectId, ref: "Label" }], default: [] },
    plannedFor: { type: String, default: null },
    completedOn: { type: String, default: null },
    order: { type: Number, required: true },
    // Client-generated id so a retried or replayed create returns the same task.
    clientId: { type: String },
    searchWords: { type: [String] }
  },
  { timestamps: true, optimisticConcurrency: true }
);
taskSchema.pre("save", function() {
  this.searchWords = wordList(this.title);
});
taskSchema.index(
  { userId: 1, clientId: 1 },
  {
    name: "TaskClientId",
    unique: true,
    partialFilterExpression: { clientId: { $type: "string" }, deletedAt: null }
  }
);
taskSchema.index(
  { workspaceId: 1, projectId: 1, deletedAt: 1, order: 1, createdAt: 1, _id: 1 },
  { name: "TaskProjectOrder" }
);
taskSchema.index({ workspaceId: 1, deletedAt: 1, completed: 1, dueDate: 1 }, { name: "TaskDue" });
taskSchema.index(
  { purgeAt: 1 },
  { name: "TaskPurge", expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: "date" } } }
);
taskSchema.index({ projectId: 1, completed: 1 });
taskSchema.index({ userId: 1, plannedFor: 1 });
taskSchema.index({ userId: 1, completedOn: 1 });
taskSchema.index({ userId: 1, projectId: 1, order: 1, createdAt: 1, _id: 1 });
taskSchema.index({ userId: 1, completed: 1, dueDate: 1 });
taskSchema.index({ userId: 1, title: "text" }, { name: "TaskTextIndex" });
taskSchema.index({ userId: 1, searchWords: 1 }, { name: "TaskSearchWords" });
var noteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    searchWords: { type: [String] }
  },
  { timestamps: true, optimisticConcurrency: true }
);
noteSchema.pre("save", function() {
  this.searchWords = wordList(this.title, this.body);
});
noteSchema.index({ userId: 1, projectId: 1, updatedAt: -1 });
noteSchema.index({ workspaceId: 1, projectId: 1, updatedAt: -1 }, { name: "NoteWorkspace" });
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index({ userId: 1, searchWords: 1 }, { name: "NoteSearchWords" });
noteSchema.index(
  { userId: 1, title: "text", body: "text" },
  { weights: { title: 5, body: 1 }, name: "NoteTextIndex" }
);
var NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;
var YEAR_SECONDS = 365 * 24 * 60 * 60;
var activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    type: { type: String, enum: ["create", "update", "delete", "complete"], required: true },
    summary: { type: String, required: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + NINETY_DAYS_SECONDS * 1e3) }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
activitySchema.index({ projectId: 1, createdAt: -1, _id: -1 }, { name: "ActivityProject" });
activitySchema.index({ expireAt: 1 }, { name: "ActivityExpire", expireAfterSeconds: 0 });
var notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    kind: { type: String, enum: ["due-soon", "overdue", "new-device"], required: true },
    title: { type: String, required: true },
    projectName: { type: String, default: "" },
    dueDate: { type: String, default: "" },
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
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
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
    deviceName: { type: String, default: "" },
    ipCoarse: { type: String, default: "" },
    location: { type: String, default: "" },
    lastSeenAt: { type: Date, required: true },
    stepUpAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
sessionSchema.index({ tokenHash: 1 }, { unique: true, name: "SessionToken" });
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
rateLimitSchema.index({ key: 1 }, { unique: true, name: "RateLimitKey" });
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
var workspaceSchema = new Schema(
  {
    name: { type: String, required: true },
    personal: { type: Boolean, default: false, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    membershipVersion: { type: Number, default: 0 }
  },
  { timestamps: true }
);
workspaceSchema.index({ ownerId: 1, personal: 1 }, { unique: true, partialFilterExpression: { personal: true }, name: "PersonalWorkspace" });
var membershipSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "member", "viewer"], required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true, name: "MembershipUser" });
membershipSchema.index({ userId: 1, workspaceId: 1 }, { name: "MembershipByUser" });
var passkeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    credentialId: { type: String, required: true },
    publicKey: { type: Buffer, required: true },
    counter: { type: Number, required: true, default: 0 },
    transports: { type: [String], default: [] },
    name: { type: String, default: "Passkey" }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
passkeySchema.index({ credentialId: 1 }, { unique: true, name: "PasskeyId" });
passkeySchema.index({ userId: 1, createdAt: -1 }, { name: "PasskeyUser" });
var securityEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true },
    summary: { type: String, required: true },
    ipCoarse: { type: String, default: "" },
    device: { type: String, default: "" },
    deviceType: { type: String, default: "" },
    location: { type: String, default: "" },
    read: { type: Boolean, default: false, required: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + YEAR_SECONDS * 1e3) }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
securityEventSchema.index({ userId: 1, createdAt: -1 }, { name: "SecurityEventUser" });
securityEventSchema.index({ expireAt: 1 }, { name: "SecurityEventExpire", expireAfterSeconds: 0 });
var challengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    challenge: { type: String, required: true },
    kind: { type: String, enum: ["register", "login", "stepup"], required: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: false }
);
challengeSchema.index({ challenge: 1 }, { unique: true, name: "ChallengeValue" });
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
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
slowQueries(workspaceSchema, "Workspace");
slowQueries(membershipSchema, "Membership");
slowQueries(passkeySchema, "Passkey");
slowQueries(securityEventSchema, "SecurityEvent");
slowQueries(challengeSchema, "Challenge");
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
var Workspace = compile("Workspace", () => model("Workspace", workspaceSchema));
var Membership = compile("Membership", () => model("Membership", membershipSchema));
var Passkey = compile("Passkey", () => model("Passkey", passkeySchema));
var SecurityEvent = compile("SecurityEvent", () => model("SecurityEvent", securityEventSchema));
var WebAuthnChallenge = compile("WebAuthnChallenge", () => model("WebAuthnChallenge", challengeSchema));

// src/data/securityLog.ts
async function recordSecurity(input) {
  await SecurityEvent.create({
    userId: input.userId,
    type: input.type,
    summary: input.summary.slice(0, 240),
    ipCoarse: input.ipCoarse ?? "",
    device: (input.device ?? "").slice(0, 120),
    deviceType: (input.deviceType ?? "").slice(0, 16),
    location: (input.location ?? "").slice(0, 80),
    read: false
  });
}

// src/data/workspaces.ts
import { Types } from "mongoose";

// src/errors.ts
var HttpError = class extends Error {
  status;
  headers;
  code;
  constructor(status, message, options) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = options?.headers ?? {};
    this.code = options?.code;
  }
};
function unavailable(message = "The database is unavailable. Try again shortly.") {
  return new HttpError(503, message, { headers: { "Retry-After": "5" } });
}

// src/data/txn.ts
import mongoose2 from "mongoose";
async function withTransaction(fn) {
  const session = await mongoose2.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

// src/data/workspaces.ts
var CACHE_MS = 6e4;
var cache = /* @__PURE__ */ new Map();
function cacheKey(userId, workspaceId, version) {
  return `${userId}:${workspaceId}:${version}`;
}
function ownerClaims(user) {
  if (!user.personalWorkspaceId) return null;
  return {
    workspaceId: user.personalWorkspaceId.toString(),
    role: "owner",
    membershipVersion: user.membershipVersion ?? 0
  };
}
function cachedTenant(userId, workspaceId, version) {
  const hit2 = cache.get(cacheKey(userId, workspaceId, version));
  if (!hit2) return null;
  if (hit2.expires <= Date.now()) {
    cache.delete(cacheKey(userId, workspaceId, version));
    return null;
  }
  return hit2.tenant;
}
function rememberTenant(userId, version, tenant) {
  cache.set(cacheKey(userId, tenant.workspaceId, version), { tenant, expires: Date.now() + CACHE_MS });
  if (cache.size <= 500) return;
  const oldest = cache.keys().next().value;
  if (oldest) cache.delete(oldest);
}
function dropTenantCache(userId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}
async function bumpMembership(userId, workspaceId) {
  dropTenantCache(userId);
  await Promise.all([
    User.updateOne({ _id: userId }, { $inc: { membershipVersion: 1 } }),
    Workspace.updateOne({ _id: workspaceId }, { $inc: { membershipVersion: 1 } })
  ]);
}
function personalWorkspaceName(name) {
  const trimmed = name.trim() || "Personal";
  return `${trimmed}'s workspace`.slice(0, 80);
}
async function ensurePersonalWorkspace(userId) {
  const user = await User.findById(userId);
  if (!user) throw new HttpError(401, "Sign in to continue.");
  if (user.personalWorkspaceId) {
    const member = await Membership.findOne({ userId: user._id, workspaceId: user.personalWorkspaceId });
    if (member) {
      return { userId: user.id, workspaceId: member.workspaceId.toString(), role: member.role };
    }
  }
  const existing = await Workspace.findOne({ ownerId: user._id, personal: true });
  if (existing) {
    const member = await Membership.findOneAndUpdate(
      { workspaceId: existing._id, userId: user._id },
      { $setOnInsert: { role: "owner" } },
      { upsert: true, new: true }
    );
    if (!user.personalWorkspaceId?.equals(existing._id)) {
      user.personalWorkspaceId = existing._id;
      await user.save();
    }
    return { userId: user.id, workspaceId: existing.id, role: member?.role ?? "owner" };
  }
  return withTransaction(async (session) => {
    const created = await Workspace.create(
      [{ name: personalWorkspaceName(user.name), personal: true, ownerId: user._id }],
      { session }
    );
    const workspace = created[0];
    if (!workspace) throw new HttpError(500, "Could not create a workspace.");
    await Membership.create([{ workspaceId: workspace._id, userId: user._id, role: "owner" }], { session });
    user.personalWorkspaceId = workspace._id;
    await user.save({ session });
    return { userId: user.id, workspaceId: workspace.id, role: "owner" };
  });
}
async function resolveTenant(userId, requested, version = 0) {
  if (requested && Types.ObjectId.isValid(requested)) {
    const hit2 = cachedTenant(userId, requested, version);
    if (hit2) return hit2;
    const member = await Membership.findOne({ userId, workspaceId: requested }).select("workspaceId role");
    if (!member) throw new HttpError(403, "You are not a member of that workspace.");
    const tenant = { userId, workspaceId: member.workspaceId.toString(), role: member.role };
    rememberTenant(userId, version, tenant);
    return tenant;
  }
  return ensurePersonalWorkspace(userId);
}
async function listWorkspaces(userId) {
  const memberships = await Membership.find({ userId }).lean();
  const ids = memberships.map((member) => member.workspaceId);
  const workspaces = await Workspace.find({ _id: { $in: ids } }).lean();
  const byId = new Map(workspaces.map((workspace) => [workspace._id.toString(), workspace]));
  return memberships.flatMap((member) => {
    const workspace = byId.get(member.workspaceId.toString());
    if (!workspace) return [];
    return [
      {
        id: workspace._id.toString(),
        name: workspace.name,
        personal: workspace.personal,
        role: member.role
      }
    ];
  });
}
async function createSharedWorkspace(userId, name) {
  return withTransaction(async (session) => {
    const created = await Workspace.create([{ name, personal: false, ownerId: userId }], { session });
    const workspace = created[0];
    if (!workspace) throw new HttpError(500, "Could not create a workspace.");
    await Membership.create([{ workspaceId: workspace._id, userId, role: "owner" }], { session });
    return { id: workspace.id, name: workspace.name, personal: false, role: "owner" };
  });
}
async function addMember(actor, email2, role) {
  if (!isRole(role) || role === "owner") throw new HttpError(400, "Choose admin, member, or viewer.");
  const user = await User.findOne({ email: email2 });
  if (!user) throw new HttpError(404, "No account uses that email.");
  const existing = await Membership.findOne({ workspaceId: actor.workspaceId, userId: user._id });
  if (existing) throw new HttpError(409, "That person is already in this workspace.");
  await Membership.create({ workspaceId: actor.workspaceId, userId: user._id, role });
  return { userId: user.id, email: user.email, name: user.name, role };
}
async function changeMemberRole(actor, memberId, role) {
  if (role === "owner") throw new HttpError(400, "Choose admin, member, or viewer.");
  const member = await Membership.findOne({ workspaceId: actor.workspaceId, userId: memberId });
  if (!member) throw new HttpError(404, "Member not found.");
  if (member.role === "owner") throw new HttpError(403, "The owner role cannot be changed here.");
  member.role = role;
  await member.save();
  await bumpMembership(member.userId.toString(), actor.workspaceId);
  return { userId: member.userId.toString(), role };
}
async function removeMember(actor, memberId) {
  const member = await Membership.findOne({ workspaceId: actor.workspaceId, userId: memberId });
  if (!member) throw new HttpError(404, "Member not found.");
  if (member.role === "owner") throw new HttpError(403, "The owner cannot be removed.");
  await member.deleteOne();
  await bumpMembership(member.userId.toString(), actor.workspaceId);
}

// src/keys.ts
import jwt from "jsonwebtoken";
function signingKeys() {
  const current = process.env.JWT_SECRET;
  if (!current) throw new HttpError(500, "Auth is not configured.");
  const keys = [{ kid: process.env.JWT_KID || "current", secret: current }];
  if (process.env.JWT_SECRET_PREVIOUS) {
    keys.push({
      kid: process.env.JWT_KID_PREVIOUS || "previous",
      secret: process.env.JWT_SECRET_PREVIOUS
    });
  }
  return keys;
}
function signJwt(payload, expiresIn) {
  const key = signingKeys()[0];
  if (!key) throw new HttpError(500, "Auth is not configured.");
  return jwt.sign(payload, key.secret, { expiresIn, algorithm: "HS256", header: { kid: key.kid, alg: "HS256" } });
}
function verifyJwt(token) {
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded && typeof decoded === "object" && typeof decoded.header.kid === "string" ? decoded.header.kid : void 0;
  const keys = signingKeys();
  const ordered = [...keys.filter((key) => key.kid === kid), ...keys.filter((key) => key.kid !== kid)];
  for (const key of ordered) {
    try {
      const payload = jwt.verify(token, key.secret);
      if (typeof payload === "string") return null;
      return payload;
    } catch {
      continue;
    }
  }
  return null;
}

// src/session.ts
var ACCESS_COOKIE = "token";
var REFRESH_COOKIE = "refresh";
var ACCESS_MS = 15 * 60 * 1e3;
var IDLE_MS = 14 * 24 * 60 * 60 * 1e3;
var ABSOLUTE_MS = 60 * 24 * 60 * 60 * 1e3;
var REFRESH_MS = ABSOLUTE_MS;
var REUSE_GRACE_MS = process.env.NODE_ENV === "test" ? 0 : 15e3;
var STEP_UP_MS = 10 * 60 * 1e3;
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
function writeCookies(res, userId, sessionId, refresh, claims) {
  const access = signJwt(
    { sub: userId, sid: sessionId, typ: "access", wid: claims.workspaceId, role: claims.role, mv: claims.membershipVersion },
    "15m"
  );
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), maxAge: ACCESS_MS });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), maxAge: REFRESH_MS });
}
function coarseIp(ip) {
  if (!ip) return "";
  const cleaned = ip.replace(/^::ffff:/, "");
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":").filter(Boolean);
    return `${parts.slice(0, 4).join(":")}::/64`;
  }
  const octets = cleaned.split(".");
  if (octets.length !== 4) return "";
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}
function coarseLocation(req) {
  const country = req.get("x-vercel-ip-country");
  if (!country || country === "unknown") return "";
  return country.slice(0, 8);
}
async function claimsFor(userId, known) {
  if (known) return known;
  const user = await User.findById(userId).select("personalWorkspaceId membershipVersion");
  const claims = user ? ownerClaims(user) : null;
  if (claims) return claims;
  const tenant = await ensurePersonalWorkspace(userId);
  return { workspaceId: tenant.workspaceId, role: tenant.role, membershipVersion: user?.membershipVersion ?? 0 };
}
function noticeNewDevice(req, userId, before) {
  const userAgent = (req.get("user-agent") ?? "").slice(0, 300);
  const deviceName = deviceLabel(userAgent);
  const ip = coarseIp(req.ip);
  return Promise.all([
    Session.exists({ userId, deviceName, ipCoarse: ip, createdAt: { $lt: before } }),
    Session.exists({ userId, createdAt: { $lt: before } })
  ]).then(([seen, any]) => Boolean(any && !seen));
}
async function startSession(req, res, userId, knownClaims) {
  const before = /* @__PURE__ */ new Date();
  const noticed = noticeNewDevice(req, userId, before);
  const claims = await claimsFor(userId, knownClaims);
  const sessionId = await issueSession(req, res, userId, randomBytes(16).toString("hex"), claims);
  const newDevice = await noticed;
  if (newDevice) {
    const audit = requestAudit(req);
    await recordSecurity({
      userId,
      type: "new-device",
      summary: `New sign-in from ${audit.device}.`,
      ...audit
    });
    await Notification.create({
      userId,
      kind: "new-device",
      title: `New sign-in from ${audit.device}`,
      projectName: [audit.deviceType, audit.location].filter(Boolean).join(" \xB7 "),
      dueDate: "",
      key: `new-device:${sessionId}`,
      read: false
    });
  }
  return { newDevice };
}
async function issueSession(req, res, userId, familyId, claims, previous) {
  const refresh = randomBytes(32).toString("hex");
  const userAgent = previous ? previous.userAgent ?? "" : req.get("user-agent") ?? "";
  const now = /* @__PURE__ */ new Date();
  const session = await Session.create({
    userId,
    familyId,
    tokenHash: hashToken(refresh),
    expiresAt: new Date(now.getTime() + REFRESH_MS),
    userAgent: userAgent.slice(0, 300),
    deviceName: deviceLabel(userAgent),
    ipCoarse: coarseIp(req.ip),
    location: coarseLocation(req),
    lastSeenAt: now,
    stepUpAt: previous?.stepUpAt ?? now
  });
  if (previous) {
    await Session.updateOne({ _id: previous._id }, { replacedBy: session._id, rotatedAt: now });
  }
  writeCookies(res, userId, session.id, refresh, claims);
  return session.id;
}
function accessFromRequest(req) {
  const token = readCookie(req.headers.cookie);
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload || payload.typ !== "access") return null;
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
  const role = typeof payload.role === "string" && isRole(payload.role) ? payload.role : void 0;
  return {
    userId: payload.sub,
    sid: payload.sid,
    workspaceId: typeof payload.wid === "string" ? payload.wid : void 0,
    role,
    membershipVersion: typeof payload.mv === "number" ? payload.mv : void 0
  };
}
function sessionExpired(session) {
  if (session.expiresAt.getTime() <= Date.now()) return true;
  return Date.now() - session.lastSeenAt.getTime() > IDLE_MS;
}
function stepUpFresh(stepUpAt, now = Date.now()) {
  if (!stepUpAt) return false;
  return now - stepUpAt.getTime() <= STEP_UP_MS;
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
      await recordSecurity({
        userId: current.userId.toString(),
        type: "refresh-reuse",
        summary: "A refresh token was reused. That session family was signed out.",
        ...requestAudit(req)
      });
      clearSession(res);
    }
    return null;
  }
  if (sessionExpired(current)) {
    await Session.updateOne({ _id: current._id, revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() });
    clearSession(res);
    return null;
  }
  const user = await User.findById(current.userId);
  if (!user) {
    clearSession(res);
    return null;
  }
  const claims = await claimsFor(user.id, ownerClaims(user));
  await issueSession(req, res, user.id, current.familyId, claims, current);
  return user;
}
async function loadSession(id) {
  return Session.findById(id);
}
async function listActiveSessions(userId) {
  return Session.find({
    userId,
    revokedAt: null,
    replacedBy: null,
    expiresAt: { $gt: /* @__PURE__ */ new Date() }
  }).select("userAgent deviceName ipCoarse location lastSeenAt createdAt expiresAt stepUpAt").sort({ lastSeenAt: -1 }).lean();
}
async function revokeSessionById(userId, id) {
  return Session.findOne({ _id: id, userId, revokedAt: null, replacedBy: null });
}
async function renameSession(userId, id, name) {
  return Session.findOneAndUpdate(
    { _id: id, userId, revokedAt: null, replacedBy: null },
    { deviceName: name },
    { new: true }
  );
}
async function revokeSessions(userId, exceptId) {
  await Session.updateMany(
    { userId, revokedAt: null, ...exceptId ? { _id: { $ne: exceptId } } : {} },
    { revokedAt: /* @__PURE__ */ new Date() }
  );
}
async function markStepUp(sessionId) {
  await Session.updateOne({ _id: sessionId }, { stepUpAt: /* @__PURE__ */ new Date() });
}
async function requireFreshStepUp(sessionId) {
  if (!sessionId) throw new HttpError(401, "Sign in to continue.");
  const session = await loadSession(sessionId);
  if (session && stepUpFresh(session.stepUpAt)) return;
  throw new HttpError(403, "Confirm it is you to continue.", { code: "step_up_required" });
}
function requestAudit(req) {
  const userAgent = req.get("user-agent") ?? "";
  return {
    ipCoarse: coarseIp(req.ip),
    device: deviceLabel(userAgent),
    deviceType: deviceKind(userAgent),
    location: coarseLocation(req)
  };
}
async function revokeRefreshCookie(req) {
  const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
  if (!raw) return;
  await Session.updateOne({ tokenHash: hashToken(raw), revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() });
}
function deviceLabel(userAgent) {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Mac OS|Macintosh/.test(userAgent) ? "macOS" : /Android/.test(userAgent) ? "Android" : /Linux/.test(userAgent) ? "Linux" : "Unknown device";
  return `${browser} on ${os}`;
}
function deviceKind(userAgent) {
  if (/iPad|Tablet/i.test(userAgent)) return "tablet";
  if (/Mobile|iPhone|Android/i.test(userAgent)) return "phone";
  return "desktop";
}

// src/csrf.ts
var CSRF_COOKIE = "csrf";
var HEADER = "x-csrf-token";
function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 24 * 60 * 60 * 1e3
  };
}
var csrfProtection = (req, res, next) => {
  const existing = readCookie(req.headers.cookie, CSRF_COOKIE);
  const token = existing ?? randomBytes2(32).toString("hex");
  if (!existing) res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  const method = req.method.toUpperCase();
  const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (unsafe && req.path.startsWith("/api/") && existing) {
    const header = req.get(HEADER) ?? "";
    if (!header || !safeEqual(header, existing)) {
      res.status(403).json({ error: "CSRF token missing or invalid.", code: "csrf" });
      return;
    }
  }
  next();
};

// src/db.ts
import mongoose4 from "mongoose";

// src/migrate/runner.ts
import mongoose3 from "mongoose";

// src/migrate/personalWorkspaces.ts
var RETENTION_MS = 90 * 24 * 60 * 60 * 1e3;
var PERSONAL_WORKSPACES = "001_personal_workspaces";
async function stamp(model2, userId, workspaceId, session, dryRun) {
  const filter = { userId, $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] };
  if (dryRun) return model2.countDocuments(filter);
  const result = await model2.updateMany(filter, { $set: { workspaceId } }, session ? { session } : void 0);
  return result.modifiedCount ?? 0;
}
async function upPersonalWorkspaces(dryRun) {
  const counts = { users: 0, projects: 0, tasks: 0, notes: 0, labels: 0, whiteboards: 0, activity: 0 };
  const users2 = await User.find({}).select("name personalWorkspaceId");
  const missing = [];
  for (const user of users2) {
    const workspace = await Workspace.findOne({ ownerId: user._id, personal: true }).select("_id");
    if (!workspace) missing.push(user);
  }
  counts.users = missing.length;
  if (dryRun) {
    const unscoped = { $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] };
    counts.projects = await Project.countDocuments(unscoped);
    counts.tasks = await Task.countDocuments(unscoped);
    counts.notes = await Note.countDocuments(unscoped);
    counts.labels = await Label.countDocuments(unscoped);
    counts.whiteboards = await Whiteboard.countDocuments(unscoped);
    counts.activity = await Activity.countDocuments({ expireAt: { $exists: false } });
    return counts;
  }
  await withTransaction(async (session) => {
    for (const user of missing) {
      const created = await Workspace.create(
        [{ name: personalWorkspaceName(user.name), personal: true, ownerId: user._id }],
        { session }
      );
      const workspace = created[0];
      if (!workspace) continue;
      await Membership.updateOne(
        { workspaceId: workspace._id, userId: user._id },
        { $setOnInsert: { role: "owner" } },
        { upsert: true, session }
      );
      await User.updateOne({ _id: user._id }, { personalWorkspaceId: workspace._id }, { session });
    }
  });
  const owned = await Workspace.find({ personal: true }).select("ownerId");
  for (const workspace of owned) {
    counts.projects += await stamp(Project, workspace.ownerId, workspace._id, null, false);
    counts.tasks += await stamp(Task, workspace.ownerId, workspace._id, null, false);
    counts.notes += await stamp(Note, workspace.ownerId, workspace._id, null, false);
    counts.labels += await stamp(Label, workspace.ownerId, workspace._id, null, false);
    counts.whiteboards += await stamp(Whiteboard, workspace.ownerId, workspace._id, null, false);
    const activity = await Activity.updateMany(
      { userId: workspace.ownerId, $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] },
      { $set: { workspaceId: workspace._id } }
    );
    counts.activity += activity.modifiedCount ?? 0;
  }
  const retention = await Activity.updateMany(
    { expireAt: { $exists: false } },
    { $set: { expireAt: new Date(Date.now() + RETENTION_MS) } }
  );
  counts.activity += retention.modifiedCount ?? 0;
  const deleted = await Task.updateMany({ deletedAt: { $exists: false } }, { $set: { deletedAt: null } });
  counts.tasks += deleted.modifiedCount ?? 0;
  return counts;
}
async function downPersonalWorkspaces(dryRun) {
  const workspaces = await Workspace.find({ personal: true }).select("_id");
  const ids = workspaces.map((workspace) => workspace._id);
  const counts = {
    workspaces: ids.length,
    projects: await Project.countDocuments({ workspaceId: { $in: ids } }),
    tasks: await Task.countDocuments({ workspaceId: { $in: ids } }),
    notes: await Note.countDocuments({ workspaceId: { $in: ids } }),
    labels: await Label.countDocuments({ workspaceId: { $in: ids } }),
    whiteboards: await Whiteboard.countDocuments({ workspaceId: { $in: ids } })
  };
  if (dryRun) return counts;
  await withTransaction(async (session) => {
    await Project.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: "" } }, { session });
    await Task.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: "" } }, { session });
    await Note.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: "" } }, { session });
    await Label.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: "" } }, { session });
    await Whiteboard.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: "" } }, { session });
    await Activity.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: "" } }, { session });
    await Membership.deleteMany({ workspaceId: { $in: ids } }, { session });
    await User.updateMany({ personalWorkspaceId: { $in: ids } }, { $set: { personalWorkspaceId: null } }, { session });
    await Workspace.deleteMany({ _id: { $in: ids } }, { session });
  });
  return counts;
}

// src/migrate/runner.ts
var MIGRATIONS = [
  { id: PERSONAL_WORKSPACES, up: upPersonalWorkspaces, down: downPersonalWorkspaces }
];
var appliedOnce = null;
function runMigrations(options) {
  if (!options?.dryRun && !options?.direction && !options?.only) {
    appliedOnce ??= execute({ direction: "up" }).catch((error) => {
      appliedOnce = null;
      throw error;
    });
    return appliedOnce;
  }
  return execute(options);
}
async function execute(options) {
  const db = mongoose3.connection.db;
  if (!db) return [];
  const collection = db.collection("migrations");
  const applied = new Set((await collection.find({}, { projection: { id: 1 } }).toArray()).map((doc) => doc.id));
  const dryRun = options?.dryRun === true;
  const direction = options?.direction ?? "up";
  const selected = options?.only ? MIGRATIONS.filter((migration) => migration.id === options.only) : MIGRATIONS;
  const results = [];
  const list = direction === "down" ? [...selected].reverse() : selected;
  for (const migration of list) {
    if (direction === "up" && applied.has(migration.id)) continue;
    if (direction === "down" && !applied.has(migration.id) && !dryRun) continue;
    const counts = direction === "down" ? await migration.down(dryRun) : await migration.up(dryRun);
    if (!dryRun && direction === "up") {
      await collection.insertOne({ id: migration.id, appliedAt: /* @__PURE__ */ new Date(), counts });
      console.info(JSON.stringify({ msg: "migration", id: migration.id, counts }));
    }
    if (!dryRun && direction === "down") {
      await collection.deleteOne({ id: migration.id });
      console.info(JSON.stringify({ msg: "migration-down", id: migration.id, counts }));
    }
    results.push({ id: migration.id, direction, dryRun, counts });
  }
  return results;
}

// src/db.ts
var globalCache = globalThis;
function cache2() {
  globalCache.__alignMongoose ??= { conn: null, promise: null };
  return globalCache.__alignMongoose;
}
var indexesReady = null;
var wordsReady = null;
async function fillSearchWords(model2, words) {
  for (; ; ) {
    const docs = await model2.find({ searchWords: { $exists: false } }).limit(200);
    if (docs.length === 0) return;
    await model2.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { searchWords: words(doc) } }
        }
      }))
    );
  }
}
function ensureSearchWords() {
  wordsReady ??= Promise.all([
    fillSearchWords(Task, (doc) => wordList(doc.title)),
    fillSearchWords(Note, (doc) => wordList(doc.title, doc.body)),
    fillSearchWords(Project, (doc) => wordList(doc.name, doc.description))
  ]).then(() => void 0).catch((error) => {
    wordsReady = null;
    throw error;
  });
  return wordsReady;
}
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
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function syncAllIndexes() {
  await Promise.all([
    dropUnscopedText(Project.collection, "ProjectTextIndex"),
    dropUnscopedText(Task.collection, "TaskTextIndex"),
    dropUnscopedText(Note.collection, "NoteTextIndex")
  ]);
  await Promise.all([
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
    RateLimit.syncIndexes(),
    Workspace.syncIndexes(),
    Membership.syncIndexes(),
    Passkey.syncIndexes(),
    SecurityEvent.syncIndexes(),
    WebAuthnChallenge.syncIndexes()
  ]);
}
function ensureIndexes() {
  indexesReady ??= (async () => {
    let last;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await syncAllIndexes();
        await ensureSearchWords();
        return;
      } catch (error) {
        last = error;
        await wait(400 * (attempt + 1));
      }
    }
    throw last;
  })().catch((error) => {
    indexesReady = null;
    throw error;
  });
  return indexesReady;
}
function databaseFailure(error) {
  console.error(error);
  return unavailable();
}
function shouldSync(options) {
  return options?.indexes === true || process.env.NODE_ENV === "test";
}
async function connectDb(options) {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri === "memory") {
    throw new HttpError(500, "Database is not configured.");
  }
  const state = cache2();
  if (state.conn) {
    await runMigrations();
    if (shouldSync(options)) await ensureIndexes();
    return state.conn;
  }
  if (!state.promise) {
    mongoose4.set("bufferCommands", false);
    state.promise = mongoose4.connect(uri, {
      retryWrites: true,
      retryReads: true,
      serverSelectionTimeoutMS: 5e3,
      connectTimeoutMS: 1e4,
      socketTimeoutMS: 2e4,
      heartbeatFrequencyMS: 1e4,
      waitQueueTimeoutMS: 5e3,
      maxPoolSize: 5,
      minPoolSize: 1,
      maxIdleTimeMS: 6e4
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
  await runMigrations();
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

// ../shared/contract.ts
var CONFLICT_MESSAGE = "This was changed elsewhere.";

// src/middleware.ts
var LAST_SEEN_MS = 5 * 60 * 1e3;
var recentSeen = /* @__PURE__ */ new Map();
function touchLastSeen(session) {
  const now = Date.now();
  if (now - session.lastSeenAt.getTime() < LAST_SEEN_MS) return;
  const id = session._id.toString();
  const stamped = recentSeen.get(id);
  if (stamped !== void 0 && now - stamped < LAST_SEEN_MS) return;
  recentSeen.set(id, now);
  if (recentSeen.size > 2e3) {
    const oldest = recentSeen.keys().next().value;
    if (oldest) recentSeen.delete(oldest);
  }
  void Session.updateOne({ _id: session._id }, { lastSeenAt: /* @__PURE__ */ new Date() }).catch(() => void 0);
}
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
    if (sessionExpired(session)) {
      void Session.updateOne({ _id: session._id, revokedAt: null }, { revokedAt: /* @__PURE__ */ new Date() }).catch(() => void 0);
      next(new HttpError(401, "Sign in to continue."));
      return;
    }
    req.userId = user.id;
    req.sessionId = session.id;
    touchLastSeen(session);
    const version = user.membershipVersion ?? 0;
    const requested = req.get("x-workspace-id") || void 0;
    const claimed = access.workspaceId && access.role && access.membershipVersion === version ? { userId: user.id, workspaceId: access.workspaceId, role: access.role } : null;
    if (requested && requested !== claimed?.workspaceId) {
      resolveTenant(user.id, requested, version).then((tenant) => {
        req.tenant = tenant;
        next();
      }).catch(next);
      return;
    }
    if (!claimed) {
      next(new HttpError(401, "Sign in to continue."));
      return;
    }
    req.tenant = claimed;
    next();
  }).catch(next);
};
function currentUserId(req) {
  if (!req.userId) throw new HttpError(401, "Sign in to continue.");
  return req.userId;
}
var requireWriter = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (!req.tenant || !roleAtLeast(req.tenant.role, "member")) {
    next(new HttpError(403, "You do not have permission to change this workspace."));
    return;
  }
  next();
};
function isRecord(error) {
  return typeof error === "object" && error !== null;
}
var errorHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof HttpError) {
    for (const [key, value] of Object.entries(error.headers)) res.setHeader(key, value);
    res.status(error.status).json(error.code ? { error: error.message, code: error.code } : { error: error.message });
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
  if (isRecord(error) && error.name === "VersionError") {
    res.status(409).json({ error: CONFLICT_MESSAGE });
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
import { randomBytes as randomBytes4 } from "node:crypto";
import { Router as Router2 } from "express";

// src/data/content.ts
import { Types as Types3 } from "mongoose";
var TRASH_MS = 30 * 24 * 60 * 60 * 1e3;
function objectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return new Types3.ObjectId(id);
}
function bind(tenant) {
  const workspaceId = new Types3.ObjectId(tenant.workspaceId);
  const userId = new Types3.ObjectId(tenant.userId);
  const alive = { deletedAt: null };
  function wid(filter = {}) {
    return { workspaceId, ...filter };
  }
  return {
    workspaceId,
    userId,
    projects: {
      find(filter = {}) {
        return Project.find(wid({ ...alive, ...filter }));
      },
      create(doc) {
        return Project.create({ ...doc, userId, workspaceId, deletedAt: null, purgeAt: null });
      }
    },
    tasks: {
      find(filter = {}) {
        return Task.find(wid({ ...alive, ...filter }));
      },
      findOne(filter) {
        return Task.findOne(wid({ ...alive, ...filter }));
      },
      create(doc) {
        return Task.create({ ...doc, userId, workspaceId, deletedAt: null, deletedWithProject: false });
      },
      aggregate(pipeline) {
        return Task.aggregate([{ $match: { workspaceId, deletedAt: null } }, ...pipeline]);
      },
      updateMany(filter, update) {
        return Task.updateMany(wid(filter), update);
      }
    },
    notes: {
      find(filter = {}) {
        return Note.find(wid(filter));
      },
      create(doc) {
        return Note.create({ ...doc, userId, workspaceId });
      }
    },
    labels: {
      find(filter = {}) {
        return Label.find(wid(filter));
      },
      findOne(filter) {
        return Label.findOne(wid(filter));
      },
      create(doc) {
        return Label.create({ ...doc, userId, workspaceId });
      }
    },
    activity: {
      find(filter = {}) {
        return Activity.find(wid(filter));
      },
      deleteMany(filter) {
        return Activity.deleteMany(wid(filter));
      }
    },
    notifications: {
      find(filter = {}) {
        return Notification.find({ userId, ...filter });
      },
      deleteMany(filter) {
        return Notification.deleteMany({ userId, ...filter });
      },
      updateMany(filter, update) {
        return Notification.updateMany({ userId, ...filter }, update);
      },
      findOneAndUpdate(filter, update, options) {
        return Notification.findOneAndUpdate({ userId, ...filter }, update, options);
      },
      bulkWrite(ops) {
        return Notification.bulkWrite(ops);
      }
    },
    whiteboards: {
      findOne(filter) {
        return Whiteboard.findOne(wid(filter));
      },
      deleteMany(filter) {
        return Whiteboard.deleteMany(wid(filter));
      },
      save(projectId, scene) {
        return Whiteboard.findOneAndUpdate(
          { workspaceId, projectId },
          { userId, workspaceId, projectId, scene },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
      }
    },
    async requireProject(id) {
      const projectId = objectId(id);
      if (!projectId) throw new HttpError(404, "Project not found.");
      const project = await Project.findOne({ _id: projectId, workspaceId, deletedAt: null });
      if (!project) throw new HttpError(404, "Project not found.");
      return project;
    },
    async requireTask(id) {
      const taskId = objectId(id);
      if (!taskId) throw new HttpError(404, "Task not found.");
      const task = await Task.findOne({ _id: taskId, workspaceId, deletedAt: null });
      if (!task) throw new HttpError(404, "Task not found.");
      return task;
    },
    async requireNote(id) {
      const noteId = objectId(id);
      if (!noteId) throw new HttpError(404, "Note not found.");
      const note = await Note.findOne({ _id: noteId, workspaceId });
      if (!note) throw new HttpError(404, "Note not found.");
      const project = await Project.findOne({ _id: note.projectId, workspaceId, deletedAt: null }).select("_id");
      if (!project) throw new HttpError(404, "Note not found.");
      return note;
    },
    async ownedLabelIds(ids) {
      const unique = [...new Set(ids)];
      const objectIds = unique.map(objectId);
      if (objectIds.some((id) => !id)) throw new HttpError(400, "Unknown label.");
      const found = await Label.find({ workspaceId, _id: { $in: objectIds } }).select("_id");
      if (found.length !== objectIds.length) throw new HttpError(400, "Unknown label.");
      return objectIds.filter((id) => id !== null);
    },
    async touchProject(projectId) {
      await Project.updateOne({ _id: projectId, workspaceId }, { $currentDate: { updatedAt: true } });
    },
    async activeProjectIds() {
      const rows = await Project.find({ workspaceId, deletedAt: null }).select("_id");
      return rows.map((row) => row._id);
    },
    async softDeleteProject(project) {
      const now = /* @__PURE__ */ new Date();
      const purgeAt = new Date(now.getTime() + TRASH_MS);
      await withTransaction(async (session) => {
        const taskIds = await Task.find({ workspaceId, projectId: project._id, deletedAt: null }).session(session).distinct("_id");
        await Notification.deleteMany({ userId, taskId: { $in: taskIds } }, { session });
        await Task.updateMany(
          { workspaceId, projectId: project._id, deletedAt: null },
          { $set: { deletedAt: now, purgeAt, deletedWithProject: true } },
          { session }
        );
        project.deletedAt = now;
        project.purgeAt = purgeAt;
        await project.save({ session });
      });
    },
    async softDeleteTask(task) {
      const now = /* @__PURE__ */ new Date();
      task.deletedAt = now;
      task.purgeAt = new Date(now.getTime() + TRASH_MS);
      task.deletedWithProject = false;
      await task.save();
    },
    async trash() {
      const [projects, tasks] = await Promise.all([
        Project.find({ workspaceId, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).lean(),
        Task.find({ workspaceId, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).lean()
      ]);
      return { projects, tasks };
    },
    async restoreProject(id) {
      const projectId = objectId(id);
      if (!projectId) throw new HttpError(404, "Project not found.");
      const project = await Project.findOne({ _id: projectId, workspaceId, deletedAt: { $ne: null } });
      if (!project) throw new HttpError(404, "Project not found.");
      await withTransaction(async (session) => {
        project.deletedAt = null;
        project.purgeAt = null;
        await project.save({ session });
        await Task.updateMany(
          { workspaceId, projectId: project._id, deletedWithProject: true },
          { $set: { deletedAt: null, purgeAt: null, deletedWithProject: false } },
          { session }
        );
      });
      return project;
    },
    async restoreTask(id) {
      const taskId = objectId(id);
      if (!taskId) throw new HttpError(404, "Task not found.");
      const task = await Task.findOne({ _id: taskId, workspaceId, deletedAt: { $ne: null } });
      if (!task) throw new HttpError(404, "Task not found.");
      const project = await Project.findOne({ _id: task.projectId, workspaceId, deletedAt: null }).select("_id");
      if (!project) throw new HttpError(409, "Restore the project before restoring this task.");
      task.deletedAt = null;
      task.purgeAt = null;
      task.deletedWithProject = false;
      await task.save();
      return task;
    },
    async purgeProject(id) {
      const projectId = objectId(id);
      if (!projectId) throw new HttpError(404, "Project not found.");
      const project = await Project.findOne({ _id: projectId, workspaceId, deletedAt: { $ne: null } }).select("_id");
      if (!project) throw new HttpError(404, "Project not found.");
      await withTransaction(async (session) => {
        const taskIds = await Task.find({ workspaceId, projectId }).session(session).distinct("_id");
        await Notification.deleteMany({ userId, taskId: { $in: taskIds } }, { session });
        await Task.deleteMany({ workspaceId, projectId }, { session });
        await Note.deleteMany({ workspaceId, projectId }, { session });
        await Whiteboard.deleteMany({ workspaceId, projectId }, { session });
        await Activity.deleteMany({ workspaceId, projectId }, { session });
        await Project.deleteOne({ _id: projectId, workspaceId }, { session });
      });
    },
    async purgeTask(id) {
      const taskId = objectId(id);
      if (!taskId) throw new HttpError(404, "Task not found.");
      const task = await Task.findOne({ _id: taskId, workspaceId, deletedAt: { $ne: null } }).select("_id");
      if (!task) throw new HttpError(404, "Task not found.");
      await withTransaction(async (session) => {
        await Notification.deleteMany({ userId, taskId }, { session });
        await Task.deleteOne({ _id: taskId, workspaceId }, { session });
      });
    },
    async emptyTrash() {
      await withTransaction(async (session) => {
        const projects = await Project.find({ workspaceId, deletedAt: { $ne: null } }).session(session).select("_id");
        const projectIds = projects.map((project) => project._id);
        const tasks = await Task.find({
          workspaceId,
          $or: [{ deletedAt: { $ne: null } }, { projectId: { $in: projectIds } }]
        }).session(session).select("_id");
        const taskIds = tasks.map((task) => task._id);
        if (taskIds.length > 0) await Notification.deleteMany({ userId, taskId: { $in: taskIds } }, { session });
        if (taskIds.length > 0) await Task.deleteMany({ _id: { $in: taskIds }, workspaceId }, { session });
        if (projectIds.length > 0) {
          await Note.deleteMany({ workspaceId, projectId: { $in: projectIds } }, { session });
          await Whiteboard.deleteMany({ workspaceId, projectId: { $in: projectIds } }, { session });
          await Activity.deleteMany({ workspaceId, projectId: { $in: projectIds } }, { session });
          await Project.deleteMany({ _id: { $in: projectIds }, workspaceId }, { session });
        }
      });
    }
  };
}
async function deleteAccount(userId) {
  await withTransaction(async (session) => {
    const id = new Types3.ObjectId(userId);
    await Task.deleteMany({ userId: id }, { session });
    await Note.deleteMany({ userId: id }, { session });
    await Label.deleteMany({ userId: id }, { session });
    await Activity.deleteMany({ userId: id }, { session });
    await Notification.deleteMany({ userId: id }, { session });
    await Whiteboard.deleteMany({ userId: id }, { session });
    await Project.deleteMany({ userId: id }, { session });
    await Session.deleteMany({ userId: id }, { session });
    await AuthToken.deleteMany({ userId: id }, { session });
    await Passkey.deleteMany({ userId: id }, { session });
    await SecurityEvent.deleteMany({ userId: id }, { session });
    await WebAuthnChallenge.deleteMany({ userId: id }, { session });
    const owned = await Workspace.find({ ownerId: id, personal: true }).session(session).select("_id");
    const ids = owned.map((workspace) => workspace._id);
    await Membership.deleteMany({ $or: [{ userId: id }, { workspaceId: { $in: ids } }] }, { session });
    await Workspace.deleteMany({ _id: { $in: ids } }, { session });
    await User.deleteOne({ _id: id }, { session });
  });
}

// src/routes/dashboard.ts
import { Router } from "express";
import "mongoose";

// src/data/tenant.ts
function currentTenant(req) {
  if (!req.tenant) throw new HttpError(401, "Sign in to continue.");
  return req.tenant;
}
function assertRole(tenant, minimum) {
  if (!roleAtLeast(tenant.role, minimum)) {
    throw new HttpError(403, "You do not have permission to change this workspace.");
  }
}

// src/routes/dashboard.ts
var OPEN_LIMIT = 40;
async function dashboardPayload(tenant) {
  const db = bind(tenant);
  const projects = await db.projects.find({ status: "active" }).select("name description").sort({ updatedAt: -1 }).lean();
  const activeIds = projects.map((project) => project._id);
  const datedFilter = {
    completed: false,
    projectId: { $in: activeIds },
    dueDate: { $gte: "0000-01-01" }
  };
  const [counts, dated, undated, datedOpenCount] = await Promise.all([
    db.tasks.aggregate([
      { $group: { _id: { projectId: "$projectId", completed: "$completed" }, n: { $sum: 1 } } }
    ]),
    db.tasks.find(datedFilter).select("title dueDate priority projectId").sort({ dueDate: 1, title: 1 }).limit(OPEN_LIMIT * 2).lean(),
    db.tasks.find({ completed: false, projectId: { $in: activeIds }, dueDate: null }).select("title dueDate priority projectId").sort({ title: 1 }).limit(OPEN_LIMIT).lean(),
    db.tasks.find(datedFilter).countDocuments()
  ]);
  const names = new Map(projects.map((project) => [project._id.toString(), project.name]));
  const tally = /* @__PURE__ */ new Map();
  for (const row of counts) {
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
  const open = [...dated, ...undated].flatMap((task) => {
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
  return {
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
    openTaskCount,
    datedOpenCount
  };
}
function dashboardForUser(user) {
  const claims = ownerClaims(user);
  if (!claims || !user.id) return Promise.resolve(null);
  return dashboardPayload({ userId: user.id, workspaceId: claims.workspaceId, role: claims.role });
}
function dashboardRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await dashboardPayload(currentTenant(req)));
    })
  );
  return router;
}

// src/data/users.ts
var SECRET = "+passwordHash +totpSecret +recoveryCodes";
var users = {
  byEmail(email2) {
    return User.findOne({ email: email2 });
  },
  byEmailSecret(email2) {
    return User.findOne({ email: email2 }).select(SECRET);
  },
  byId(id) {
    return User.findById(id);
  },
  byIdSecret(id) {
    return User.findById(id).select(SECRET);
  },
  byGoogle(googleId) {
    return User.findOne({ googleId });
  },
  create(doc) {
    return User.create(doc);
  },
  update(id, update) {
    return User.findByIdAndUpdate(id, update, { new: true });
  }
};

// src/hibp.ts
import { createHash as createHash2 } from "node:crypto";
var RANGE = "https://api.pwnedpasswords.com/range/";
var HIBP_TIMEOUT_MS = 1500;
async function passwordIsBreached(password2, fetchImpl = fetch, timeoutMs = HIBP_TIMEOUT_MS) {
  if (process.env.NODE_ENV === "test" && fetchImpl === fetch) return false;
  const digest = createHash2("sha1").update(password2).digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetchImpl(`${RANGE}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "align-password-check" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return false;
    const body = await response.text();
    for (const line of body.split("\n")) {
      const [hash, count] = line.trim().split(":");
      if (hash === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function assertPasswordNotBreached(password2, fetchImpl = fetch) {
  if (await passwordIsBreached(password2, fetchImpl)) {
    throw new HttpError(400, "This password has appeared in a data breach. Choose a different one.");
  }
}
async function noteBreachedPassword(userId, password2, fetchImpl = fetch) {
  if (!await passwordIsBreached(password2, fetchImpl)) return;
  const existing = await SecurityEvent.exists({ userId, type: "password-breached" });
  if (existing) return;
  await recordSecurity({
    userId,
    type: "password-breached",
    summary: "This password has appeared in a data breach. Change your password."
  });
}
function watchBreachedPassword(userId, password2, fetchImpl = fetch) {
  void noteBreachedPassword(userId, password2, fetchImpl).catch(() => void 0);
}

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
async function hit(key) {
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
  return doc?.count ?? 1;
}
async function delayFailedAttempt(count) {
  if (process.env.NODE_ENV === "test" || count <= 2) return;
  const delay = Math.min(5e3, (count - 2) * 250);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
async function enforceAuthLimit(route, ip, email2) {
  const max = process.env.NODE_ENV === "production" ? PRODUCTION_MAX[route] : 1e3;
  const keys = [`${route}:ip:${ip || "unknown"}`];
  if (email2) keys.push(`${route}:email:${email2}`);
  const counts = await Promise.all(keys.map((key) => hit(key)));
  const count = Math.max(0, ...counts);
  if (count > max) {
    throw new HttpError(429, "Too many attempts. Try again later.", { headers: { "Retry-After": "60" } });
  }
  return count;
}

// src/serialize.ts
function docId(doc) {
  return doc.id || doc._id.toString();
}
function versionOf(doc) {
  return typeof doc.__v === "number" ? doc.__v : 0;
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accent: user.accent || "#171717",
    emailVerified: user.emailVerifiedAt !== null,
    totpEnabled: Boolean(user.totpEnabledAt),
    createdAt: user.createdAt.toISOString()
  };
}
function publicProject(project) {
  return {
    id: docId(project),
    name: project.name,
    description: project.description,
    status: project.status,
    version: versionOf(project),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}
function publicLabel(label) {
  return {
    id: docId(label),
    name: label.name,
    color: label.color,
    version: versionOf(label),
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
    version: versionOf(task),
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
    projectId: item.projectId ? item.projectId.toString() : "",
    taskId: item.taskId ? item.taskId.toString() : "",
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
    version: versionOf(note),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString()
  };
}

// src/tokens.ts
import { randomBytes as randomBytes3 } from "node:crypto";
var HOUR_MS = 60 * 60 * 1e3;
async function issueAuthToken(userId, type) {
  const token = randomBytes3(32).toString("hex");
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
var MEDIUM_PASSWORD_HINT = "Use 10+ characters. Under 10, mix at least two of lowercase, uppercase, numbers, and symbols \u2014 three if under 8.";
var MEDIUM_PASSWORD_MESSAGE = MEDIUM_PASSWORD_HINT;
function passwordScore(password2) {
  if (!password2) return 0;
  const lower = password2.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password2)) return 0;
  let score = 0;
  if (password2.length >= 8) score += 1;
  if (password2.length >= 12) score += 1;
  const classes = Number(/[a-z]/.test(password2)) + Number(/[A-Z]/.test(password2)) + Number(/\d/.test(password2)) + Number(/[^A-Za-z0-9]/.test(password2));
  if (classes >= 2) score += 1;
  if (classes >= 3) score += 1;
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|qwer|asdf|zxcv|abcd)/i.test(password2) && password2.length < 12) {
    score = Math.min(score, 1);
  }
  return Math.min(4, score);
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
var sessionRenameSchema = z.object({
  name: text("Device name", 80)
});
var totpCodeSchema = z.object({
  code: z.string({ required_error: "Enter the 6-digit code." }).trim().regex(/^\d{6}$/, "Enter the 6-digit code.")
});
var mfaSchema = z.object({
  code: z.string({ required_error: "Enter a code." }).trim().min(6, "Enter a code.").max(32, "Enter a code."),
  method: z.enum(["totp", "recovery"])
});
var emailChangeSchema = z.object({
  email,
  password: z.string().min(1, "Confirm it is you to continue.").max(128, "Confirm it is you to continue.")
});
var stepUpSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  code: z.string().trim().min(6).max(32).optional(),
  method: z.enum(["password", "totp", "recovery"]).optional()
});
var workspaceCreateSchema = z.object({
  name: text("Workspace name", 80)
});
var memberSchema = z.object({
  email,
  role: z.enum(["admin", "member", "viewer"])
});
var memberRoleSchema = z.object({
  role: z.enum(["admin", "member", "viewer"])
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
  const router = Router2();
  router.get("/providers", (_req, res) => {
    res.json({ google: googleConfigured() });
  });
  router.post(
    "/register",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(registerSchema, req.body);
      await enforceAuthLimit("register", clientIp(req), input.email);
      await assertPasswordNotBreached(input.password);
      const existing = await users.byEmail(input.email);
      if (existing) throw new HttpError(409, "An account with this email already exists.");
      const user = await users.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: null
      });
      await ensurePersonalWorkspace(user.id);
      const verifyToken = await issueAuthToken(user.id, "verify");
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(verifyToken)}`;
      const mailed = await sendOrReveal(
        user.email,
        "Verify your Align email",
        `Confirm your email by opening this link within 24 hours:
${link}`
      );
      const started = await startSession(req, res, user.id);
      res.status(201).json(mailed ? { ...publicUser(user), newDevice: started.newDevice } : { ...publicUser(user), verifyToken, newDevice: started.newDevice });
    })
  );
  router.post(
    "/login",
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body);
      const [attempts, user] = await Promise.all([
        enforceAuthLimit("login", clientIp(req), input.email),
        users.byEmailSecret(input.email)
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
          await recordSecurity({
            userId: user.id,
            type: "sign-in-failed",
            summary: "A sign-in attempt used the wrong password.",
            ...requestAudit(req)
          }).catch(() => void 0);
        }
        await delayFailedAttempt(attempts);
        throw new HttpError(401, "Email or password is incorrect.");
      }
      if (user.totpEnabledAt) {
        const pending = signJwt({ sub: user.id, typ: "pending" }, "5m");
        res.cookie("pending", pending, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 5 * 60 * 1e3
        });
        res.json({ mfaRequired: true, methods: ["totp", "recovery", "passkey"] });
        void watchBreachedPassword(user.id, input.password);
        return;
      }
      if (user.failedLogins || user.lockUntil) {
        user.failedLogins = 0;
        user.lockUntil = null;
        await user.save();
      }
      const [started, dashboard] = await Promise.all([
        startSession(req, res, user.id, ownerClaims(user)),
        dashboardForUser(user)
      ]);
      res.json({
        ...publicUser(user),
        newDevice: started.newDevice,
        ...dashboard ? { dashboard } : {}
      });
      void recordSecurity({
        userId: user.id,
        type: "sign-in",
        summary: "Signed in with a password.",
        ...requestAudit(req)
      });
      void watchBreachedPassword(user.id, input.password);
    })
  );
  router.get(
    "/session",
    asyncHandler(async (req, res) => {
      const access = accessFromRequest(req);
      if (access) {
        const session = await loadSession(access.sid);
        const current = session && !session.revokedAt && !session.replacedBy && !sessionExpired(session) && session.userId.toString() === access.userId;
        if (current) {
          const user2 = await users.byId(access.userId);
          res.json({ user: user2 ? publicUser(user2) : null });
          return;
        }
      }
      const user = await rotateRefresh(req, res);
      res.json({ user: user ? publicUser(user) : null });
    })
  );
  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const user = await rotateRefresh(req, res);
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
      const user = await users.byEmail(input.email);
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
      await assertPasswordNotBreached(input.password);
      const user = userId ? await users.byIdSecret(userId) : null;
      if (!user) throw new HttpError(400, "This reset link is invalid or has expired.");
      user.passwordHash = await hashPassword(input.password);
      user.failedLogins = 0;
      user.lockUntil = null;
      await user.save();
      await revokeSessions(user.id);
      await ensurePersonalWorkspace(user.id);
      await startSession(req, res, user.id);
      await recordSecurity({ userId: user.id, type: "password-reset", summary: "Password was reset.", ...requestAudit(req) });
      res.json(publicUser(user));
    })
  );
  router.post(
    "/verify",
    asyncHandler(async (req, res) => {
      const input = parseBody(verifySchema, req.body);
      const userId = await consumeAuthToken(input.token, "verify");
      const user = userId ? await users.byId(userId) : null;
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
      const user = await users.byId(currentUserId(req));
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
      const sessions = await listActiveSessions(currentUserId(req));
      res.json(
        sessions.map((session) => ({
          id: session._id.toString(),
          current: session._id.toString() === req.sessionId,
          device: session.deviceName || deviceLabel(session.userAgent || ""),
          ip: session.ipCoarse || "",
          location: session.location || "",
          lastSeenAt: session.lastSeenAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          idleExpiresAt: new Date(session.lastSeenAt.getTime() + IDLE_MS).toISOString()
        }))
      );
    })
  );
  router.delete(
    "/sessions/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = await revokeSessionById(currentUserId(req), req.params.id);
      if (!session) throw new HttpError(404, "Session not found.");
      session.revokedAt = /* @__PURE__ */ new Date();
      await session.save();
      await recordSecurity({
        userId: currentUserId(req),
        type: "session-revoked",
        summary: "A session was revoked.",
        ...requestAudit(req)
      });
      if (session.id === req.sessionId) clearSession(res);
      res.status(204).send();
    })
  );
  router.post(
    "/sessions/revoke-all",
    requireAuth,
    asyncHandler(async (req, res) => {
      await requireFreshStepUp(req.sessionId);
      await revokeSessions(currentUserId(req));
      await recordSecurity({
        userId: currentUserId(req),
        type: "sessions-revoked",
        summary: "Every session was revoked.",
        ...requestAudit(req)
      });
      clearSession(res);
      res.status(204).send();
    })
  );
  router.get(
    "/google",
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) throw new HttpError(404, "Google sign-in is not configured.");
      const state = signJwt({ typ: "google" }, "10m");
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
        const payload = verifyJwt(state);
        if (!payload || payload.typ !== "google" || !code) {
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
      let user = await users.byGoogle(profile.sub);
      if (!user) user = await users.byEmail(email2);
      if (user) {
        if (!user.googleId) user.googleId = profile.sub;
        if (!user.emailVerifiedAt) user.emailVerifiedAt = /* @__PURE__ */ new Date();
        await user.save();
      } else {
        user = await users.create({
          name: (profile.name || email2.split("@")[0] || "Align").slice(0, 80),
          email: email2,
          passwordHash: await hashPassword(randomBytes4(32).toString("hex")),
          emailVerifiedAt: /* @__PURE__ */ new Date(),
          googleId: profile.sub
        });
      }
      await ensurePersonalWorkspace(user.id);
      await startSession(req, res, user.id);
      res.redirect("/");
    })
  );
  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json({ ...publicUser(user), totpEnabled: Boolean(user.totpEnabledAt) });
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
      const user = await users.update(currentUserId(req), update);
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json(publicUser(user));
    })
  );
  router.post(
    "/email",
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(emailChangeSchema, req.body);
      const userId = currentUserId(req);
      await requireFreshStepUp(req.sessionId);
      const secret = await users.byIdSecret(userId);
      if (!secret?.passwordHash || !await checkPassword(input.password, secret.passwordHash)) {
        throw new HttpError(400, "Current password is incorrect.");
      }
      const next = input.email.trim().toLowerCase();
      const taken = await users.byEmail(next);
      if (taken && taken.id !== userId) throw new HttpError(409, "An account already uses that email.");
      const user = await users.update(userId, { email: next, emailVerifiedAt: null });
      if (!user) throw new HttpError(401, "Sign in to continue.");
      await recordSecurity({
        userId,
        type: "email-changed",
        summary: "The account email was changed.",
        ...requestAudit(req)
      });
      const token = await issueAuthToken(user.id, "verify");
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(token)}`;
      const mailed = await sendOrReveal(
        user.email,
        "Verify your new Align email",
        `Confirm this email by opening this link within one hour:
${link}`
      );
      res.json({ ...publicUser(user), ...mailed ? {} : { verifyToken: token } });
    })
  );
  router.post(
    "/password",
    limiter,
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(passwordSchema, req.body);
      await requireFreshStepUp(req.sessionId);
      const user = await users.byIdSecret(currentUserId(req));
      if (!user?.passwordHash) throw new HttpError(401, "Sign in to continue.");
      const matches = await checkPassword(input.currentPassword, user.passwordHash);
      if (!matches) throw new HttpError(400, "Current password is incorrect.");
      await assertPasswordNotBreached(input.newPassword);
      user.passwordHash = await hashPassword(input.newPassword);
      await user.save();
      await revokeSessions(user.id, req.sessionId);
      await recordSecurity({
        userId: user.id,
        type: "password-changed",
        summary: "Password was changed.",
        ...requestAudit(req)
      });
      await rotateRefresh(req, res);
      res.status(204).send();
    })
  );
  router.delete(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      await requireFreshStepUp(req.sessionId);
      await deleteAccount(userId);
      clearSession(res);
      res.status(204).send();
    })
  );
  router.patch(
    "/sessions/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(sessionRenameSchema, req.body);
      const session = await renameSession(currentUserId(req), req.params.id, input.name);
      if (!session) throw new HttpError(404, "Session not found.");
      await recordSecurity({
        userId: currentUserId(req),
        type: "session-renamed",
        summary: `A session was renamed to ${input.name}.`,
        ...requestAudit(req)
      });
      res.json({ id: session.id, device: session.deviceName });
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
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    type: input.type,
    summary: input.summary.slice(0, 240)
  });
}

// src/concurrency.ts
function expectedVersion(req) {
  const raw = req.get("If-Match");
  if (!raw) return void 0;
  const value = raw.trim();
  if (value === "*") return "*";
  const match = /^(?:W\/)?"(\d+)"$/.exec(value);
  if (!match) throw new HttpError(400, "If-Match must be a version.");
  return Number(match[1]);
}
function assertVersion(current, expected) {
  if (expected === void 0 || expected === "*") return;
  if ((current ?? 0) !== expected) throw new HttpError(409, CONFLICT_MESSAGE);
}
function stampVersion(res, version) {
  if (res.get("ETag")) return;
  res.set("ETag", `W/"${version ?? 0}"`);
}

// src/routes/labels.ts
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function labelsRouter() {
  const router = Router3();
  router.use(requireAuth, requireWriter);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const labels = await bind(currentTenant(req)).labels.find().select("name color createdAt __v").sort({ name: 1 }).lean();
      res.json(labels.map(publicLabel));
    })
  );
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const input = parseBody(labelCreateSchema, req.body);
      const duplicate = await db.labels.findOne({ name: new RegExp(`^${escapeRegExp(input.name)}$`, "i") });
      if (duplicate) throw new HttpError(409, "A label with that name already exists.");
      const label = await db.labels.create({ name: input.name, color: input.color.toLowerCase() });
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        type: "create",
        summary: `Created label ${quoteTitle(label.name)}`
      });
      stampVersion(res, label.__v);
      res.status(201).json(publicLabel(label));
    })
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const labelId = objectId(req.params.id);
      if (!labelId) throw new HttpError(404, "Label not found.");
      const label = await db.labels.findOne({ _id: labelId });
      if (!label) throw new HttpError(404, "Label not found.");
      assertVersion(label.__v, expectedVersion(req));
      const input = parseBody(labelPatchSchema, req.body);
      if (input.name !== void 0 && input.name.toLowerCase() !== label.name.toLowerCase()) {
        const duplicate = await db.labels.findOne({ name: new RegExp(`^${escapeRegExp(input.name)}$`, "i") });
        if (duplicate) throw new HttpError(409, "A label with that name already exists.");
        label.name = input.name;
      }
      if (input.color !== void 0) label.color = input.color.toLowerCase();
      await label.save();
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        type: "update",
        summary: `Updated label ${quoteTitle(label.name)}`
      });
      stampVersion(res, label.__v);
      res.json(publicLabel(label));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const labelId = objectId(req.params.id);
      if (!labelId) throw new HttpError(404, "Label not found.");
      const label = await db.labels.findOne({ _id: labelId });
      if (!label) throw new HttpError(404, "Label not found.");
      await db.tasks.updateMany({ labelIds: label._id }, { $pull: { labelIds: label._id } });
      const name = label.name;
      await label.deleteOne();
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
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
  router.use(requireAuth, requireWriter);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req));
      const projectIds = await db.activeProjectIds();
      const notes = await db.notes.find({ projectId: { $in: projectIds } }).select("projectId title body createdAt updatedAt __v").sort({ updatedAt: -1 }).lean();
      res.json(notes.map(publicNote));
    })
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const note = await bind(currentTenant(req)).requireNote(req.params.id);
      stampVersion(res, note.__v);
      res.json(publicNote(note));
    })
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const note = await db.requireNote(req.params.id);
      assertVersion(note.__v, expectedVersion(req));
      const input = parseBody(notePatchSchema, req.body);
      if (input.title !== void 0) note.title = input.title;
      if (input.body !== void 0) note.body = input.body;
      await note.save();
      await db.touchProject(note.projectId);
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: note.projectId,
        type: "update",
        summary: `Updated note ${quoteTitle(note.title)}`
      });
      stampVersion(res, note.__v);
      res.json(publicNote(note));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const note = await db.requireNote(req.params.id);
      const projectId = note.projectId;
      const title = note.title;
      await note.deleteOne();
      await db.touchProject(projectId);
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
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
import { Types as Types6 } from "mongoose";

// src/dates.ts
function shiftISODate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// src/page.ts
import { Types as Types5 } from "mongoose";
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
  return new Types5.ObjectId(value);
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
async function dueRows(tenant, today) {
  const db = bind(tenant);
  const tomorrow = shiftISODate(today, 1);
  const tasks = await db.tasks.find({
    completed: false,
    dueDate: { $gte: "0000-01-01", $lte: tomorrow }
  }).select("title dueDate projectId").lean();
  const projectIds = [...new Set(tasks.map((task) => task.projectId.toString()))];
  const keys = tasks.flatMap((task) => {
    if (!task.dueDate || task.dueDate === today) return [];
    const kind = task.dueDate < today ? "overdue" : "due-soon";
    return [`${task._id.toString()}:${kind}:${task.dueDate}`];
  });
  const [projects, stored] = await Promise.all([
    projectIds.length === 0 ? Promise.resolve([]) : db.projects.find({ _id: { $in: projectIds } }).select("name").lean(),
    keys.length === 0 ? Promise.resolve([]) : db.notifications.find({ key: { $in: keys } }).select("key read createdAt").lean()
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
  const router = Router5();
  router.use(requireAuth, requireWriter);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const today = requireToday(req.query.today);
      const tenant = currentTenant(req);
      const [rows, devices] = await Promise.all([
        dueRows(tenant, today),
        bind(tenant).notifications.find({ kind: "new-device" }).sort({ createdAt: -1 }).limit(20).lean()
      ]);
      const listed = [
        ...rows.map(present),
        ...devices.map((item) => ({
          id: item._id.toString(),
          projectId: "",
          taskId: "",
          kind: "new-device",
          title: item.title,
          projectName: item.projectName ?? "",
          dueDate: "",
          read: item.read,
          createdAt: item.createdAt.toISOString()
        }))
      ];
      listed.sort((a, b) => a.createdAt === b.createdAt ? a.id < b.id ? 1 : -1 : a.createdAt < b.createdAt ? 1 : -1);
      const cursor = decodeCursor(req.query.cursor);
      const filtered = cursor && cursor.length === 2 ? listed.filter((row) => row.createdAt < cursor[0] || row.createdAt === cursor[0] && row.id < cursor[1]) : listed;
      const limit = pageLimit(req.query.limit);
      const page = filtered.slice(0, limit);
      const last = page[limit - 1];
      if (filtered.length > limit && last) res.set("X-Next-Cursor", encodeCursor([last.createdAt, last.id]));
      res.json(page);
    })
  );
  router.post(
    "/read-all",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const userId = tenant.userId;
      const today = typeof req.query.today === "string" && req.query.today ? requireToday(req.query.today) : null;
      if (today) {
        const rows = await dueRows(tenant, today);
        const userObjectId = new Types6.ObjectId(userId);
        const expireAt = new Date(Date.now() + NINETY_DAYS_MS2);
        if (rows.length > 0) {
          await db.notifications.bulkWrite(
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
      await db.notifications.updateMany({ read: false }, { read: true });
      res.status(204).send();
    })
  );
  router.post(
    "/:id/read",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const userId = tenant.userId;
      const id = objectId(req.params.id);
      if (id) {
        const item2 = await db.notifications.findOneAndUpdate({ _id: id }, { read: true }, { new: true });
        if (!item2) throw new HttpError(404, "Notification not found.");
        res.json(publicNotification(item2));
        return;
      }
      const match = KEY.exec(req.params.id);
      if (!match) throw new HttpError(404, "Notification not found.");
      const taskId = match[1] ?? "";
      const kind = match[2];
      const dueDate2 = match[3] ?? "";
      const task = await db.tasks.findOne({ _id: taskId, completed: false, dueDate: dueDate2 }).select("title projectId dueDate");
      if (!task?.dueDate) throw new HttpError(404, "Notification not found.");
      const project = await db.projects.find({ _id: task.projectId }).select("name");
      const named = project[0];
      if (!named) throw new HttpError(404, "Notification not found.");
      const item = await db.notifications.findOneAndUpdate(
        { userId, key: req.params.id },
        {
          $set: { read: true, title: task.title, projectName: named.name },
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
import { Router as Router6 } from "express";
function isDuplicateKey(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11e3;
}
function projectsRouter() {
  const router = Router6();
  router.use(requireAuth, requireWriter);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req));
      const status = req.query.status;
      const filter = {};
      if (status !== void 0) {
        if (status !== "active" && status !== "archived") {
          res.status(400).json({ error: "Status must be active or archived." });
          return;
        }
        filter.status = status;
      }
      const projects = await db.projects.find(filter).select("name description status createdAt updatedAt __v").sort({ updatedAt: -1 }).lean();
      res.json(projects.map(publicProject));
    })
  );
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const input = parseBody(projectCreateSchema, req.body);
      const project = await db.projects.create({
        name: input.name,
        description: input.description ?? "",
        status: "active"
      });
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: "create",
        summary: `Created project ${quoteTitle(project.name)}`
      });
      stampVersion(res, project.__v);
      res.status(201).json(publicProject(project));
    })
  );
  router.get(
    "/:id/tasks",
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req));
      const project = await db.requireProject(req.params.id);
      const limit = pageLimit(req.query.limit);
      const cursor = afterTaskCursor(req.query.cursor);
      const base = { projectId: project._id };
      const tasks = await db.tasks.find(cursor ? { $and: [base, afterTaskFilter(cursor)] } : base).select("projectId title completed dueDate priority labelIds plannedFor completedOn order createdAt updatedAt __v").sort({ order: 1, createdAt: 1, _id: 1 }).limit(limit + 1).lean();
      const next = nextTaskCursor(tasks, limit);
      if (next) res.set("X-Next-Cursor", next);
      res.json(tasks.slice(0, limit).map(publicTask));
    })
  );
  router.post(
    "/:id/tasks",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const input = parseBody(taskCreateSchema, req.body);
      if (input.clientId) {
        const existing = await db.tasks.findOne({ userId: db.userId, clientId: input.clientId });
        if (existing) {
          res.json(publicTask(existing));
          return;
        }
      }
      const project = await db.requireProject(req.params.id);
      const dueDate2 = normalizeDueDate(input.dueDate) ?? null;
      const labelIds2 = await db.ownedLabelIds(input.labelIds ?? []);
      const latest = await db.tasks.findOne({ projectId: project._id }).sort({ order: -1 }).select("order");
      try {
        const task = await db.tasks.create({
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
        await db.touchProject(project._id);
        await recordActivity({
          userId: tenant.userId,
          workspaceId: tenant.workspaceId,
          projectId: project._id,
          type: "create",
          summary: `Created task ${quoteTitle(task.title)}`
        });
        stampVersion(res, task.__v);
        res.status(201).json(publicTask(task));
      } catch (error) {
        if (input.clientId && isDuplicateKey(error)) {
          const existing = await db.tasks.findOne({ userId: db.userId, clientId: input.clientId });
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
      const db = bind(currentTenant(req));
      const project = await db.requireProject(req.params.id);
      const notes = await db.notes.find({ projectId: project._id }).select("projectId title body createdAt updatedAt __v").sort({ updatedAt: -1 }).lean();
      res.json(notes.map(publicNote));
    })
  );
  router.post(
    "/:id/notes",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const project = await db.requireProject(req.params.id);
      const input = parseBody(noteCreateSchema, req.body);
      const note = await db.notes.create({
        projectId: project._id,
        title: input.title ? input.title : "Untitled",
        body: input.body ?? ""
      });
      await db.touchProject(project._id);
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: "create",
        summary: `Created note ${quoteTitle(note.title)}`
      });
      stampVersion(res, note.__v);
      res.status(201).json(publicNote(note));
    })
  );
  router.get(
    "/:id/whiteboard",
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req));
      const project = await db.requireProject(req.params.id);
      const board = await db.whiteboards.findOne({ projectId: project._id }).select("scene").lean();
      res.json({ scene: board?.scene ?? emptyScene });
    })
  );
  router.put(
    "/:id/whiteboard",
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req));
      const project = await db.requireProject(req.params.id);
      const scene = parseBody(whiteboardSceneSchema, req.body?.scene ?? req.body);
      const board = await db.whiteboards.save(project._id, scene);
      res.json({ scene: board?.scene ?? scene });
    })
  );
  router.get(
    "/:id/activity",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const project = await db.requireProject(req.params.id);
      const limit = pageLimit(req.query.limit);
      const cursor = beforeCursor(req.query.cursor);
      const scope = { userId: db.userId, $or: [{ projectId: project._id }, { projectId: null }] };
      const items = await db.activity.find(cursor ? { $and: [scope, beforeFilter(cursor)] } : scope).select("projectId type summary createdAt").sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
      const next = nextDateCursor(items, limit);
      if (next) res.set("X-Next-Cursor", next);
      res.json(items.slice(0, limit).map(publicActivity));
    })
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const project = await bind(currentTenant(req)).requireProject(req.params.id);
      stampVersion(res, project.__v);
      res.json(publicProject(project));
    })
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const project = await db.requireProject(req.params.id);
      assertVersion(project.__v, expectedVersion(req));
      const input = parseBody(projectPatchSchema, req.body);
      if (input.name !== void 0) project.name = input.name;
      if (input.description !== void 0) project.description = input.description;
      await project.save();
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: "update",
        summary: `Updated project ${quoteTitle(project.name)}`
      });
      stampVersion(res, project.__v);
      res.json(publicProject(project));
    })
  );
  router.patch(
    "/:id/archive",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const project = await db.requireProject(req.params.id);
      assertVersion(project.__v, expectedVersion(req));
      project.status = project.status === "active" ? "archived" : "active";
      await project.save();
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: "update",
        summary: project.status === "archived" ? `Archived project ${quoteTitle(project.name)}` : `Restored project ${quoteTitle(project.name)}`
      });
      stampVersion(res, project.__v);
      res.json(publicProject(project));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req));
      const project = await db.requireProject(req.params.id);
      await db.softDeleteProject(project);
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/search.ts
import { Router as Router7 } from "express";
var RESULT_LIMIT = 20;
var CANDIDATE_LIMIT = 60;
var TIME_MS = 800;
function queryText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 200);
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function tokenFilter(tokens) {
  return {
    $and: tokens.map((token) => ({ searchWords: { $regex: `^${escapeRegExp2(token)}` } }))
  };
}
function byScore(items) {
  return [...items].sort((a, b) => b.score - a.score).slice(0, RESULT_LIMIT);
}
function searchRouter() {
  const router = Router7();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const tokens = searchTokens(queryText(req.query.q));
      if (!tokens) {
        res.json({ projects: [], tasks: [], notes: [] });
        return;
      }
      await ensureSearchWords();
      const db = bind(currentTenant(req));
      const filter = tokenFilter(tokens);
      const [projects, tasks, notes] = await Promise.all([
        db.projects.find(filter).select("name description status createdAt updatedAt __v").limit(CANDIDATE_LIMIT).maxTimeMS(TIME_MS).lean(),
        db.tasks.find(filter).select("projectId title completed").limit(CANDIDATE_LIMIT).maxTimeMS(TIME_MS).lean(),
        db.notes.find(filter).select("projectId title body").limit(CANDIDATE_LIMIT).maxTimeMS(TIME_MS).lean()
      ]);
      const projectIds = [...new Set([...tasks, ...notes].map((item) => item.projectId.toString()))];
      const named = projectIds.length === 0 ? [] : await db.projects.find({ _id: { $in: projectIds } }).select("name").maxTimeMS(TIME_MS).lean();
      const names = new Map(named.map((project) => [project._id.toString(), project.name]));
      const rankedProjects = byScore(
        projects.map((project) => ({
          project,
          score: relevanceScore(tokens, [
            { text: project.name, weight: 5 },
            { text: project.description, weight: 1 }
          ])
        }))
      );
      const rankedTasks = byScore(
        tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString());
          if (!projectName) return [];
          return [
            {
              task,
              projectName,
              score: relevanceScore(tokens, [{ text: task.title, weight: 5 }])
            }
          ];
        })
      );
      const rankedNotes = byScore(
        notes.flatMap((note) => {
          const projectName = names.get(note.projectId.toString());
          if (!projectName) return [];
          return [
            {
              note,
              projectName,
              score: relevanceScore(tokens, [
                { text: note.title, weight: 5 },
                { text: note.body, weight: 1 }
              ])
            }
          ];
        })
      );
      res.json({
        projects: rankedProjects.map((item) => publicProject(item.project)),
        tasks: rankedTasks.map((item) => ({
          id: item.task._id.toString(),
          projectId: item.task.projectId.toString(),
          projectName: item.projectName,
          title: item.task.title,
          completed: item.task.completed
        })),
        notes: rankedNotes.map((item) => ({
          id: item.note._id.toString(),
          projectId: item.note.projectId.toString(),
          projectName: item.projectName,
          title: item.note.title,
          body: item.note.body
        }))
      });
    })
  );
  return router;
}

// src/routes/tasks.ts
import { Router as Router8 } from "express";
function tasksRouter() {
  const router = Router8();
  router.use(requireAuth, requireWriter);
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const task = await db.requireTask(req.params.id);
      assertVersion(task.__v, expectedVersion(req));
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
      if (input.labelIds !== void 0) task.labelIds = await db.ownedLabelIds(input.labelIds);
      if (input.plannedFor !== void 0) task.plannedFor = normalizeDueDate(input.plannedFor) ?? null;
      if (input.order !== void 0) task.order = input.order;
      await task.save();
      await db.touchProject(task.projectId);
      const finished = !wasCompleted && task.completed;
      if (!planningOnly) {
        await recordActivity({
          userId: tenant.userId,
          workspaceId: tenant.workspaceId,
          projectId: task.projectId,
          type: finished ? "complete" : "update",
          summary: finished ? `Completed task ${quoteTitle(task.title)}` : `Updated task ${quoteTitle(task.title)}`
        });
      }
      if (task.completed) await db.notifications.deleteMany({ taskId: task._id, kind: "overdue" });
      stampVersion(res, task.__v);
      res.json(publicTask(task));
    })
  );
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      const db = bind(tenant);
      const task = await db.requireTask(req.params.id);
      const projectId = task.projectId;
      const title = task.title;
      await db.notifications.deleteMany({ taskId: task._id });
      await db.softDeleteTask(task);
      await db.touchProject(projectId);
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId,
        type: "delete",
        summary: `Deleted task ${quoteTitle(title)}`
      });
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/mfa.ts
import { Router as Router9 } from "express";
import QRCode from "qrcode";

// src/data/factors.ts
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";

// src/totp.ts
import { createHmac, randomBytes as randomBytes5, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var STEP_SECONDS = 30;
var DIGITS = 6;
function generateTotpSecret() {
  return base32Encode(randomBytes5(20));
}
function totpAt(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = (hmac.readUInt32BE(offset) & 2147483647) % 10 ** DIGITS;
  return binary.toString().padStart(DIGITS, "0");
}
function verifyTotp(secret, token, now = Date.now(), window = 1) {
  const trimmed = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  const counter = Math.floor(now / 1e3 / STEP_SECONDS);
  for (let delta = -window; delta <= window; delta += 1) {
    const expected = totpAt(secret, counter + delta);
    if (safeEqual2(expected, trimmed)) return true;
  }
  return false;
}
function otpauthUrl(secret, email2) {
  const label = encodeURIComponent(`Align:${email2}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Align")}&algorithm=SHA1&digits=6&period=30`;
}
function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes5(5).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
function safeEqual2(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual2(a, b);
}
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[value << 5 - bits & 31];
  return output;
}
function base32Decode(secret) {
  const cleaned = secret.replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = value << 5 | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// src/data/factors.ts
var authenticators = {
  verifyRegistrationResponse,
  verifyAuthenticationResponse
};
function recoveryHash(code) {
  return hashToken(code.replace(/\s+/g, "").toLowerCase());
}
function webAuthnConfig(req) {
  const headerOrigin = req.get("origin");
  const origin = (process.env.APP_ORIGIN || headerOrigin || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const rpID = process.env.WEBAUTHN_RP_ID || safeHost(origin);
  return { rpID, origin };
}
function safeHost(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return "localhost";
  }
}
async function beginTotp(userId, email2) {
  const user = await User.findById(userId).select("+totpSecret");
  if (!user) throw new HttpError(401, "Sign in to continue.");
  if (user.totpEnabledAt) throw new HttpError(409, "Two-factor authentication is already on.");
  const secret = generateTotpSecret();
  user.totpSecret = secret;
  await user.save();
  return { secret, otpauth: otpauthUrl(secret, email2) };
}
async function confirmTotp(userId, code) {
  const user = await User.findById(userId).select("+totpSecret +recoveryCodes");
  if (!user?.totpSecret) throw new HttpError(400, "Start two-factor setup first.");
  if (!verifyTotp(user.totpSecret, code)) throw new HttpError(400, "That code is not valid.");
  const codes = generateRecoveryCodes();
  user.set(
    "recoveryCodes",
    codes.map((value) => ({ hash: recoveryHash(value), usedAt: null }))
  );
  user.totpEnabledAt = /* @__PURE__ */ new Date();
  await user.save();
  return codes;
}
async function disableTotp(userId) {
  const user = await User.findById(userId).select("+totpSecret +recoveryCodes");
  if (!user) throw new HttpError(401, "Sign in to continue.");
  user.totpSecret = null;
  user.totpEnabledAt = null;
  user.set("recoveryCodes", []);
  await user.save();
}
async function regenerateRecoveryCodes(userId) {
  const user = await User.findById(userId).select("+recoveryCodes");
  if (!user?.totpEnabledAt) throw new HttpError(400, "Turn on two-factor authentication first.");
  const codes = generateRecoveryCodes();
  user.set(
    "recoveryCodes",
    codes.map((value) => ({ hash: recoveryHash(value), usedAt: null }))
  );
  await user.save();
  return codes;
}
async function consumeRecoveryCode(userId, code) {
  const user = await User.findById(userId).select("+recoveryCodes");
  if (!user) return false;
  const hash = recoveryHash(code);
  const match = user.recoveryCodes?.find((entry) => entry.hash === hash && !entry.usedAt);
  if (!match) return false;
  match.usedAt = /* @__PURE__ */ new Date();
  await user.save();
  return true;
}
async function userHasPasskey(userId) {
  return Boolean(await Passkey.exists({ userId }));
}
async function storeChallenge(userId, challenge, kind) {
  await WebAuthnChallenge.deleteMany({ userId, kind });
  await WebAuthnChallenge.create({
    userId,
    challenge,
    kind,
    expiresAt: new Date(Date.now() + 5 * 60 * 1e3)
  });
}
async function takeChallenge(kind, expected) {
  const found = await WebAuthnChallenge.findOne({ challenge: expected, kind, expiresAt: { $gt: /* @__PURE__ */ new Date() } });
  if (!found) throw new HttpError(400, "That passkey ceremony expired. Try again.");
  await found.deleteOne();
}
async function registrationOptions(req, userId, email2) {
  const { rpID } = webAuthnConfig(req);
  const existing = await Passkey.find({ userId }).select("credentialId transports");
  const options = await generateRegistrationOptions({
    rpName: "Align",
    rpID,
    userName: email2,
    userID: Buffer.from(userId),
    attestationType: "none",
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" }
  });
  await storeChallenge(userId, options.challenge, "register");
  return options;
}
async function verifyRegistration(req, userId, response, name) {
  const { rpID, origin } = webAuthnConfig(req);
  const challenge = response.response.clientDataJSON;
  const client = JSON.parse(Buffer.from(challenge, "base64url").toString("utf8"));
  if (!client.challenge) throw new HttpError(400, "Passkey response is invalid.");
  await takeChallenge("register", client.challenge);
  const verified = await authenticators.verifyRegistrationResponse({
    response,
    expectedChallenge: client.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false
  });
  if (!verified.verified) throw new HttpError(400, "Passkey could not be verified.");
  const credential = verified.registrationInfo.credential;
  await Passkey.create({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name: name.slice(0, 80) || "Passkey"
  });
}
async function authenticationOptions(req, userId) {
  const { rpID } = webAuthnConfig(req);
  const existing = userId ? await Passkey.find({ userId }).select("credentialId transports") : [];
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: userId ? "discouraged" : "preferred",
    allowCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports
    }))
  });
  await storeChallenge(userId ?? null, options.challenge, userId ? "stepup" : "login");
  return options;
}
async function verifyPasskey(req, response, kind) {
  const { rpID, origin } = webAuthnConfig(req);
  const client = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
  if (!client.challenge) throw new HttpError(400, "Passkey response is invalid.");
  await takeChallenge(kind, client.challenge);
  const passkey = await Passkey.findOne({ credentialId: response.id });
  if (!passkey) throw new HttpError(401, "Passkey not recognized.");
  const verified = await authenticators.verifyAuthenticationResponse({
    response,
    expectedChallenge: client.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports
    }
  });
  if (!verified.verified) throw new HttpError(401, "Passkey could not be verified.");
  passkey.counter = verified.authenticationInfo.newCounter;
  await passkey.save();
  return { userId: passkey.userId.toString() };
}
async function listPasskeys(userId) {
  return Passkey.find({ userId }).sort({ createdAt: -1 }).lean();
}
async function deletePasskey(userId, id) {
  const removed = await Passkey.deleteOne({ _id: id, userId });
  return removed.deletedCount === 1;
}
async function listSecurityEvents(userId) {
  return SecurityEvent.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
}

// src/routes/mfa.ts
function pendingUser(req) {
  const token = readCookie(req.headers.cookie, "pending");
  const payload = token ? verifyJwt(token) : null;
  if (!payload || payload.typ !== "pending" || typeof payload.sub !== "string") {
    throw new HttpError(401, "Sign in to continue.");
  }
  return payload.sub;
}
async function noteStepUp(req, userId, summary) {
  if (req.sessionId) await markStepUp(req.sessionId);
  await recordSecurity({
    userId,
    type: "step-up",
    summary,
    ...requestAudit(req)
  });
}
function mfaRouter() {
  const router = Router9();
  router.post(
    "/totp/setup",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      const started = await beginTotp(user.id, user.email);
      const qr = await QRCode.toDataURL(started.otpauth);
      res.json({ secret: started.secret, otpauth: started.otpauth, qr });
    })
  );
  router.post(
    "/totp/confirm",
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(totpCodeSchema, req.body);
      const codes = await confirmTotp(currentUserId(req), input.code);
      if (req.sessionId) await markStepUp(req.sessionId);
      await recordSecurity({
        userId: currentUserId(req),
        type: "totp-enabled",
        summary: "Two-factor authentication was turned on.",
        ...requestAudit(req)
      });
      res.json({ recoveryCodes: codes });
    })
  );
  router.post(
    "/totp/disable",
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body);
      await requireFreshStepUp(req.sessionId);
      if (body.code) {
        const user = await users.byIdSecret(currentUserId(req));
        if (!user?.totpSecret || !verifyTotp(user.totpSecret, body.code)) {
          throw new HttpError(400, "That code is not valid.");
        }
      }
      await disableTotp(currentUserId(req));
      await recordSecurity({
        userId: currentUserId(req),
        type: "totp-disabled",
        summary: "Two-factor authentication was turned off.",
        ...requestAudit(req)
      });
      res.status(204).send();
    })
  );
  router.post(
    "/recovery/regenerate",
    requireAuth,
    asyncHandler(async (req, res) => {
      parseBody(stepUpSchema, req.body);
      await requireFreshStepUp(req.sessionId);
      const codes = await regenerateRecoveryCodes(currentUserId(req));
      await recordSecurity({
        userId: currentUserId(req),
        type: "recovery-regenerated",
        summary: "Recovery codes were replaced.",
        ...requestAudit(req)
      });
      res.json({ recoveryCodes: codes });
    })
  );
  router.post(
    "/login/mfa",
    asyncHandler(async (req, res) => {
      const input = parseBody(mfaSchema, req.body);
      const userId = pendingUser(req);
      const user = await users.byIdSecret(userId);
      if (!user) throw new HttpError(401, "Sign in to continue.");
      const ok = input.method === "totp" ? Boolean(user.totpSecret && verifyTotp(user.totpSecret, input.code)) : await consumeRecoveryCode(user.id, input.code);
      if (!ok) {
        await recordSecurity({
          userId: user.id,
          type: "mfa-failed",
          summary: "A two-factor code was rejected.",
          ...requestAudit(req)
        });
        throw new HttpError(401, "That code is not valid.");
      }
      res.clearCookie("pending", { path: "/" });
      await ensurePersonalWorkspace(user.id);
      const fresh = await users.byId(user.id) ?? user;
      const [started, dashboard] = await Promise.all([
        startSession(req, res, user.id),
        dashboardForUser(fresh)
      ]);
      await recordSecurity({
        userId: user.id,
        type: "sign-in",
        summary: input.method === "totp" ? "Signed in with an authenticator code." : "Signed in with a recovery code.",
        ...requestAudit(req)
      });
      res.json({ ...publicUser(user), newDevice: started.newDevice, ...dashboard ? { dashboard } : {} });
    })
  );
  router.post(
    "/step-up",
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body);
      const userId = currentUserId(req);
      if (!req.sessionId) throw new HttpError(401, "Sign in to continue.");
      if (body.password) {
        const user = await users.byIdSecret(userId);
        if (!user?.passwordHash || !await checkPassword(body.password, user.passwordHash)) {
          throw new HttpError(403, "That password is not valid.");
        }
        await noteStepUp(req, userId, "Confirmed this session with a password.");
        res.status(204).send();
        return;
      }
      if (body.code && body.method !== "recovery") {
        const user = await users.byIdSecret(userId);
        if (!user?.totpSecret || !verifyTotp(user.totpSecret, body.code)) {
          throw new HttpError(400, "That code is not valid.");
        }
        await noteStepUp(req, userId, "Confirmed this session with an authenticator code.");
        res.status(204).send();
        return;
      }
      if (body.code) {
        const ok = await consumeRecoveryCode(userId, body.code);
        if (!ok) throw new HttpError(400, "That code is not valid.");
        await noteStepUp(req, userId, "Confirmed this session with a recovery code.");
        res.status(204).send();
        return;
      }
      throw new HttpError(400, "Confirm it is you to continue.");
    })
  );
  router.get(
    "/security-events",
    requireAuth,
    asyncHandler(async (req, res) => {
      const events = await listSecurityEvents(currentUserId(req));
      res.json(
        events.map((event) => ({
          id: event._id.toString(),
          type: event.type,
          summary: event.summary,
          ip: event.ipCoarse,
          device: event.device ?? "",
          deviceType: event.deviceType ?? "",
          location: event.location ?? "",
          createdAt: event.createdAt.toISOString()
        }))
      );
    })
  );
  router.post(
    "/passkeys/register/options",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json(await registrationOptions(req, user.id, user.email));
    })
  );
  router.post(
    "/passkeys/register/verify",
    requireAuth,
    asyncHandler(async (req, res) => {
      const name = typeof req.body?.name === "string" ? req.body.name : "Passkey";
      await verifyRegistration(req, currentUserId(req), req.body, name);
      await recordSecurity({
        userId: currentUserId(req),
        type: "passkey-added",
        summary: "A passkey was added.",
        ...requestAudit(req)
      });
      res.status(204).send();
    })
  );
  router.get(
    "/passkeys",
    requireAuth,
    asyncHandler(async (req, res) => {
      const passkeys = await listPasskeys(currentUserId(req));
      res.json(
        passkeys.map((passkey) => ({
          id: passkey._id.toString(),
          name: passkey.name,
          createdAt: passkey.createdAt.toISOString()
        }))
      );
    })
  );
  router.delete(
    "/passkeys/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      parseBody(stepUpSchema, req.body ?? {});
      await requireFreshStepUp(req.sessionId);
      const removed = await deletePasskey(currentUserId(req), req.params.id);
      if (!removed) throw new HttpError(404, "Passkey not found.");
      await recordSecurity({
        userId: currentUserId(req),
        type: "passkey-removed",
        summary: "A passkey was removed.",
        ...requestAudit(req)
      });
      res.status(204).send();
    })
  );
  router.post(
    "/passkeys/login/options",
    asyncHandler(async (req, res) => {
      res.json(await authenticationOptions(req));
    })
  );
  router.post(
    "/passkeys/login/verify",
    asyncHandler(async (req, res) => {
      const verified = await verifyPasskey(req, req.body, "login");
      const user = await users.byId(verified.userId);
      if (!user) throw new HttpError(401, "Sign in to continue.");
      await ensurePersonalWorkspace(user.id);
      const fresh = await users.byId(user.id) ?? user;
      const [started, dashboard] = await Promise.all([
        startSession(req, res, user.id),
        dashboardForUser(fresh)
      ]);
      await recordSecurity({
        userId: user.id,
        type: "sign-in",
        summary: "Signed in with a passkey.",
        ...requestAudit(req)
      });
      res.json({ ...publicUser(user), newDevice: started.newDevice, ...dashboard ? { dashboard } : {} });
    })
  );
  router.post(
    "/passkeys/step-up/options",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await authenticationOptions(req, currentUserId(req)));
    })
  );
  router.post(
    "/passkeys/step-up/verify",
    requireAuth,
    asyncHandler(async (req, res) => {
      const verified = await verifyPasskey(req, req.body, "stepup");
      if (verified.userId !== currentUserId(req)) throw new HttpError(401, "Passkey not recognized.");
      await noteStepUp(req, currentUserId(req), "Confirmed this session with a passkey.");
      res.status(204).send();
    })
  );
  router.get(
    "/mfa",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      res.json({ totp: Boolean(user.totpEnabledAt), passkey: await userHasPasskey(user.id) });
    })
  );
  return router;
}

// src/routes/today.ts
import { Router as Router10 } from "express";
var FIELDS = "projectId title completed dueDate priority labelIds plannedFor completedOn order createdAt updatedAt __v";
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
    version: typeof task.__v === "number" ? task.__v : 0,
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
      const db = bind(currentTenant(req));
      const [open, plannedDone, finishedOn, projects] = await Promise.all([
        db.tasks.find({ completed: false }).select(FIELDS).lean(),
        db.tasks.find({ completed: true, plannedFor: date }).select(FIELDS).lean(),
        db.tasks.find({ completed: true, completedOn: date }).select(FIELDS).lean(),
        db.projects.find({ status: "active" }).select("name").lean()
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

// src/routes/trash.ts
import { Router as Router11 } from "express";
function trashRouter() {
  const router = Router11();
  router.use(requireAuth, requireWriter);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { projects, tasks } = await bind(currentTenant(req)).trash();
      res.json({
        projects: projects.map((project) => ({
          id: project._id.toString(),
          name: project.name,
          deletedAt: project.deletedAt?.toISOString() ?? null,
          purgeAt: project.purgeAt?.toISOString() ?? null
        })),
        tasks: tasks.map((task) => ({
          id: task._id.toString(),
          projectId: task.projectId.toString(),
          title: task.title,
          deletedAt: task.deletedAt?.toISOString() ?? null,
          purgeAt: task.purgeAt?.toISOString() ?? null
        }))
      });
    })
  );
  router.post(
    "/projects/:id/restore",
    asyncHandler(async (req, res) => {
      const project = await bind(currentTenant(req)).restoreProject(req.params.id);
      res.json({ id: project.id, name: project.name });
    })
  );
  router.post(
    "/tasks/:id/restore",
    asyncHandler(async (req, res) => {
      const task = await bind(currentTenant(req)).restoreTask(req.params.id);
      res.json({ id: task.id, title: task.title });
    })
  );
  router.delete(
    "/projects/:id",
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).purgeProject(req.params.id);
      res.status(204).send();
    })
  );
  router.delete(
    "/tasks/:id",
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).purgeTask(req.params.id);
      res.status(204).send();
    })
  );
  router.post(
    "/empty",
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).emptyTrash();
      res.status(204).send();
    })
  );
  return router;
}

// src/routes/workspaces.ts
import { Router as Router12 } from "express";
function workspacesRouter() {
  const router = Router12();
  router.use(requireAuth);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await listWorkspaces(currentTenant(req).userId));
    })
  );
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = parseBody(workspaceCreateSchema, req.body);
      const workspace = await createSharedWorkspace(currentTenant(req).userId, input.name);
      res.status(201).json(workspace);
    })
  );
  router.post(
    "/members",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      assertRole(tenant, "admin");
      const input = parseBody(memberSchema, req.body);
      res.status(201).json(await addMember(tenant, input.email, input.role));
    })
  );
  router.patch(
    "/members/:userId",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      assertRole(tenant, "admin");
      const input = parseBody(memberRoleSchema, req.body);
      res.json(await changeMemberRole(tenant, req.params.userId, input.role));
    })
  );
  router.delete(
    "/members/:userId",
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req);
      assertRole(tenant, "admin");
      await removeMember(tenant, req.params.userId);
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
  app2.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app2.use(compression());
  app2.use(privateRevalidate());
  app2.use(express.json({ limit: "1mb" }));
  app2.use((req, res, next) => {
    const match = req.get("If-Match");
    if (match) res.set("ETag", match);
    next();
  });
  app2.use(guardOrigin);
  app2.use(csrfProtection);
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
      const db = mongoose5.connection.db;
      if (!db) throw new Error("Database is not connected.");
      await db.command({ ping: 1 });
      const migration = await db.collection("migrations").findOne({ id: "001_personal_workspaces" });
      return migration?.counts ? { id: migration.id, counts: migration.counts } : void 0;
    }).then((migration) => {
      const body = { ok: true, db: "up", latencyMs: Date.now() - started, ...migration ? { migration } : {} };
      res.json(body);
    }).catch(() => {
      const body = { ok: false, db: "down", latencyMs: Date.now() - started };
      res.setHeader("Retry-After", "5");
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
  const auth = authRouter(authLimiter);
  auth.use(mfaRouter());
  app2.use("/api/auth", auth);
  app2.use("/api/workspaces", workspacesRouter());
  app2.use("/api/trash", trashRouter());
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
