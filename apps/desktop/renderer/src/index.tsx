import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type {
  Project,
  Task,
  NormalizedEvent,
  DiffResult,
  VerificationResult,
  ApprovalRequest,
} from "@workbench/shared";

// ================================================================
// Global window type
// ================================================================
declare global {
  interface Window {
    workbench: {
      version: string;
      scanProject: (dirPath: string) => Promise<{ ok: boolean; data?: Project; error?: string }>;
      listProjects: () => Promise<{ ok: boolean; data?: Project[]; error?: string }>;
      createTask: (projectId: string, prompt: string) => Promise<{ ok: boolean; data?: Task; error?: string }>;
      listTasks: (projectId?: string) => Promise<{ ok: boolean; data?: Task[]; error?: string }>;
      getTask: (taskId: string) => Promise<{ ok: boolean; data?: Task; error?: string }>;
      createWorktree: (taskId: string) => Promise<{ ok: boolean; data?: { path: string; branch: string }; error?: string }>;
      startTurn: (taskId: string) => Promise<{ ok: boolean; data?: { turnId: string }; error?: string }>;
      onApprovalRequest: (callback: (req: ApprovalRequest) => void) => void;
      decideApproval: (approvalId: string, decision: "approved" | "denied") => Promise<{ ok: boolean; error?: string }>;
      getDiff: (taskId: string) => Promise<{ ok: boolean; data?: DiffResult; error?: string }>;
      runVerification: (taskId: string) => Promise<{ ok: boolean; data?: VerificationResult; error?: string }>;
      loadRecovery: () => Promise<{ ok: boolean; data?: { tasks: Task[]; events: NormalizedEvent[]; uncertainInputs: import('@workbench/shared').UncertainInput[] }; error?: string }>;
      resolveInput: (id: string, action: 'resend' | 'discard') => Promise<{ ok: boolean; error?: string }>;
      onEventStream: (callback: (event: NormalizedEvent) => void) => void;
    };
  }
}

// ================================================================
// Types
// ================================================================
type Panel = "context" | "diff" | "approval";

