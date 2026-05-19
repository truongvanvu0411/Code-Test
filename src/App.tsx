/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode,
  History,
  LogOut,
  MonitorDot,
  Play,
  Save,
  ShieldCheck,
  Square,
  Terminal,
  Timer,
  UserPlus,
  Users
} from "lucide-react";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-ruby";
import { motion } from "motion/react";
import { jsPDF } from "jspdf";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Challenge } from "./challenges";

type AppState = "loading" | "setup" | "login" | "welcome" | "testing" | "finished" | "admin";
type ActiveTab = "code" | "spec";
type Role = "admin" | "candidate";

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type RunResult = {
  status: "passed" | "failed";
  visiblePassed: boolean;
  hiddenPassed: boolean;
  visibleOutput: string;
  hiddenSummary: {
    examples: number;
    failures: number;
    timedOut: boolean;
  };
  failures: Array<{
    description: string;
    message: string;
  }>;
  durationMs: number;
  scoreSignals: {
    visibleExamples: number;
    hiddenExamples: number;
    visibleFailures: number;
    hiddenFailures: number;
  };
};

type RunHistoryItem = {
  at: string;
  status: string;
  visiblePassed: boolean;
  hiddenPassed: boolean;
  durationMs: number;
};

type SubmissionReport = {
  submissionId: string;
  user: User;
  candidateName: string;
  challenge: Challenge;
  submittedAt: string;
  summary: string;
  verificationNotes: string;
  nextSteps: string;
  aiSelfReport: string;
  recording?: {
    fileName: string;
    size: number;
    uploadedAt: string;
  } | null;
  autoSignals: {
    totalRuns: number;
    lastStatus: string;
    visiblePassed: boolean;
    hiddenPassed: boolean;
    ranBeforeSubmit: boolean;
    recordingProvided: boolean;
  };
  runHistory: RunHistoryItem[];
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options.body instanceof Blob ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(typeof payload === "string" ? payload : payload.error || "Request failed");
  }
  return payload as T;
}

