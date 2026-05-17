/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode,
  History,
  Play,
  Save,
  ShieldCheck,
  Terminal,
  Timer
} from "lucide-react";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-ruby";
import { motion } from "motion/react";
import { jsPDF } from "jspdf";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Challenge } from "./challenges";

type AppState = "welcome" | "testing" | "finished";
type ActiveTab = "code" | "spec";

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

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [state, setState] = useState<AppState>("welcome");
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengeId, setChallengeId] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [candidateName, setCandidateName] = useState("");
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

  useEffect(() => {
    fetch("/api/challenges")
      .then((response) => response.json())
      .then((data: Challenge[]) => {
        setChallenges(data);
        setChallengeId(data[0]?.id || "");
      })
      .catch(() => {
        setLogs(["[ERROR] Could not load challenges from the server."]);
      });
  }, []);

  useEffect(() => {
    const selected = challenges.find((item) => item.id === challengeId) || null;
    setChallenge(selected);
  }, [challengeId, challenges]);

  useEffect(() => {
    if (state !== "testing") return;
    if (timeLeft <= 0) {
      setState("finished");
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((value) => value - 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [state, timeLeft]);

  const lastRunPassed = runResult?.visiblePassed && runResult?.hiddenPassed;
  const canStart = Boolean(challenge && candidateName.trim());
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
    return score;
  }, [nextSteps, runHistory, summary, verificationNotes]);

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function startSimulation() {
    if (!challenge) return;

    setImplementationCode(challenge.initialCode);
    setVisibleSpecCode(challenge.visibleSpec);
    setTimeLeft(challenge.durationMinutes * 60);
    setRunResult(null);
    setRunHistory([]);
    setLogs([
      `[SYSTEM] Loaded challenge: ${challenge.title}`,
      "[SYSTEM] Run baseline before refactoring, then keep each change small.",
      "[POLICY] AI delegation is not allowed. Self-report any AI usage at submit."
    ]);
    setState("testing");
  }

  async function runSpecs() {
    if (!challenge) return;

    setIsRunning(true);
    setLogs((current) => [...current, `[RUN] bundle exec rspec for ${challenge.id}`]);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.id,
          implementationCode,
          visibleSpecCode
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Runner error");

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
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName,
          challengeId: challenge.id,
          implementationCode,
          visibleSpecCode,
          summary,
          verificationNotes,
          nextSteps,
          aiSelfReport,
          runHistory
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Submit failed");
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
    doc.text(`Candidate: ${candidateName}`, 20, 36);
    doc.text(`Challenge: ${challenge?.title || ""}`, 20, 42);
    doc.text(`Time Remaining: ${formatTime(timeLeft)}`, 20, 48);
    doc.text(`Auto Signal Score: ${autoScore}/100`, 20, 54);

    const notes = [
      `Summary: ${summary}`,
      `Verification: ${verificationNotes}`,
      `Next steps: ${nextSteps}`,
      `AI self-report: ${aiSelfReport}`,
      `Runs: ${runHistory.length}`
    ].join("\n\n");

    doc.text(doc.splitTextToSize(notes, 170), 20, 68);
    doc.save("refactorsim_submission.pdf");
  }

  if (state === "welcome") {
    return (
      <div className="min-h-screen bg-[#101827] text-slate-100 flex items-center justify-center p-6">
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
                  <p className="text-slate-400">Interview rehearsal for behavior-preserving refactoring</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm text-slate-300 mt-8">
                <InfoPanel icon={<ShieldCheck className="w-4 h-4" />} title="Baseline first" text="Run specs before refactoring and compare behavior as you go." />
                <InfoPanel icon={<FileCode className="w-4 h-4" />} title="Code and spec" text="Implementation and visible RSpec are both editable." />
                <InfoPanel icon={<Briefcase className="w-4 h-4" />} title="Reviewer ready" text="Submit summary, verification notes, AI self-report, and run history." />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_280px] gap-6 mt-8">
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Candidate name</span>
                <input
                  value={candidateName}
                  onChange={(event) => setCandidateName(event.target.value)}
                  className="mt-2 w-full bg-slate-950 border border-slate-700 px-3 py-3 outline-none focus:border-blue-500"
                  placeholder="e.g. Nguyen Van A"
                />
              </label>
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
              </label>
              <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                AI policy: do not delegate the refactor plan, test strategy, or final code to AI. Any AI usage must be self-reported and will be checked against the recorded video.
              </div>
            </div>

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
    );
  }

  if (state === "finished") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl bg-white border border-slate-200 p-8 shadow-xl">
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">Submit Simulation</h1>
              <p className="text-slate-500 mt-1">Reviewer will combine this report with the recorded video.</p>
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

          <div className="mt-6 grid grid-cols-4 gap-3 text-sm">
            <Metric label="Runs" value={String(runHistory.length)} />
            <Metric label="Visible" value={runResult?.visiblePassed ? "Pass" : "Pending"} />
            <Metric label="Hidden" value={runResult?.hiddenPassed ? "Pass" : "Pending"} />
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
            <p className="text-xs text-slate-500">{candidateName}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Time Remaining</div>
            <div className={cn("text-2xl font-mono", timeLeft < 300 ? "text-red-500" : "text-amber-400")}>{formatTime(timeLeft)}</div>
          </div>
          <button onClick={() => setState("finished")} className="bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">
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
            </div>
          </div>

          <div className="mt-6 border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
            <AlertCircle className="w-4 h-4 mb-2" />
            The hidden spec result is shown only as pass/fail. Reviewer will inspect your process from video.
          </div>
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
                  log.includes("[POLICY]") && "text-amber-400"
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
              Hidden: {runResult?.hiddenPassed ? "pass" : "pending/fail"}
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