// ================================================================
// App Component
// ================================================================
function App(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [rightPanel, setRightPanel] = useState<Panel>("context");
  const [composer, setComposer] = useState("");
  const [scanPath, setScanPath] = useState("");
  const [uncertainInputs, setUncertainInputs] = useState<import('@workbench/shared').UncertainInput[]>([]);

  // Load initial data
  useEffect(() => {
    loadProjects();
    loadRecovery();

    // Subscribe to event stream
    window.workbench.onEventStream((evt) => {
      setEvents((prev) => prev.some(event => event.id === evt.id) ? prev : [...prev, evt]);
    });

    // Subscribe to approval requests
    window.workbench.onApprovalRequest((req) => {
      setApproval(req);
      setRightPanel("approval");
    });
  }, []);

  const loadProjects = useCallback(async () => {
    const result = await window.workbench.listProjects();
    if (result.ok && result.data) {
      setProjects(result.data);
      if (result.data.length > 0) {
        const tasksResult = await window.workbench.listTasks(result.data[0].id);
        if (tasksResult.ok && tasksResult.data) {
          setTasks(tasksResult.data);
        }
      }
    }
  }, []);

  const loadRecovery = useCallback(async () => {
    const result = await window.workbench.loadRecovery();
    if (result.ok && result.data) {
      setTasks(result.data.tasks);
      setEvents(result.data.events);
      setUncertainInputs(result.data.uncertainInputs ?? []);
      if (result.data.tasks.length > 0) {
        setSelectedTask(result.data.tasks[0]);
      }
    }
  }, []);

  // Handlers
  const handleScan = async () => {
    if (!scanPath.trim()) return;
    const result = await window.workbench.scanProject(scanPath);
    if (result.ok && result.data) {
      setProjects((prev) => [result.data!, ...prev]);
      setScanPath("");
    }
  };

  const handleCreateTask = async () => {
    if (!composer.trim() || projects.length === 0) return;
    const result = await window.workbench.createTask(projects[0].id, composer);
    if (result.ok && result.data) {
      setTasks((prev) => [result.data!, ...prev]);
      setSelectedTask(result.data);
      setComposer("");
    }
  };

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    setDiff(null);
    setVerification(null);
  };

  const handleStartTurn = async () => {
    if (!selectedTask) return;
    // Create worktree if not exists
    if (!selectedTask.worktreePath) {
      const wtResult = await window.workbench.createWorktree(selectedTask.id);
      if (wtResult.ok && wtResult.data) {
        setSelectedTask({ ...selectedTask, worktreePath: wtResult.data.path, worktreeBranch: wtResult.data.branch });
      }
    }
    // Start turn
    const result = await window.workbench.startTurn(selectedTask.id);
    if (result.ok && result.data) {
      console.log("Turn started:", result.data.turnId);
    }
  };

  const handleApprove = async () => {
    if (!approval) return;
    await window.workbench.decideApproval(approval.id, "approved");
    setApproval(null);
    setRightPanel("context");
  };

  const handleDeny = async () => {
    if (!approval) return;
    await window.workbench.decideApproval(approval.id, "denied");
    setApproval(null);
    setRightPanel("context");
  };

  const handleGetDiff = async () => {
    if (!selectedTask) return;
    const result = await window.workbench.getDiff(selectedTask.id);
    if (result.ok && result.data) {
      setDiff(result.data);
      setRightPanel("diff");
    }
  };

  const handleVerify = async () => {
    if (!selectedTask) return;
    const result = await window.workbench.runVerification(selectedTask.id);
    if (result.ok && result.data) {
      setVerification(result.data);
    }
  };

  return (
    <div style={styles.app}>
      {/* Left Sidebar */}
      <div style={styles.leftSidebar}>
        <h2 style={styles.sidebarTitle}>Projects</h2>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            placeholder="Project path..."
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
          />
          <button style={styles.button} onClick={handleScan}>Scan</button>
        </div>
        {projects.map((p) => (
          <div key={p.id} style={styles.projectCard}>
            <div style={styles.projectName}>{p.name}</div>
            <div style={styles.projectPath}>{p.path}</div>
            <div style={styles.toolchain}>{p.toolchain.join(", ")}</div>
          </div>
        ))}

        <h2 style={styles.sidebarTitle}>Tasks</h2>
        {tasks.map((t) => (
          <div
            key={t.id}
            style={{
              ...styles.taskCard,
              ...(selectedTask?.id === t.id ? styles.taskCardSelected : {}),
            }}
            onClick={() => handleSelectTask(t)}
          >
            <div style={styles.taskPrompt}>{t.prompt}</div>
            <div style={styles.taskMeta}>
              <span style={styleFns.badge(t.executionState)}>{t.executionState}</span>
              {t.worktreePath && <span style={styles.worktreeBadge}>worktree</span>}
              {verification?.taskId === t.id && (
                <span style={verification.passed ? styles.passBadge : styles.failBadge}>
                  {verification.passed ? "PASS" : "FAIL"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Center Panel */}
      <div style={styles.centerPanel}>
        <div style={styles.timeline}>
          {uncertainInputs.filter(input => input.taskId === selectedTask?.id).map(input => (
            <div key={input.id} role="alert">
              <strong>不确定输入：请检查执行现场后决定是否重发</strong>
              <pre>{input.text}</pre>
              {(['resend', 'discard'] as const).map(action => (
                <button key={action} onClick={async () => {
                  const result = await window.workbench.resolveInput(input.id, action);
                  if (!result.ok) window.alert(result.error);
                  await loadRecovery();
                }}>{action === 'resend' ? '重发' : '丢弃'}</button>
              ))}
            </div>
          ))}
          <h2 style={styles.panelTitle}>Timeline</h2>
          {events
            .filter((e) => !selectedTask || e.taskId === selectedTask.id)
            .map((evt) => (
              <div key={evt.id} style={styleFns.timelineItem(evt.type)}>
                <span style={styles.eventType}>{evt.type}</span>
                <span style={styles.eventTime}>{new Date(evt.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
        </div>

        <div style={styles.composer}>
          <input
            style={styles.composerInput}
            placeholder="Describe the task... (e.g., Add a hello() function)"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateTask(); }}
          />
          <button style={styles.button} onClick={handleCreateTask}>Create Task</button>
          {selectedTask && (
            <>
              <button style={styles.buttonPrimary} onClick={handleStartTurn}>Start Turn</button>
              <button style={styles.button} onClick={handleGetDiff}>Diff</button>
              <button style={styles.button} onClick={handleVerify}>Verify</button>
            </>
          )}
        </div>
      </div>

      {/* Right Sidebar */}
      <div style={styles.rightSidebar}>
        <div style={styles.tabs}>
          <button style={rightPanel === "context" ? styles.tabActive : styles.tab} onClick={() => setRightPanel("context")}>Context</button>
          <button style={rightPanel === "diff" ? styles.tabActive : styles.tab} onClick={() => setRightPanel("diff")}>Diff</button>
          <button style={rightPanel === "approval" ? styles.tabActive : styles.tab} onClick={() => setRightPanel("approval")}>Approval</button>
        </div>

        {rightPanel === "context" && (
          <div style={styles.panelContent}>
            {selectedTask ? (
              <>
                <div style={styles.contextItem}><strong>Task ID:</strong> {selectedTask.id}</div>
                <div style={styles.contextItem}><strong>Prompt:</strong> {selectedTask.prompt}</div>
                <div style={styles.contextItem}><strong>State:</strong> {selectedTask.executionState}</div>
                <div style={styles.contextItem}><strong>Worktree:</strong> {selectedTask.worktreePath || "none"}</div>
                {verification && (
                  <div style={styles.contextItem}>
                    <strong>Verification:</strong> {verification.passed ? "PASSED" : "FAILED"} (exit {verification.exitCode})
                  </div>
                )}
              </>
            ) : (
              <div style={styles.emptyState}>Select a task</div>
            )}
          </div>
        )}

        {rightPanel === "diff" && (
          <div style={styles.panelContent}>
            {diff ? (
              <>
                <div style={styles.diffSummary}>{diff.summary}</div>
                {diff.files.map((f, i) => (
                  <div key={i} style={styles.diffFile}>
                    <div style={styleFns.diffHeader(f.status)}>
                      {f.status} — {f.path} (+{f.additions} -{f.deletions})
                    </div>
                    <pre style={styles.diffPatch}>{f.patch}</pre>
                  </div>
                ))}
              </>
            ) : (
              <div style={styles.emptyState}>No diff available. Click "Diff" to load.</div>
            )}
          </div>
        )}

        {rightPanel === "approval" && (
          <div style={styles.panelContent}>
            {approval ? (
              <>
                <div style={styles.approvalType}>{approval.type.toUpperCase()} Approval</div>
                <div style={styles.approvalTarget}>{approval.target}</div>
                <div style={styles.approvalSummary}>{approval.summary}</div>
                <div style={styles.approvalButtons}>
                  <button style={styles.approveButton} onClick={handleApprove}>Approve</button>
                  <button style={styles.denyButton} onClick={handleDeny}>Deny</button>
                </div>
              </>
            ) : (
              <div style={styles.emptyState}>No pending approvals</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================
// Styles
// ================================================================
/**
 * Function-valued style factories are kept in `styleFns` so that the plain
 * `styles` record stays strictly CSSProperties (callable style helpers
 * live separately to keep typing clean).
 */
type StyleFn = (arg: string) => React.CSSProperties;
const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    height: "100vh",
    margin: 0,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 13,
    color: "#1a1a1a",
    backgroundColor: "#f5f5f5",
  },
  leftSidebar: {
    width: 260,
    borderRight: "1px solid #ddd",
    padding: 12,
    overflowY: "auto",
    backgroundColor: "#fafafa",
  },
  sidebarTitle: { fontSize: 14, margin: "12px 0 8px 0", color: "#666" },
  centerPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #ddd",
  },
  rightSidebar: {
    width: 320,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#fafafa",
  },
  panelTitle: { fontSize: 14, margin: "12px 0 8px 12px", color: "#666" },
  inputRow: { display: "flex", gap: 4, marginBottom: 8 },
  input: { flex: 1, padding: "4px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 3 },
  button: { padding: "4px 10px", fontSize: 12, border: "1px solid #ccc", borderRadius: 3, cursor: "pointer", backgroundColor: "#fff" },
  buttonPrimary: { padding: "4px 10px", fontSize: 12, border: "1px solid #0066cc", borderRadius: 3, cursor: "pointer", backgroundColor: "#0066cc", color: "#fff" },
  projectCard: { padding: 8, marginBottom: 4, borderRadius: 4, backgroundColor: "#fff", border: "1px solid #e0e0e0" },
  projectName: { fontWeight: 600, fontSize: 13 },
  projectPath: { fontSize: 11, color: "#999", marginTop: 2 },
  toolchain: { fontSize: 11, color: "#666", marginTop: 2 },
  taskCard: { padding: 8, marginBottom: 4, borderRadius: 4, backgroundColor: "#fff", border: "1px solid #e0e0e0", cursor: "pointer" },
  taskCardSelected: { borderColor: "#0066cc", backgroundColor: "#f0f7ff" },
  taskPrompt: { fontSize: 12, marginBottom: 4 },
  taskMeta: { display: "flex", gap: 4, flexWrap: "wrap" },
  worktreeBadge: { fontSize: 10, padding: "1px 6px", borderRadius: 3, backgroundColor: "#e1bee7", color: "#333" },
  passBadge: { fontSize: 10, padding: "1px 6px", borderRadius: 3, backgroundColor: "#4caf50", color: "#fff" },
  failBadge: { fontSize: 10, padding: "1px 6px", borderRadius: 3, backgroundColor: "#f44336", color: "#fff" },
  timeline: { flex: 1, padding: 12, overflowY: "auto" },
  eventType: { fontSize: 12, fontWeight: 500 },
  eventTime: { fontSize: 11, color: "#999" },
  composer: { display: "flex", gap: 4, padding: 12, borderTop: "1px solid #ddd", backgroundColor: "#fff" },
  composerInput: { flex: 1, padding: "6px 8px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 },
  tabs: { display: "flex", borderBottom: "1px solid #ddd" },
  tab: { flex: 1, padding: 8, fontSize: 12, border: "none", backgroundColor: "transparent", cursor: "pointer", color: "#666" },
  tabActive: { flex: 1, padding: 8, fontSize: 12, border: "none", backgroundColor: "#fff", cursor: "pointer", color: "#1a1a1a", fontWeight: 600, borderBottom: "2px solid #0066cc" },
  panelContent: { flex: 1, padding: 12, overflowY: "auto" },
  contextItem: { marginBottom: 8, fontSize: 12, lineHeight: 1.5 },
  emptyState: { color: "#999", fontSize: 12, textAlign: "center", marginTop: 40 },
  diffSummary: { fontSize: 12, color: "#666", marginBottom: 8 },
  diffFile: { marginBottom: 12 },
  diffPatch: { fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflowY: "auto", backgroundColor: "#f9f9f9", padding: 8, borderRadius: 3, margin: 0 },
  approvalType: { fontSize: 14, fontWeight: 600, marginBottom: 8 },
  approvalTarget: { fontSize: 12, fontFamily: "monospace", marginBottom: 4 },
  approvalSummary: { fontSize: 12, color: "#666", marginBottom: 16 },
  approvalButtons: { display: "flex", gap: 8 },
  approveButton: { padding: "6px 16px", fontSize: 13, border: "none", borderRadius: 4, cursor: "pointer", backgroundColor: "#4caf50", color: "#fff" },
  denyButton: { padding: "6px 16px", fontSize: 13, border: "none", borderRadius: 4, cursor: "pointer", backgroundColor: "#f44336", color: "#fff" },
};

/** Function-valued style factories (keyed identical to their styles counterpart). */
const styleFns: Record<string, StyleFn> = {
  badge: (state) => ({
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 3,
    backgroundColor: state === "RUNNING" ? "#ffe0b2" : state === "IDLE" ? "#e8f5e9" : "#ffcdd2",
    color: "#333",
  }),
  timelineItem: (type) => ({
    padding: "6px 8px",
    marginBottom: 4,
    borderRadius: 4,
    backgroundColor: "#fff",
    borderLeft: `3px solid ${type.includes("Approval") ? "#ff9800" : type.includes("Completed") || type.includes("Verification") ? "#4caf50" : "#2196f3"}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  }),
  diffHeader: (status) => ({
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 8px",
    backgroundColor: status === "added" ? "#e8f5e9" : status === "deleted" ? "#ffebee" : "#fff3e0",
    borderRadius: 3,
    marginBottom: 4,
  }),
};

// ================================================================
// Render
// ================================================================
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

const root = createRoot(container);
root.render(<App />);