export default function App() {
  const [state, setState] = useState<AppState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengeId, setChallengeId] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [implementationCode, setImplementationCode] = useState("");
  const [visibleSpecCode, setVisibleSpecCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(40 * 60);
  const [activeTab, setActiveTab] = useState<ActiveTab>("code");
  const [logs, setLogs] = useState<string[]>([]);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState("");

  const [summary, setSummary] = useState("");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [aiSelfReport, setAiSelfReport] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminSubmissions, setAdminSubmissions] = useState<SubmissionReport[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "candidate" as Role });

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    if (!user) return;
    loadChallenges();
  }, [user]);

  useEffect(() => {
    const selected = challenges.find((item) => item.id === challengeId) || null;
    setChallenge(selected);
  }, [challengeId, challenges]);

  useEffect(() => {
    if (state !== "testing") return;
    if (timeLeft <= 0) {
      finishSimulation();
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((value) => value - 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [state, timeLeft]);

  async function initialize() {
    try {
      const setup = await api<{ needsSetup: boolean }>("/api/setup");
      if (setup.needsSetup) {
        setState("setup");
        return;
      }
      const me = await api<{ user: User | null }>("/api/auth/me");
      setUser(me.user);
      setState(me.user ? (me.user.role === "admin" ? "admin" : "welcome") : "login");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not initialize app");
      setState("login");
    }
  }

  async function loadChallenges() {
    const data = await api<Challenge[]>("/api/challenges");
    setChallenges(data);
    setChallengeId((current) => current || data[0]?.id || "");
  }

  const lastRunPassed = runResult?.visiblePassed && runResult?.hiddenPassed;
  const canStart = Boolean(challenge && user);
  const canSubmit = Boolean(summary.trim() && verificationNotes.trim() && nextSteps.trim() && aiSelfReport.trim());

  const autoScore = useMemo(() => {
    if (!runHistory.length) return 0;
    const last = runHistory[runHistory.length - 1];
    let score = 0;
    if (last.visiblePassed) score += 30;
    if (last.hiddenPassed) score += 35;
    if (runHistory.length >= 2) score += 10;
    if (summary.trim()) score += 10;
    if (verificationNotes.trim()) score += 10;
    if (nextSteps.trim()) score += 5;
    if (recordingBlob) score += 5;
    return Math.min(score, 100);
  }, [nextSteps, recordingBlob, runHistory, summary, verificationNotes]);

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  async function setupAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password")
        })
      });
      setState("login");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Setup failed");
    }
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password")
        })
      });
      setUser(result.user);
      setState(result.user.role === "admin" ? "admin" : "welcome");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setUser(null);
    setState("login");
  }

  function startSimulation() {
    if (!challenge) return;

    setImplementationCode(challenge.initialCode);
    setVisibleSpecCode(challenge.visibleSpec);
    setTimeLeft(challenge.durationMinutes * 60);
    setRunResult(null);
    setRunHistory([]);
    setSummary("");
    setVerificationNotes("");
    setNextSteps("");
    setAiSelfReport("");
    setRecordingBlob(null);
    setRecordingError("");
    setLogs([
      `[SYSTEM] Loaded challenge: ${challenge.title}`,
      "[SYSTEM] Run baseline before refactoring, then keep each change small.",
      "[POLICY] AI delegation is not allowed. Self-report any AI usage at submit.",
      "[RECORDING] Start screen recording before coding if this is a formal attempt."
    ]);
    setState("testing");
  }

  async function startRecording() {
    setRecordingError("");
    setRecordingBlob(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        setRecordingBlob(blob);
        setIsRecording(false);
        stream.getTracks().forEach((track) => track.stop());
      };
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state === "recording") recorder.stop();
      });
      recorder.start(1000);
      setIsRecording(true);
      setLogs((current) => [...current, "[RECORDING] Screen recording started."]);
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "Screen recording permission was denied");
    }
  }

  function stopRecording() {
    return new Promise<Blob | null>((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        resolve(recordingBlob);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        setRecordingBlob(blob);
        setIsRecording(false);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        resolve(blob);
      };
      recorder.stop();
      setLogs((current) => [...current, "[RECORDING] Screen recording stopped."]);
    });
  }

  async function finishSimulation() {
    if (isRecording) await stopRecording();
    setState("finished");
  }

  async function runSpecs() {
    if (!challenge) return;

    setIsRunning(true);
    setLogs((current) => [...current, `[RUN] bundle exec rspec for ${challenge.id}`]);

    try {
      const result = await api<RunResult>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.id,
          implementationCode,
          visibleSpecCode
        })
      });

      setRunResult(result);
      const historyItem = {
        at: new Date().toISOString(),
        status: result.status,
        visiblePassed: result.visiblePassed,
        hiddenPassed: result.hiddenPassed,
        durationMs: result.durationMs
      };
      setRunHistory((current) => [...current, historyItem]);
      setLogs((current) => [
        ...current,
        result.status === "passed"
          ? `[PASS] Visible and hidden specs passed in ${result.durationMs}ms`
          : `[FAIL] Visible: ${result.visiblePassed ? "pass" : "fail"} / Hidden: ${result.hiddenPassed ? "pass" : "fail"}`
      ]);
    } catch (error) {
      setLogs((current) => [
        ...current,
        `[ERROR] ${error instanceof Error ? error.message : "Could not run specs"}`
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  async function submitWork() {
    if (!challenge || !canSubmit) return;

    setIsSubmitting(true);
    try {
      const blob = isRecording ? await stopRecording() : recordingBlob;
      const result = await api<{ submissionId: string }>("/api/submissions", {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.id,
          implementationCode,
          visibleSpecCode,
          summary,
          verificationNotes,
          nextSteps,
          aiSelfReport,
          runHistory,
          recordingMeta: blob ? { size: blob.size, type: blob.type } : null
        })
      });

      if (blob) {
        await api(`/api/submissions/${result.submissionId}/recording`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob
        });
      }

      setSubmissionId(result.submissionId);
      downloadPDF(result.submissionId);
    } catch (error) {
      setLogs((current) => [
        ...current,
        `[ERROR] ${error instanceof Error ? error.message : "Could not submit work"}`
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  function downloadPDF(id = submissionId) {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("RefactorSim Submission", 20, 20);
    doc.setFontSize(10);
    doc.text(`Submission: ${id || "pending"}`, 20, 30);
    doc.text(`Candidate: ${user?.name || ""}`, 20, 36);
    doc.text(`Challenge: ${challenge?.title || ""}`, 20, 42);
    doc.text(`Time Remaining: ${formatTime(timeLeft)}`, 20, 48);
    doc.text(`Auto Signal Score: ${autoScore}/100`, 20, 54);
    doc.text(`Recording: ${recordingBlob ? `${Math.round(recordingBlob.size / 1024 / 1024)} MB` : "not provided"}`, 20, 60);

    const notes = [
      `Summary: ${summary}`,
      `Verification: ${verificationNotes}`,
      `Next steps: ${nextSteps}`,
      `AI self-report: ${aiSelfReport}`,
      `Runs: ${runHistory.length}`
    ].join("\n\n");

    doc.text(doc.splitTextToSize(notes, 170), 20, 74);
    doc.save("refactorsim_submission.pdf");
  }

  async function loadAdminData() {
    const [users, submissions] = await Promise.all([
      api<User[]>("/api/admin/users"),
      api<SubmissionReport[]>("/api/admin/submissions")
    ]);
    setAdminUsers(users);
    setAdminSubmissions(submissions);
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await api<User>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(newUser)
    });
    setNewUser({ name: "", email: "", password: "", role: "candidate" });
    await loadAdminData();
  }

  async function toggleUser(target: User) {
    await api<User>(`/api/admin/users/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !target.active })
    });
    await loadAdminData();
  }

  useEffect(() => {
    if (state === "admin" && user?.role === "admin") {
      loadAdminData().catch((error) => setAuthError(error instanceof Error ? error.message : "Could not load admin data"));
    }
  }, [state, user]);

  if (state === "loading") {
    return <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">Loading...</div>;
  }

  if (state === "setup") {
    return (
      <AuthShell title="Create First Admin" subtitle="Set up the first administrator for this local test system." error={authError}>
        <form onSubmit={setupAdmin} className="space-y-3">
          <AuthInput name="name" label="Name" />
          <AuthInput name="email" label="Email" type="email" />
          <AuthInput name="password" label="Password" type="password" />
          <button className="w-full bg-blue-600 px-4 py-3 font-bold text-white">Create admin</button>
        </form>
      </AuthShell>
    );
  }

  if (state === "login") {
    return (
      <AuthShell title="RefactorSim Login" subtitle="Sign in as candidate or admin." error={authError}>
        <form onSubmit={login} className="space-y-3">
          <AuthInput name="email" label="Email" type="email" />
          <AuthInput name="password" label="Password" type="password" />
          <button className="w-full bg-red-600 px-4 py-3 font-bold text-white">Login</button>
        </form>
      </AuthShell>
    );
  }

  if (state === "admin") {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-950">
        <TopBar user={user} onLogout={logout} onAdmin={() => setState("admin")} onCandidate={() => setState("welcome")} />
        <main className="max-w-7xl mx-auto p-6 space-y-6">
          <section className="grid grid-cols-[360px_1fr] gap-6">
            <div className="bg-white border border-slate-200 p-5">
              <h2 className="font-bold flex items-center gap-2"><UserPlus className="w-4 h-4" /> Create user</h2>
              <form onSubmit={createUser} className="mt-4 space-y-3">
                <AdminInput label="Name" value={newUser.name} onChange={(value) => setNewUser({ ...newUser, name: value })} />
                <AdminInput label="Email" value={newUser.email} onChange={(value) => setNewUser({ ...newUser, email: value })} />
                <AdminInput label="Password" type="password" value={newUser.password} onChange={(value) => setNewUser({ ...newUser, password: value })} />
                <select
                  value={newUser.role}
                  onChange={(event) => setNewUser({ ...newUser, role: event.target.value as Role })}
                  className="w-full border border-slate-300 px-3 py-2"
                >
                  <option value="candidate">Candidate</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="w-full bg-slate-950 px-4 py-2 font-bold text-white">Create</button>
              </form>
            </div>

            <div className="bg-white border border-slate-200 p-5">
              <h2 className="font-bold flex items-center gap-2"><Users className="w-4 h-4" /> Users</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2">Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="py-2">{item.name}</td>
                        <td>{item.email}</td>
                        <td>{item.role}</td>
                        <td>{item.active ? "active" : "disabled"}</td>
                        <td className="text-right">
                          <button onClick={() => toggleUser(item)} className="border border-slate-300 px-3 py-1 text-xs">
                            {item.active ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 p-5">
            <h2 className="font-bold">Submissions</h2>
            <div className="mt-4 grid gap-3">
              {adminSubmissions.length === 0 && <p className="text-sm text-slate-500">No submissions yet.</p>}
              {adminSubmissions.map((submission) => (
                <div key={submission.submissionId} className="border border-slate-200 p-4 grid grid-cols-[1fr_auto] gap-4">
                  <div>
                    <div className="font-semibold">{submission.candidateName} / {submission.challenge.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{new Date(submission.submittedAt).toLocaleString()} / runs {submission.runHistory.length}</div>
                    <div className="mt-2 text-sm text-slate-600 line-clamp-2">{submission.summary}</div>
                    <div className="mt-2 flex gap-2 text-xs">
                      <Badge ok={submission.autoSignals.visiblePassed} label="Visible" />
                      <Badge ok={submission.autoSignals.hiddenPassed} label="Hidden" />
                      <Badge ok={Boolean(submission.recording)} label="Recording" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <ArtifactLink id={submission.submissionId} artifact="report" label="Report" />
                    <ArtifactLink id={submission.submissionId} artifact="code" label="Code" />
                    <ArtifactLink id={submission.submissionId} artifact="spec" label="Spec" />
                    {submission.recording && <ArtifactLink id={submission.submissionId} artifact="recording" label="Recording" />}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (state === "welcome") {
    return (
      <div className="min-h-screen bg-[#101827] text-slate-100">
        <TopBar user={user} onLogout={logout} onAdmin={() => setState("admin")} onCandidate={() => setState("welcome")} />
        <div className="min-h-[calc(100vh-56px)] flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-4xl border border-slate-700 bg-slate-900 p-8 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-8">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 bg-red-600">
                    <History className="w-7 h-7" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold">RefactorSim Ruby</h1>
                    <p className="text-slate-400">Signed in as {user?.name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm text-slate-300 mt-8">
                  <InfoPanel icon={<ShieldCheck className="w-4 h-4" />} title="Baseline first" text="Run specs before refactoring and compare behavior as you go." />
                  <InfoPanel icon={<FileCode className="w-4 h-4" />} title="Code and spec" text="Implementation and visible RSpec are both editable." />
                  <InfoPanel icon={<MonitorDot className="w-4 h-4" />} title="Recording" text="Record the interview attempt and store it with the submission." />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_280px] gap-6 mt-8">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Challenge</span>
                <select
                  value={challengeId}
                  onChange={(event) => setChallengeId(event.target.value)}
                  className="mt-2 w-full bg-slate-950 border border-slate-700 px-3 py-3 outline-none focus:border-blue-500"
                >
                  {challenges.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <div className="mt-4 border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  AI policy: do not delegate the refactor plan, test strategy, or final code to AI. Any AI usage must be self-reported and checked against the recorded video.
                </div>
              </label>

              <div className="border border-slate-700 bg-slate-950 p-4">
                <h2 className="font-semibold text-slate-100">{challenge?.domain || "Loading..."}</h2>
                <p className="mt-2 text-sm text-slate-400">{challenge?.durationMinutes || 40} minutes</p>
                <ul className="mt-4 space-y-2 text-xs text-slate-500">
                  {(challenge?.rubric || []).map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={startSimulation}
                  disabled={!canStart}
                  className="mt-6 w-full bg-red-600 px-4 py-3 font-bold text-white disabled:opacity-40 hover:bg-red-500 flex items-center justify-center gap-2"
                >
                  Start Simulation <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (state === "finished") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl bg-white border border-slate-200 p-8 shadow-xl">
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">Submit Simulation</h1>
              <p className="text-slate-500 mt-1">Admin can review this report, code, spec, run history, and recording.</p>
            </div>
            <div className={cn("px-3 py-2 text-sm font-bold", lastRunPassed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
              {lastRunPassed ? "Last run passed" : "Last run not fully passing"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <TextArea label="What did you refactor?" value={summary} onChange={setSummary} />
            <TextArea label="How did you verify behavior?" value={verificationNotes} onChange={setVerificationNotes} />
            <TextArea label="What would you improve with more time?" value={nextSteps} onChange={setNextSteps} />
            <TextArea label="AI self-report" value={aiSelfReport} onChange={setAiSelfReport} placeholder="No AI used / Used AI only for..." />
          </div>

          <div className="mt-6 grid grid-cols-5 gap-3 text-sm">
            <Metric label="Runs" value={String(runHistory.length)} />
            <Metric label="Visible" value={runResult?.visiblePassed ? "Pass" : "Pending"} />
            <Metric label="Hidden" value={runResult?.hiddenPassed ? "Pass" : "Pending"} />
            <Metric label="Recording" value={recordingBlob ? `${Math.round(recordingBlob.size / 1024 / 1024)} MB` : "None"} />
            <Metric label="Auto signal" value={`${autoScore}/100`} />
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={submitWork}
              disabled={!canSubmit || isSubmitting}
              className="flex-1 bg-slate-950 px-4 py-3 text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" /> {isSubmitting ? "Saving..." : "Save Submission"}
            </button>
            <button
              onClick={() => setState("testing")}
              className="px-5 py-3 border border-slate-300 text-slate-700 font-medium"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f172a] text-slate-200 overflow-hidden">
      <header className="h-16 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-red-600 px-2 py-1 text-[10px] font-bold uppercase">Recording expected</div>
          <div>
            <h1 className="text-sm font-semibold">{challenge?.title}</h1>
            <p className="text-xs text-slate-500">{user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={cn(
              "px-3 py-2 text-xs font-bold flex items-center gap-2",
              isRecording ? "bg-red-600 text-white" : "bg-slate-800 text-slate-200"
            )}
          >
            {isRecording ? <Square className="w-3.5 h-3.5" /> : <MonitorDot className="w-3.5 h-3.5" />}
            {isRecording ? "Stop recording" : recordingBlob ? "Record again" : "Start recording"}
          </button>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Time Remaining</div>
            <div className={cn("text-2xl font-mono", timeLeft < 300 ? "text-red-500" : "text-amber-400")}>{formatTime(timeLeft)}</div>
          </div>
          <button onClick={finishSimulation} className="bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">
            Finish
          </button>
        </div>
      </header>

      <main className="flex flex-1 min-h-0">
        <aside className="w-72 border-r border-slate-800 bg-slate-900/50 overflow-y-auto p-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> Business Rules
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            {(challenge?.businessRules || []).map((rule) => (
              <li key={rule} className="border-l border-slate-700 pl-3 leading-relaxed">{rule}</li>
            ))}
          </ul>

          <div className="mt-6 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Process Signals</h3>
            <div className="mt-3 space-y-2">
              <Signal label="Baseline run" ok={runHistory.length > 0} />
              <Signal label="Repeated verification" ok={runHistory.length >= 2} />
              <Signal label="Visible specs pass" ok={Boolean(runResult?.visiblePassed)} />
              <Signal label="Hidden specs pass" ok={Boolean(runResult?.hiddenPassed)} />
              <Signal label="Recording captured" ok={Boolean(recordingBlob)} />
            </div>
          </div>

          <div className="mt-6 border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
            <AlertCircle className="w-4 h-4 mb-2" />
            Hidden spec details are summarized. Admin review combines specs, recording, and written notes.
          </div>
          {recordingError && <div className="mt-3 text-xs text-red-300">{recordingError}</div>}
        </aside>

        <section className="flex-1 flex flex-col min-w-0 bg-[#0b0e14]">
          <div className="h-10 border-b border-slate-800 flex items-center bg-slate-900/60">
            <TabButton active={activeTab === "code"} onClick={() => setActiveTab("code")} label={challenge?.fileName || "implementation.rb"} />
            <TabButton active={activeTab === "spec"} onClick={() => setActiveTab("spec")} label={challenge?.specFileName || "visible_spec.rb"} />
            <div className="flex-1" />
            <button
              onClick={runSpecs}
              disabled={isRunning}
              className="h-full px-4 text-xs font-bold text-blue-400 hover:bg-blue-500/10 disabled:opacity-40 flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5" /> {isRunning ? "RUNNING" : "RUN RSPEC"}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
            <Editor
              value={activeTab === "code" ? implementationCode : visibleSpecCode}
              onValueChange={activeTab === "code" ? setImplementationCode : setVisibleSpecCode}
              highlight={(code) => highlight(code, languages.ruby, "ruby")}
              padding={20}
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                fontSize: 13,
                lineHeight: 1.55,
                minHeight: "100%"
              }}
              className="outline-none"
            />
          </div>

          <div className="h-56 border-t border-slate-800 bg-[#06080c] p-3 flex flex-col">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              <span className="flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> RSpec Output</span>
              <span>{runResult ? `${runResult.durationMs}ms` : "not run"}</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
              {logs.map((log, index) => (
                <div key={`${log}-${index}`} className={cn(
                  log.includes("[PASS]") && "text-emerald-400",
                  log.includes("[FAIL]") && "text-red-400",
                  log.includes("[RUN]") && "text-blue-400",
                  log.includes("[POLICY]") && "text-amber-400",
                  log.includes("[RECORDING]") && "text-purple-300"
                )}>{log}</div>
              ))}
              {runResult?.visibleOutput && <div className="mt-3 text-slate-400">{runResult.visibleOutput}</div>}
              {runResult?.failures?.map((failure) => (
                <div key={failure.description} className="mt-2 text-red-300">
                  {failure.description}: {failure.message}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="w-80 border-l border-slate-800 bg-slate-900/60 p-4 overflow-y-auto">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Run Status</h2>
          <div className={cn("mt-3 p-4 border", lastRunPassed ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-700 bg-slate-950")}>
            <div className="text-2xl font-bold">{runResult ? runResult.status.toUpperCase() : "READY"}</div>
            <div className="mt-2 text-sm text-slate-400">
              Visible: {runResult?.visiblePassed ? "pass" : "pending/fail"}<br />
              Hidden: {runResult?.hiddenPassed ? "pass" : "pending/fail"}<br />
              Recording: {isRecording ? "recording" : recordingBlob ? `${Math.round(recordingBlob.size / 1024 / 1024)} MB` : "not captured"}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric label="Visible examples" value={String(runResult?.scoreSignals?.visibleExamples ?? 0)} dark />
            <Metric label="Hidden failures" value={String(runResult?.scoreSignals?.hiddenFailures ?? 0)} dark />
            <Metric label="Runs" value={String(runHistory.length)} dark />
            <Metric label="Auto signal" value={`${autoScore}/100`} dark />
          </div>

          <h3 className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-500">Run History</h3>
          <div className="mt-3 space-y-2">
            {runHistory.length === 0 && <p className="text-xs text-slate-600">Run baseline before refactoring.</p>}
            {runHistory.map((item, index) => (
              <div key={item.at} className="border border-slate-800 bg-slate-950 p-3 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>Run {index + 1}</span>
                  <span className={item.status === "passed" ? "text-emerald-400" : "text-red-400"}>{item.status}</span>
                </div>
                <div className="mt-1 text-slate-600">{new Date(item.at).toLocaleTimeString()} / {item.durationMs}ms</div>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <footer className="h-8 border-t border-slate-800 bg-slate-950 px-5 flex items-center justify-between text-[10px] text-slate-500">
        <span>Ruby runner via Docker Compose</span>
        <span>Reviewer score: Ruby/OOP 30, behavior 25, tests 20, process 15, editor 10</span>
      </footer>
    </div>
  );
}

function TopBar({
  user,
  onLogout,
  onAdmin,
  onCandidate
}: {
  user: User | null;
  onLogout: () => void;
  onAdmin: () => void;
  onCandidate: () => void;
}) {
  return (
    <header className="h-14 bg-slate-950 text-slate-100 border-b border-slate-800 px-5 flex items-center justify-between">
      <div className="font-bold">RefactorSim Ruby</div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-400">{user?.name} / {user?.role}</span>
        <button onClick={onCandidate} className="border border-slate-700 px-3 py-1">Candidate</button>
        {user?.role === "admin" && <button onClick={onAdmin} className="border border-slate-700 px-3 py-1">Admin</button>}
        <button onClick={onLogout} className="bg-slate-800 px-3 py-1 flex items-center gap-1"><LogOut className="w-3.5 h-3.5" /> Logout</button>
      </div>
    </header>
  );
}

function AuthShell({ title, subtitle, error, children }: { title: string; subtitle: string; error: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        {error && <div className="mt-4 border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function AuthInput({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input name={name} type={type} required className="mt-2 w-full bg-slate-950 border border-slate-700 px-3 py-3 outline-none focus:border-blue-500" />
    </label>
  );
}

function InfoPanel({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="border border-slate-700 bg-slate-950 p-3">
      <div className="flex items-center gap-2 text-slate-100 font-semibold">{icon}{title}</div>
      <p className="mt-2 text-xs text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-full px-4 border-r border-slate-800 text-xs font-medium",
        active ? "bg-[#0b0e14] text-slate-100 border-t-2 border-t-blue-500" : "text-slate-500 hover:text-slate-300"
      )}
    >
      {label}
    </button>
  );
}

function Signal({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={ok ? "text-emerald-400" : "text-slate-600"}>{ok ? "ok" : "pending"}</span>
    </div>
  );
}

function Metric({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <div className={cn("border p-3", dark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-slate-50")}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cn("mt-1 font-bold", dark ? "text-slate-100" : "text-slate-950")}>{value}</div>
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-32 w-full border border-slate-300 p-3 outline-none focus:border-blue-500"
      />
    </label>
  );
}

function AdminInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="mt-1 w-full border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
      />
    </label>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={cn("px-2 py-1", ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{label}</span>;
}

function ArtifactLink({ id, artifact, label }: { id: string; artifact: string; label: string }) {
  return (
    <a
      href={`/api/admin/submissions/${id}/artifact/${artifact}`}
      className="border border-slate-300 px-3 py-1 text-xs text-center hover:bg-slate-50 flex items-center gap-1 justify-center"
    >
      <Download className="w-3 h-3" /> {label}
    </a>
  );
}
