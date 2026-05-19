import crypto from "crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { CHALLENGES } from "./src/challenges";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const RUBY_RUNNER_URL = process.env.RUBY_RUNNER_URL || "http://localhost:4567";
const DATA_DIR = path.join(process.cwd(), "data");
const SUBMISSIONS_DIR = path.join(process.cwd(), "submissions");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const SESSION_COOKIE = "refactorsim_sid";
const MAX_RECORDING_BYTES = "750mb";

type Role = "admin" | "candidate";

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  passwordSalt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Session = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type RunHistoryItem = {
  at: string;
  status: string;
  visiblePassed: boolean;
  hiddenPassed: boolean;
  durationMs: number;
};

type AuthedRequest = Request & {
  user?: User;
};

function sanitizeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "candidate";
}

function publicChallenge(challenge: (typeof CHALLENGES)[number]) {
  return {
    id: challenge.id,
    title: challenge.title,
    domain: challenge.domain,
    durationMinutes: challenge.durationMinutes,
    fileName: challenge.fileName,
    specFileName: challenge.specFileName,
    businessRules: challenge.businessRules,
    rubric: challenge.rubric,
    initialCode: challenge.initialCode,
    visibleSpec: challenge.visibleSpec
  };
}

function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, user: User) {
  const attempted = crypto.scryptSync(password, user.passwordSalt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === attempted.length && crypto.timingSafeEqual(stored, attempted);
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      })
  );
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readUsers() {
  return readJson<User[]>(USERS_FILE, []);
}

async function writeUsers(users: User[]) {
  await writeJson(USERS_FILE, users);
}

async function readSessions() {
  const now = Date.now();
  const sessions = await readJson<Session[]>(SESSIONS_FILE, []);
  const active = sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  if (active.length !== sessions.length) await writeJson(SESSIONS_FILE, active);
  return active;
}

async function writeSessions(sessions: Session[]) {
  await writeJson(SESSIONS_FILE, sessions);
}

async function bootstrapAdmin() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;

  const users = await readUsers();
  const existing = users.find((user) => user.email.toLowerCase() === adminEmail.toLowerCase());
  const now = new Date().toISOString();
  const { hash, salt } = hashPassword(adminPassword);

  if (existing) {
    existing.role = "admin";
    existing.active = true;
    existing.passwordHash = hash;
    existing.passwordSalt = salt;
    existing.updatedAt = now;
  } else {
    users.push({
      id: crypto.randomUUID(),
      name: "Admin",
      email: adminEmail,
      role: "admin",
      passwordHash: hash,
      passwordSalt: salt,
      active: true,
      createdAt: now,
      updatedAt: now
    });
  }

  await writeUsers(users);
}

async function getUserFromRequest(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const sessions = await readSessions();
  const session = sessions.find((item) => item.tokenHash === hashToken(token));
  if (!session) return null;

  const users = await readUsers();
  return users.find((user) => user.id === session.userId && user.active) || null;
}

