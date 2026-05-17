import express from "express";
import fs from "fs/promises";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { CHALLENGES } from "./src/challenges";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const RUBY_RUNNER_URL = process.env.RUBY_RUNNER_URL || "http://localhost:4567";
const SUBMISSIONS_DIR = path.join(process.cwd(), "submissions");

type RunHistoryItem = {
  at: string;
  status: string;
  visiblePassed: boolean;
  hiddenPassed: boolean;
  durationMs: number;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/challenges", (_req, res) => {
    res.json(CHALLENGES.map(publicChallenge));
  });

  app.post("/api/runs", async (req, res) => {
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
  });

  app.post("/api/submissions", async (req, res) => {
    const {
      candidateName,
      challengeId,
      implementationCode,
      visibleSpecCode,
      summary,
      verificationNotes,
      nextSteps,
      aiSelfReport,
      runHistory
    } = req.body || {};

    const challenge = CHALLENGES.find((item) => item.id === challengeId);
    if (!challenge) {
      res.status(404).json({ error: "Unknown challenge" });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const candidate = sanitizeSegment(String(candidateName || "candidate"));
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
      ranBeforeSubmit: normalizedRunHistory.length > 0
    };

    const report = {
      submissionId,
      candidateName: String(candidateName || ""),
      challenge: publicChallenge(challenge),
      submittedAt: new Date().toISOString(),
      summary: String(summary || ""),
      verificationNotes: String(verificationNotes || ""),
      nextSteps: String(nextSteps || ""),
      aiSelfReport: String(aiSelfReport || ""),
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
      reportPath: path.join(submissionDir, "report.json"),
      autoSignals
    });
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Ruby runner URL: ${RUBY_RUNNER_URL}`);
  });
}

startServer();