function asyncRoute(handler: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

async function findSubmissionDirs() {
  try {
    const entries = await fs.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readSubmissionReport(submissionId: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(submissionId)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(SUBMISSIONS_DIR, submissionId, "report.json"), "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function startServer() {
  await bootstrapAdmin();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/setup", asyncRoute(async (_req, res) => {
    const users = await readUsers();
    res.json({ needsSetup: users.length === 0 });
  }));

  app.post("/api/setup", asyncRoute(async (req, res) => {
    const users = await readUsers();
    if (users.length > 0) {
      res.status(409).json({ error: "Setup already completed" });
      return;
    }

    const { name, email, password } = req.body || {};
    if (!String(name || "").trim() || !String(email || "").includes("@") || String(password || "").length < 8) {
      res.status(400).json({ error: "Name, valid email, and password with at least 8 characters are required" });
      return;
    }

    const now = new Date().toISOString();
    const { hash, salt } = hashPassword(String(password));
    const admin: User = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role: "admin",
      passwordHash: hash,
      passwordSalt: salt,
      active: true,
      createdAt: now,
      updatedAt: now
    };

    await writeUsers([admin]);
    res.json({ user: publicUser(admin) });
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    const users = await readUsers();
    const user = users.find((item) => item.email.toLowerCase() === String(email || "").trim().toLowerCase());

    if (!user || !user.active || !verifyPassword(String(password || ""), user)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const sessions = await readSessions();
    sessions.push({
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
    });
    await writeSessions(sessions);
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  }));

  app.post("/api/auth/logout", asyncRoute(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      const sessions = await readSessions();
      await writeSessions(sessions.filter((session) => session.tokenHash !== hashToken(token)));
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", asyncRoute(async (req, res) => {
    const user = await getUserFromRequest(req);
    res.json({ user: user ? publicUser(user) : null });
  }));

  app.get("/api/challenges", requireAuth, (_req, res) => {
    res.json(CHALLENGES.map(publicChallenge));
  });

  app.post("/api/runs", requireAuth, asyncRoute(async (req, res) => {
    const { challengeId, implementationCode, visibleSpecCode } = req.body || {};
    const challenge = CHALLENGES.find((item) => item.id === challengeId);

    if (!challenge) {
      res.status(404).json({ error: "Unknown challenge" });
      return;
    }

    if (typeof implementationCode !== "string" || typeof visibleSpecCode !== "string") {
      res.status(400).json({ error: "implementationCode and visibleSpecCode are required" });
      return;
    }

    try {
      const runnerResponse = await fetch(`${RUBY_RUNNER_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, implementationCode, visibleSpecCode })
      });

      const text = await runnerResponse.text();
      const payload = text ? JSON.parse(text) : {};

      if (!runnerResponse.ok) {
        res.status(runnerResponse.status).json(payload);
        return;
      }

      res.json(payload);
    } catch (error) {
      res.status(502).json({
        error: "Ruby runner is unavailable",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }));

  app.post("/api/submissions", requireAuth, asyncRoute(async (req, res) => {
    const user = req.user!;
    const {
      challengeId,
      implementationCode,
      visibleSpecCode,
      summary,
      verificationNotes,
      nextSteps,
      aiSelfReport,
      runHistory,
      recordingMeta
    } = req.body || {};

    const challenge = CHALLENGES.find((item) => item.id === challengeId);
    if (!challenge) {
      res.status(404).json({ error: "Unknown challenge" });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const candidate = sanitizeSegment(user.name || user.email);
    const submissionId = `${timestamp}-${candidate}-${challenge.id}`;
    const submissionDir = path.join(SUBMISSIONS_DIR, submissionId);

    const normalizedRunHistory: RunHistoryItem[] = Array.isArray(runHistory)
      ? runHistory.map((item) => ({
          at: String(item.at || ""),
          status: String(item.status || ""),
          visiblePassed: Boolean(item.visiblePassed),
          hiddenPassed: Boolean(item.hiddenPassed),
          durationMs: Number(item.durationMs || 0)
        }))
      : [];

    const autoSignals = {
      totalRuns: normalizedRunHistory.length,
      firstRunAt: normalizedRunHistory[0]?.at || null,
      lastStatus: normalizedRunHistory.at(-1)?.status || "not_run",
      visiblePassed: Boolean(normalizedRunHistory.at(-1)?.visiblePassed),
      hiddenPassed: Boolean(normalizedRunHistory.at(-1)?.hiddenPassed),
      ranBeforeSubmit: normalizedRunHistory.length > 0,
      recordingProvided: Boolean(recordingMeta?.size)
    };

    const report = {
      submissionId,
      user: publicUser(user),
      candidateName: user.name,
      challenge: publicChallenge(challenge),
      submittedAt: new Date().toISOString(),
      summary: String(summary || ""),
      verificationNotes: String(verificationNotes || ""),
      nextSteps: String(nextSteps || ""),
      aiSelfReport: String(aiSelfReport || ""),
      recording: recordingMeta || null,
      autoSignals,
      runHistory: normalizedRunHistory
    };

    await fs.mkdir(submissionDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(submissionDir, challenge.fileName), String(implementationCode || ""), "utf8"),
      fs.writeFile(path.join(submissionDir, challenge.specFileName), String(visibleSpecCode || ""), "utf8"),
      fs.writeFile(path.join(submissionDir, "report.json"), JSON.stringify(report, null, 2), "utf8")
    ]);

    res.json({
      submissionId,
      autoSignals
    });
  }));

  app.post(
    "/api/submissions/:id/recording",
    requireAuth,
    express.raw({ type: ["video/webm", "application/octet-stream"], limit: MAX_RECORDING_BYTES }),
    asyncRoute(async (req, res) => {
      const submissionId = req.params.id;
      const report = await readSubmissionReport(submissionId);
      if (!report) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (req.user?.role !== "admin" && report.user?.id !== req.user?.id) {
        res.status(403).json({ error: "Cannot upload recording for this submission" });
        return;
      }

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (!body.length) {
        res.status(400).json({ error: "Recording file is empty" });
        return;
      }

      const submissionDir = path.join(SUBMISSIONS_DIR, submissionId);
      await fs.writeFile(path.join(submissionDir, "recording.webm"), body);
      report.recording = {
        fileName: "recording.webm",
        size: body.length,
        uploadedAt: new Date().toISOString()
      };
      report.autoSignals = {
        ...report.autoSignals,
        recordingProvided: true
      };
      await fs.writeFile(path.join(submissionDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

      res.json({ ok: true, size: body.length });
    })
  );

  app.get("/api/admin/users", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const users = await readUsers();
    res.json(users.map(publicUser));
  }));

  app.post("/api/admin/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!String(name || "").trim() || !String(email || "").includes("@") || String(password || "").length < 8) {
      res.status(400).json({ error: "Name, valid email, and password with at least 8 characters are required" });
      return;
    }
    if (!["admin", "candidate"].includes(String(role || "candidate"))) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const users = await readUsers();
    const normalizedEmail = String(email).trim().toLowerCase();
    if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    const now = new Date().toISOString();
    const { hash, salt } = hashPassword(String(password));
    const user: User = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      email: normalizedEmail,
      role: role === "admin" ? "admin" : "candidate",
      passwordHash: hash,
      passwordSalt: salt,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    users.push(user);
    await writeUsers(users);
    res.json(publicUser(user));
  }));

  app.patch("/api/admin/users/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const users = await readUsers();
    const user = users.find((item) => item.id === req.params.id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { name, role, active, password } = req.body || {};
    if (typeof name === "string" && name.trim()) user.name = name.trim();
    if (role === "admin" || role === "candidate") user.role = role;
    if (typeof active === "boolean") user.active = active;
    if (typeof password === "string" && password.length >= 8) {
      const { hash, salt } = hashPassword(password);
      user.passwordHash = hash;
      user.passwordSalt = salt;
    }
    user.updatedAt = new Date().toISOString();

    await writeUsers(users);
    res.json(publicUser(user));
  }));

  app.get("/api/admin/submissions", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const ids = await findSubmissionDirs();
    const reports = (await Promise.all(ids.map(readSubmissionReport))).filter(Boolean);
    reports.sort((a: any, b: any) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    res.json(reports);
  }));

  app.get("/api/admin/submissions/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const report = await readSubmissionReport(req.params.id);
    if (!report) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    res.json(report);
  }));

  app.get("/api/admin/submissions/:id/recording", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const report = await readSubmissionReport(req.params.id);
    if (!report || !report.recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    const filePath = path.join(SUBMISSIONS_DIR, req.params.id, "recording.webm");
    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Disposition", "inline");
    res.sendFile(filePath);
  }));

  app.get("/api/admin/submissions/:id/artifact/:artifact", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const report = await readSubmissionReport(req.params.id);
    if (!report) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const challenge = CHALLENGES.find((item) => item.id === report.challenge?.id);
    const artifactMap: Record<string, string | undefined> = {
      report: "report.json",
      code: challenge?.fileName,
      spec: challenge?.specFileName,
      recording: "recording.webm"
    };
    const fileName = artifactMap[req.params.artifact];
    if (!fileName) {
      res.status(404).json({ error: "Unknown artifact" });
      return;
    }

    const filePath = path.join(SUBMISSIONS_DIR, req.params.id, fileName);
    res.download(filePath, fileName);
  }));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Ruby runner URL: ${RUBY_RUNNER_URL}`);
  });
}

startServer();
