import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  Ref,
} from "react";

import type { MessageCategory, Provider } from "@cch/core";
import type { IpcResponse } from "@cch/core";

type ProjectSummary = IpcResponse<"projects:list">["projects"][number];
type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];
type SessionDetail = IpcResponse<"sessions:getDetail">;
type SearchQueryResponse = IpcResponse<"search:query">;

const PAGE_SIZE = 100;

const PROVIDERS: Provider[] = ["claude", "codex", "gemini"];
const CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_use",
  "tool_edit",
  "tool_result",
  "thinking",
  "system",
];
const DEFAULT_MESSAGE_CATEGORIES: MessageCategory[] = ["user", "assistant"];
const EMPTY_CATEGORY_COUNTS = {
  user: 0,
  assistant: 0,
  tool_use: 0,
  tool_edit: 0,
  tool_result: 0,
  thinking: 0,
  system: 0,
};
const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};
const CATEGORY_LABELS: Record<MessageCategory, string> = {
  user: "User",
  assistant: "Assistant",
  tool_use: "Tool Use",
  tool_edit: "Write",
  tool_result: "Tool Result",
  thinking: "Thinking",
  system: "System",
};

type MainView = "history" | "search";
type ProjectSortMode = "recent" | "name" | "provider";
type SessionSortMode = "recent" | "messages" | "model";

export function App() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMode, setRefreshMode] = useState<"incremental" | "force">("incremental");
  const [statusText, setStatusText] = useState("");

  const [mainView, setMainView] = useState<MainView>("history");
  const [focusMode, setFocusMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [projectQueryInput, setProjectQueryInput] = useState("");
  const [projectProviders, setProjectProviders] = useState<Provider[]>([...PROVIDERS]);
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>("recent");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionSortMode, setSessionSortMode] = useState<SessionSortMode>("recent");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>([
    ...DEFAULT_MESSAGE_CATEGORIES,
  ]);
  const [messageExpanded, setMessageExpanded] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(100);
  const [focusSourceId, setFocusSourceId] = useState("");
  const [pendingSearchNavigation, setPendingSearchNavigation] = useState<{
    projectId: string;
    sessionId: string;
    sourceId: string;
  } | null>(null);

  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchProjectQueryInput, setSearchProjectQueryInput] = useState("");
  const [searchProviders, setSearchProviders] = useState<Provider[]>([]);
  const [searchCategories, setSearchCategories] = useState<MessageCategory[]>([
    ...DEFAULT_MESSAGE_CATEGORIES,
  ]);
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchResponse, setSearchResponse] = useState<SearchQueryResponse>({
    query: "",
    totalCount: 0,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
    results: [],
  });

  const [projectPaneWidth, setProjectPaneWidth] = useState(300);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(320);
  const resizeState = useRef<{
    pane: "project" | "session";
    startX: number;
    projectPaneWidth: number;
    sessionPaneWidth: number;
  } | null>(null);

  const projectQuery = useDebouncedValue(projectQueryInput, 180);
  const sessionQuery = useDebouncedValue(sessionQueryInput, 180);
  const searchQuery = useDebouncedValue(searchQueryInput, 220);
  const searchProjectQuery = useDebouncedValue(searchProjectQueryInput, 180);

  const focusedMessageRef = useRef<HTMLDivElement | null>(null);
  const sortedProjects = useMemo(() => {
    const next = [...projects];
    next.sort((left, right) => {
      if (projectSortMode === "recent") {
        return (
          compareRecent(right.lastActivity, left.lastActivity) ||
          left.name.localeCompare(right.name)
        );
      }
      if (projectSortMode === "provider") {
        return (
          left.provider.localeCompare(right.provider) ||
          left.name.localeCompare(right.name) ||
          compareRecent(right.lastActivity, left.lastActivity)
        );
      }
      return (
        left.name.localeCompare(right.name) ||
        left.provider.localeCompare(right.provider) ||
        compareRecent(right.lastActivity, left.lastActivity)
      );
    });
    return next;
  }, [projects, projectSortMode]);

  const sortedSessions = useMemo(() => {
    const next = [...sessions];
    next.sort((left, right) => {
      if (sessionSortMode === "messages") {
        return (
          right.messageCount - left.messageCount ||
          compareRecent(sessionActivityOf(right), sessionActivityOf(left))
        );
      }
      if (sessionSortMode === "model") {
        return (
          left.modelNames.localeCompare(right.modelNames) ||
          compareRecent(sessionActivityOf(right), sessionActivityOf(left))
        );
      }
      return (
        compareRecent(sessionActivityOf(right), sessionActivityOf(left)) ||
        right.messageCount - left.messageCount
      );
    });
    return next;
  }, [sessions, sessionSortMode]);

  const loadProjects = useCallback(async () => {
    const response = await window.cch.invoke("projects:list", {
      providers: projectProviders,
      query: projectQuery,
    });
    setProjects(response.projects);
  }, [projectProviders, projectQuery]);

  const loadSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions([]);
      setSelectedSessionId("");
      return;
    }

    const response = await window.cch.invoke("sessions:list", { projectId: selectedProjectId });
    setSessions(response.sessions);
  }, [selectedProjectId]);

  const loadSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    const isAllSearchCategoriesSelected = searchCategories.length === CATEGORIES.length;
    if (trimmed.length === 0) {
      setSearchResponse({
        query: searchQuery,
        totalCount: 0,
        categoryCounts: EMPTY_CATEGORY_COUNTS,
        results: [],
      });
      return;
    }

    const response = await window.cch.invoke("search:query", {
      query: searchQuery,
      categories: isAllSearchCategoriesSelected ? undefined : searchCategories,
      providers: searchProviders.length > 0 ? searchProviders : undefined,
      projectIds: searchProjectId ? [searchProjectId] : undefined,
      projectQuery: searchProjectQuery,
      limit: 100,
      offset: 0,
    });
    setSearchResponse(response);
  }, [searchCategories, searchProjectId, searchProjectQuery, searchProviders, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    void loadProjects().catch((error: unknown) => {
      if (!cancelled) {
        setStatusText(`Failed loading projects: ${toErrorMessage(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  useEffect(() => {
    if (sortedProjects.length === 0) {
      if (!pendingSearchNavigation) {
        setSelectedProjectId("");
      }
      setSearchProjectId("");
      return;
    }

    if (
      !pendingSearchNavigation &&
      !sortedProjects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(sortedProjects[0]?.id ?? "");
    }

    if (searchProjectId && !sortedProjects.some((project) => project.id === searchProjectId)) {
      setSearchProjectId("");
    }
  }, [pendingSearchNavigation, searchProjectId, selectedProjectId, sortedProjects]);

  useEffect(() => {
    let cancelled = false;
    void loadSessions().catch((error: unknown) => {
      if (!cancelled) {
        setStatusText(`Failed loading sessions: ${toErrorMessage(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    if (sortedSessions.length === 0) {
      if (!pendingSearchNavigation) {
        setSelectedSessionId("");
      }
      return;
    }

    if (pendingSearchNavigation) {
      return;
    }

    if (!selectedSessionId || !sortedSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sortedSessions[0]?.id ?? "");
    }
  }, [pendingSearchNavigation, selectedSessionId, sortedSessions]);

  useEffect(() => {
    if (!pendingSearchNavigation) {
      return;
    }

    if (pendingSearchNavigation.projectId !== selectedProjectId) {
      setSelectedProjectId(pendingSearchNavigation.projectId);
      return;
    }

    if (!sortedSessions.some((session) => session.id === pendingSearchNavigation.sessionId)) {
      return;
    }

    setSelectedSessionId(pendingSearchNavigation.sessionId);
    setSessionPage(0);
    setFocusSourceId(pendingSearchNavigation.sourceId);
    setPendingSearchNavigation(null);
    setMainView("history");
  }, [pendingSearchNavigation, selectedProjectId, sortedSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    void window.cch
      .invoke("sessions:getDetail", {
        sessionId: selectedSessionId,
        page: sessionPage,
        pageSize: PAGE_SIZE,
        categories: isAllHistoryCategoriesSelected ? undefined : historyCategories,
        query: sessionQuery,
        focusSourceId: focusSourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSessionDetail(response);
        if (response.page !== sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatusText(`Failed loading session detail: ${toErrorMessage(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, sessionPage, historyCategories, sessionQuery, focusSourceId]);

  useEffect(() => {
    let cancelled = false;
    void loadSearch().catch((error: unknown) => {
      if (!cancelled) {
        setStatusText(`Search failed: ${toErrorMessage(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSearch]);

  const focusedMessageId = useMemo(() => {
    if (!focusSourceId || !sessionDetail?.messages) {
      return "";
    }
    return sessionDetail.messages.find((message) => message.sourceId === focusSourceId)?.id ?? "";
  }, [focusSourceId, sessionDetail?.messages]);

  useEffect(() => {
    if (!focusSourceId || !focusedMessageId || !focusedMessageRef.current) {
      return;
    }

    focusedMessageRef.current.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [focusSourceId, focusedMessageId]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeState.current;
      if (!active) {
        return;
      }

      const delta = event.clientX - active.startX;
      if (active.pane === "project") {
        setProjectPaneWidth(clamp(active.projectPaneWidth + delta, 230, 520));
        return;
      }

      setSessionPaneWidth(clamp(active.sessionPaneWidth + delta, 250, 620));
    };

    const onPointerUp = () => {
      resizeState.current = null;
      document.body.classList.remove("resizing-panels");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const handleRefresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      setRefreshMode(force ? "force" : "incremental");
      setStatusText("");
      try {
        await window.cch.invoke("indexer:refresh", { force });
        await Promise.all([loadProjects(), loadSessions(), loadSearch()]);
      } catch (error) {
        setStatusText(`Refresh failed: ${toErrorMessage(error)}`);
      } finally {
        setRefreshing(false);
      }
    },
    [loadProjects, loadSearch, loadSessions],
  );

  const handleIncrementalRefresh = useCallback(async () => {
    await handleRefresh(false);
  }, [handleRefresh]);

  const handleForceRefresh = useCallback(async () => {
    await handleRefresh(true);
  }, [handleRefresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      if (event.key === "?") {
        setShowShortcuts(true);
      } else if (event.key === "Escape") {
        setShowShortcuts(false);
      } else if (command && event.key === "1") {
        event.preventDefault();
        setMainView("history");
      } else if (command && event.key === "2") {
        event.preventDefault();
        setMainView("search");
      } else if (command && shift && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleForceRefresh();
      } else if (command && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleIncrementalRefresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleForceRefresh, handleIncrementalRefresh]);

  const selectedSession = useMemo(
    () => sortedSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sortedSessions],
  );
  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, sortedProjects],
  );
  const projectProviderCounts = useMemo(
    () => countProviders(sortedProjects.map((project) => project.provider)),
    [sortedProjects],
  );
  const searchProviderCounts = useMemo(
    () => countProviders(searchResponse.results.map((result) => result.provider)),
    [searchResponse.results],
  );

  const totalPages = useMemo(() => {
    const totalCount = sessionDetail?.totalCount ?? 0;
    if (totalCount === 0) {
      return 1;
    }
    return Math.ceil(totalCount / PAGE_SIZE);
  }, [sessionDetail?.totalCount]);

  const canZoomIn = zoom < 150;
  const canZoomOut = zoom > 80;
  const historyCategoryCounts = sessionDetail?.categoryCounts ?? EMPTY_CATEGORY_COUNTS;
  const isHistoryLayout = mainView === "history" && !focusMode;
  const workspaceStyle = isHistoryLayout
    ? {
        gridTemplateColumns: `${projectPaneWidth}px 8px ${sessionPaneWidth}px 8px minmax(420px, 1fr)`,
      }
    : undefined;

  const shortcutItems = useMemo(() => {
    const global = [
      "Cmd/Ctrl+1: History view",
      "Cmd/Ctrl+2: Search view",
      "Cmd/Ctrl+R: Refresh index",
      "Cmd/Ctrl+Shift+R: Force reindex",
      "?: Shortcut help",
      "Esc: Close shortcuts",
    ];
    const contextual =
      mainView === "history"
        ? ["Current view: History", `Selected session: ${selectedSession ? "yes" : "none"}`]
        : ["Current view: Search", `Results: ${searchResponse.totalCount}`];
    return [...contextual, ...global];
  }, [mainView, searchResponse.totalCount, selectedSession]);

  const handleCopyInfo = useCallback(async () => {
    const sessionTitle = selectedSession ? deriveSessionTitle(selectedSession) : "(none)";
    const sessionId = selectedSession?.id ?? "(none)";
    const projectName = selectedProject?.name || selectedProject?.path || "(none)";
    const projectId = selectedProject?.id ?? "(none)";
    const historyFile = selectedSession?.filePath ?? "(none)";
    const historyDir = historyFile === "(none)" ? "(none)" : parentPath(historyFile);
    const projectPath = selectedProject?.path || selectedSession?.cwd || "(none)";
    const provider = selectedSession?.provider ?? selectedProject?.provider ?? "(none)";
    const providerLabel =
      provider === "claude" || provider === "codex" || provider === "gemini"
        ? prettyProvider(provider)
        : provider;
    const content = [
      `Provider: ${providerLabel}`,
      `Project Name: ${projectName}`,
      `Project ID: ${projectId}`,
      `Project Path: ${projectPath}`,
      `Session Title: ${sessionTitle}`,
      `Session ID: ${sessionId}`,
      `History Directory: ${historyDir}`,
      `History File: ${historyFile}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(content);
      setStatusText("Copied session/project info to clipboard.");
    } catch (error) {
      setStatusText(`Copy failed: ${toErrorMessage(error)}`);
    }
  }, [selectedProject, selectedSession]);

  const beginResize =
    (pane: "project" | "session") => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isHistoryLayout) {
        return;
      }
      event.preventDefault();
      resizeState.current = {
        pane,
        startX: event.clientX,
        projectPaneWidth,
        sessionPaneWidth,
      };
      document.body.classList.add("resizing-panels");
    };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-center">
          <button
            type="button"
            className={mainView === "history" ? "tab-button active" : "tab-button"}
            onClick={() => setMainView("history")}
          >
            <ToolbarIcon name="history" />
            History
          </button>
          <button
            type="button"
            className={mainView === "search" ? "tab-button active" : "tab-button"}
            onClick={() => setMainView("search")}
          >
            <ToolbarIcon name="search" />
            Global Search
          </button>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            onClick={() => void handleIncrementalRefresh()}
            disabled={refreshing}
          >
            <ToolbarIcon name="refresh" />
            {refreshing && refreshMode === "incremental" ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" onClick={() => void handleForceRefresh()} disabled={refreshing}>
            <ToolbarIcon name="reindex" />
            {refreshing && refreshMode === "force" ? "Reindexing..." : "Force Reindex"}
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((value) => !value)}
            disabled={mainView !== "history"}
          >
            <ToolbarIcon name={focusMode ? "closeFocus" : "focus"} />
            {focusMode ? "Exit Focus" : "Focus"}
          </button>
          <button type="button" onClick={() => void handleCopyInfo()}>
            <ToolbarIcon name="copy" />
            Copy Info
          </button>
          <button type="button" onClick={() => setShowShortcuts((value) => !value)}>
            <ToolbarIcon name="shortcuts" />
            Shortcuts
          </button>
        </div>
      </header>

      {statusText ? <p className="status-line">{statusText}</p> : null}

      <div
        className={`workspace ${isHistoryLayout ? "history-layout" : "single-layout"} ${mainView === "search" ? "search-layout" : ""}`}
        style={workspaceStyle}
      >
        {isHistoryLayout ? (
          <>
            <aside className="pane project-pane">
              <div className="pane-head">
                <h2>Projects</h2>
                <div className="pane-head-controls">
                  <span>{sortedProjects.length}</span>
                  <select
                    value={projectSortMode}
                    onChange={(event) => setProjectSortMode(event.target.value as ProjectSortMode)}
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name</option>
                    <option value="provider">Provider</option>
                  </select>
                </div>
              </div>
              <input
                value={projectQueryInput}
                onChange={(event) => setProjectQueryInput(event.target.value)}
                placeholder="Filter projects"
              />
              <div className="chip-row">
                {PROVIDERS.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={`chip provider-chip provider-${provider}${
                      projectProviders.includes(provider) ? " active" : ""
                    }`}
                    onClick={() => setProjectProviders((value) => toggleValue(value, provider))}
                  >
                    {prettyProvider(provider)} ({projectProviderCounts[provider]})
                  </button>
                ))}
              </div>
              <div className="project-list">
                {sortedProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={project.id === selectedProjectId ? "list-item active" : "list-item"}
                    onClick={() => {
                      setPendingSearchNavigation(null);
                      setSelectedProjectId(project.id);
                    }}
                  >
                    <div className="item-title-row">
                      <span>{project.name || project.path || "(no project path)"}</span>
                      <small className="path-inline">{compactPath(project.path)}</small>
                    </div>
                    <small>
                      <span className={`provider-label provider-${project.provider}`}>
                        {prettyProvider(project.provider)}
                      </span>{" "}
                      | {formatDate(project.lastActivity)}
                    </small>
                  </button>
                ))}
              </div>
              {selectedProjectId ? (
                <button
                  type="button"
                  className="context-action"
                  onClick={() =>
                    void openInFileManager(sortedProjects, selectedProjectId, setStatusText)
                  }
                >
                  Open Project Location
                </button>
              ) : null}
            </aside>

            <div className="pane-resizer" onPointerDown={beginResize("project")} />

            <aside className="pane session-pane">
              <div className="pane-head">
                <h2>Sessions</h2>
                <div className="pane-head-controls">
                  <span>{sortedSessions.length}</span>
                  <select
                    value={sessionSortMode}
                    onChange={(event) => setSessionSortMode(event.target.value as SessionSortMode)}
                  >
                    <option value="recent">Recent</option>
                    <option value="messages">Messages</option>
                    <option value="model">Model</option>
                  </select>
                </div>
              </div>
              <div className="session-list">
                {sortedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={session.id === selectedSessionId ? "list-item active" : "list-item"}
                    onClick={() => {
                      setPendingSearchNavigation(null);
                      setSelectedSessionId(session.id);
                      setSessionPage(0);
                      setFocusSourceId("");
                      setMainView("history");
                    }}
                  >
                    <span className="session-title">{deriveSessionTitle(session)}</span>
                    <small>
                      {session.messageCount} msgs | {formatDate(sessionActivityOf(session))}
                    </small>
                  </button>
                ))}
              </div>
              {selectedSession ? (
                <button
                  type="button"
                  className="context-action"
                  onClick={() => void openPath(selectedSession.filePath, setStatusText)}
                >
                  Open Session Location
                </button>
              ) : null}
            </aside>

            <div className="pane-resizer" onPointerDown={beginResize("session")} />
          </>
        ) : null}

        <section className="pane content-pane" style={{ fontSize: `${zoom}%` }}>
          {mainView === "history" ? (
            <div className="history-view">
              <div className="content-head">
                <div>
                  <h2>
                    {selectedSession ? deriveSessionTitle(selectedSession) : "Session Detail"}
                  </h2>
                  <p>
                    {selectedSession ? (
                      <span className={`provider-label provider-${selectedSession.provider}`}>
                        {prettyProvider(selectedSession.provider)}
                      </span>
                    ) : (
                      "-"
                    )}{" "}
                    | {selectedSession?.messageCount ?? 0} messages
                  </p>
                </div>
                <div className="zoom-controls">
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.max(80, value - 5))}
                    disabled={!canZoomOut}
                  >
                    A-
                  </button>
                  <button type="button" onClick={() => setZoom(100)}>
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((value) => Math.min(150, value + 5))}
                    disabled={!canZoomIn}
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="filter-row">
                <input
                  value={sessionQueryInput}
                  onChange={(event) => {
                    setSessionQueryInput(event.target.value);
                    setSessionPage(0);
                  }}
                  placeholder="Search in session"
                />
                <div className="chip-row">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`chip category-chip category-${category}${
                        historyCategories.includes(category) ? " active" : ""
                      }`}
                      onClick={() => {
                        setHistoryCategories((value) =>
                          toggleValue<MessageCategory>(value, category),
                        );
                        setSessionPage(0);
                      }}
                    >
                      {prettyCategory(category)} ({historyCategoryCounts[category]})
                    </button>
                  ))}
                </div>
              </div>

              <div className="message-list">
                {sessionDetail?.messages.length ? (
                  sessionDetail.messages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      query={sessionQuery}
                      isFocused={!!focusSourceId && message.sourceId === focusSourceId}
                      isExpanded={
                        messageExpanded[message.id] ?? isMessageExpandedByDefault(message.category)
                      }
                      onToggleExpanded={() =>
                        setMessageExpanded((value) => ({
                          ...value,
                          [message.id]: !(
                            value[message.id] ?? isMessageExpandedByDefault(message.category)
                          ),
                        }))
                      }
                      onToggleFocused={() =>
                        setFocusSourceId((value) =>
                          value === message.sourceId ? "" : message.sourceId,
                        )
                      }
                      cardRef={
                        focusSourceId && message.sourceId === focusSourceId
                          ? focusedMessageRef
                          : null
                      }
                    />
                  ))
                ) : (
                  <p className="empty-state">No messages match current filters.</p>
                )}
              </div>

              <div className="pagination-row">
                <button
                  type="button"
                  onClick={() => setSessionPage((value) => Math.max(0, value - 1))}
                  disabled={sessionPage <= 0}
                >
                  Previous
                </button>
                <span>
                  Page {sessionPage + 1} / {totalPages} ({sessionDetail?.totalCount ?? 0} messages)
                </span>
                <button
                  type="button"
                  onClick={() => setSessionPage((value) => Math.min(totalPages - 1, value + 1))}
                  disabled={sessionPage + 1 >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <div className="search-view">
              <div className="content-head">
                <h2>Global Search</h2>
                <p>{searchResponse.totalCount} matches</p>
              </div>
              <div className="search-controls">
                <input
                  value={searchQueryInput}
                  onChange={(event) => setSearchQueryInput(event.target.value)}
                  placeholder="Search all message text"
                />
                <input
                  value={searchProjectQueryInput}
                  onChange={(event) => setSearchProjectQueryInput(event.target.value)}
                  placeholder="Filter by project text"
                />
                <select
                  value={searchProjectId}
                  onChange={(event) => setSearchProjectId(event.target.value)}
                >
                  <option value="">All projects</option>
                  {sortedProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {prettyProvider(project.provider)}:{" "}
                      {project.name || project.path || "(unknown project)"}
                    </option>
                  ))}
                </select>
                <div className="chip-row">
                  {PROVIDERS.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      className={`chip provider-chip provider-${provider}${
                        searchProviders.includes(provider) ? " active" : ""
                      }`}
                      onClick={() => setSearchProviders((value) => toggleValue(value, provider))}
                    >
                      {prettyProvider(provider)} ({searchProviderCounts[provider]})
                    </button>
                  ))}
                </div>
                <div className="chip-row">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`chip category-chip category-${category}${
                        searchCategories.includes(category) ? " active" : ""
                      }`}
                      onClick={() =>
                        setSearchCategories((value) =>
                          toggleRequiredValue<MessageCategory>(value, category, CATEGORIES),
                        )
                      }
                    >
                      {prettyCategory(category)} ({searchResponse.categoryCounts[category]})
                    </button>
                  ))}
                </div>
              </div>

              <div className="search-result-list">
                {searchResponse.results.length === 0 ? (
                  <p className="empty-state">No search results.</p>
                ) : (
                  searchResponse.results.map((result) => (
                    <button
                      type="button"
                      key={result.messageId}
                      className={`search-result category-${result.category}`}
                      onClick={() => {
                        setProjectProviders([...PROVIDERS]);
                        setProjectQueryInput("");
                        setPendingSearchNavigation({
                          projectId: result.projectId,
                          sessionId: result.sessionId,
                          sourceId: result.messageSourceId,
                        });
                        setSelectedProjectId(result.projectId);
                        setMainView("history");
                      }}
                    >
                      <header>
                        <span className={`category-badge category-${result.category}`}>
                          {prettyCategory(result.category)}
                        </span>
                        <small>
                          <span className={`provider-label provider-${result.provider}`}>
                            {prettyProvider(result.provider)}
                          </span>{" "}
                          | {formatDate(result.createdAt)}
                        </small>
                      </header>
                      <p className="snippet">
                        <HighlightedText text={result.snippet} query="" allowMarks />
                      </p>
                      <footer>
                        <small>
                          {result.projectName || result.projectPath || "(unknown project)"}
                        </small>
                      </footer>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {showShortcuts ? (
        <dialog open className="shortcuts-dialog">
          <h3>Keyboard Shortcuts</h3>
          {shortcutItems.map((item) => (
            <p key={`dialog-${item}`}>{item}</p>
          ))}
          <button type="button" onClick={() => setShowShortcuts(false)}>
            Close
          </button>
        </dialog>
      ) : null}
    </main>
  );
}

function ToolbarIcon({
  name,
}: {
  name:
    | "history"
    | "search"
    | "refresh"
    | "reindex"
    | "focus"
    | "closeFocus"
    | "copy"
    | "shortcuts";
}) {
  const path = (() => {
    if (name === "history") {
      return "M4 3h16v4H4zM4 10h16v4H4zM4 17h16v4H4z";
    }
    if (name === "search") {
      return "M9 3a6 6 0 1 0 0 12a6 6 0 0 0 0-12m0 2a4 4 0 1 1 0 8a4 4 0 0 1 0-8m6.5 9.1l1.4-1.4L22 18l-1.4 1.4z";
    }
    if (name === "refresh") {
      return "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4";
    }
    if (name === "reindex") {
      return "M4 4h16v6H4zM4 14h10v6H4zM16 14h4v6h-4z";
    }
    if (name === "focus") {
      return "M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M8 8h8v8H8z";
    }
    if (name === "closeFocus") {
      return "M4 4l16 16M20 4L4 20";
    }
    if (name === "copy") {
      return "M8 8h11v13H8zM5 3h11v3H8v2H5z";
    }
    return "M4 7h16M4 12h16M4 17h10";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden>
      <title>{name}</title>
      <path d={path} />
    </svg>
  );
}

function MessageCard({
  message,
  query,
  isFocused,
  isExpanded,
  onToggleExpanded,
  onToggleFocused,
  cardRef,
}: {
  message: SessionDetail["messages"][number];
  query: string;
  isFocused: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleFocused: () => void;
  cardRef?: Ref<HTMLDivElement> | null;
}) {
  const typeLabel = formatMessageTypeLabel(message.category, message.content);
  const handleToggleExpanded = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleExpanded();
  };

  return (
    <article
      className={`message-card category-${message.category}${isFocused ? " focused" : ""}`}
      ref={cardRef ?? null}
    >
      <header className="message-header">
        <div className="message-header-meta">
          <button
            type="button"
            className={`category-badge category-toggle category-${message.category}`}
            onClick={handleToggleExpanded}
            aria-expanded={isExpanded}
          >
            {typeLabel}
          </button>
          <button type="button" className="message-select-button" onClick={onToggleFocused}>
            <small>
              <span className={`provider-label provider-${message.provider}`}>
                {prettyProvider(message.provider)}
              </span>{" "}
              | {formatDate(message.createdAt)}
            </small>
          </button>
        </div>
        <button
          type="button"
          className="collapse-button"
          aria-expanded={isExpanded}
          onClick={handleToggleExpanded}
        >
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      </header>
      {isExpanded ? (
        <>
          <div className="message-content">
            <MessageContent text={message.content} category={message.category} query={query} />
          </div>
        </>
      ) : null}
    </article>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}

function toggleValue<T>(values: T[], value: T): T[] {
  if (values.includes(value)) {
    return values.filter((item) => item !== value);
  }
  return [...values, value];
}

function toggleRequiredValue<T>(values: T[], value: T, universe: readonly T[]): T[] {
  if (values.includes(value)) {
    if (values.length <= 1) {
      return values;
    }
    return values.filter((item) => item !== value);
  }

  const next = [...values, value];
  if (next.length >= universe.length) {
    return [...universe];
  }
  return next;
}

function sessionActivityOf(session: SessionSummary): string | null {
  return session.endedAt ?? session.startedAt;
}

function compareRecent(left: string | null, right: string | null): number {
  const leftTs = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
  const rightTs = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
  return leftTs - rightTs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) {
    return `Today ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

function prettyCategory(category: MessageCategory): string {
  return CATEGORY_LABELS[category];
}

function prettyProvider(provider: Provider): string {
  return PROVIDER_LABELS[provider];
}

function formatMessageTypeLabel(category: MessageCategory, content: string): string {
  if (category !== "tool_use" && category !== "tool_edit") {
    return prettyCategory(category);
  }

  const parsed = parseToolInvocationPayload(content);
  if (!parsed?.prettyName) {
    return prettyCategory(category);
  }
  return `${prettyCategory(category)}: ${parsed.prettyName}`;
}

function isMessageExpandedByDefault(category: MessageCategory): boolean {
  return category === "user" || category === "assistant";
}

function countProviders(values: Provider[]): Record<Provider, number> {
  const counts: Record<Provider, number> = { claude: 0, codex: 0, gemini: 0 };
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

function deriveSessionTitle(session: SessionSummary): string {
  const source = session.title.trim();
  if (!source) {
    return session.modelNames || session.id;
  }
  const singleLine = source.replace(/\s+/g, " ").trim();
  const words = singleLine.split(" ");
  const compactWords = words.slice(0, 12).join(" ");
  const preview = words.length > 12 ? `${compactWords}…` : compactWords;
  const maxLength = 84;
  if (preview.length <= maxLength) {
    return preview;
  }
  return `${preview.slice(0, maxLength - 1)}…`;
}

function compactPath(path: string): string {
  if (!path) {
    return "(no path)";
  }
  const unixHome = path.match(/^\/Users\/[^/]+/);
  if (unixHome) {
    return `~${path.slice(unixHome[0].length)}`;
  }

  const windowsHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  if (windowsHome) {
    return `~${path.slice(windowsHome[0].length)}`;
  }
  return path;
}

function parentPath(path: string): string {
  if (!path) {
    return "";
  }
  const separator = path.includes("\\") ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  if (index <= 0) {
    return path;
  }
  return path.slice(0, index);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

async function openInFileManager(
  projects: ProjectSummary[],
  selectedProjectId: string,
  setStatusText: (value: string) => void,
): Promise<void> {
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (!selected) {
    return;
  }
  await openPath(selected.path, setStatusText);
}

async function openPath(path: string, setStatusText: (value: string) => void): Promise<void> {
  const result = await window.cch.invoke("path:openInFileManager", { path });
  if (!result.ok) {
    setStatusText(result.error ?? `Failed to open ${path}`);
  }
}

function HighlightedText({
  text,
  query,
  allowMarks,
}: {
  text: string;
  query: string;
  allowMarks: boolean;
}) {
  if (allowMarks) {
    return <>{renderMarkedSnippet(text)}</>;
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <pre>{text}</pre>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig"));
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const [position, part] of parts.entries()) {
    const key = `${cursor}:${part.length}:${position % 2 === 1 ? "m" : "t"}`;
    if (position % 2 === 1) {
      content.push(<mark key={key}>{part}</mark>);
    } else {
      content.push(<span key={key}>{part}</span>);
    }
    cursor += part.length;
  }

  return <pre>{content}</pre>;
}

function MessageContent({
  text,
  category,
  query,
}: {
  text: string;
  category: MessageCategory;
  query: string;
}) {
  if (category === "thinking") {
    return (
      <pre className="thinking-block">{buildHighlightedTextNodes(text, query, "thinking")}</pre>
    );
  }

  if (category === "tool_edit") {
    return <ToolEditContent text={text} query={query} />;
  }

  if (category === "tool_use") {
    return <ToolUseContent text={text} query={query} />;
  }

  if (category === "tool_result") {
    return <ToolResultContent text={text} />;
  }

  return <div className="rich-block">{renderRichText(text, query, "msg")}</div>;
}

function ToolUseContent({ text, query }: { text: string; query: string }) {
  const parsed = parseToolInvocationPayload(text);
  if (!parsed) {
    const formatted = tryFormatJson(text);
    return (
      <pre className="tool-block">
        {buildHighlightedTextNodes(formatted, query, "tool-use-raw")}
      </pre>
    );
  }

  if (parsed.isWrite) {
    return <ToolEditContent text={text} query={query} />;
  }

  const command = asNonEmptyString(parsed.inputRecord?.cmd ?? parsed.inputRecord?.command);
  const targetPath = asNonEmptyString(
    parsed.inputRecord?.file_path ?? parsed.inputRecord?.path ?? parsed.inputRecord?.file,
  );

  return (
    <div className="tool-use-view">
      {parsed.prettyName ? <div className="tool-use-name">{parsed.prettyName}</div> : null}
      {targetPath ? <div className="tool-edit-path">{targetPath}</div> : null}
      {command ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Command</div>
          <CodeBlock language="shell" codeValue={command} />
        </div>
      ) : null}
      {parsed.inputRecord ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Arguments</div>
          <CodeBlock language="json" codeValue={JSON.stringify(parsed.inputRecord, null, 2)} />
        </div>
      ) : (
        <CodeBlock language="json" codeValue={JSON.stringify(parsed.record, null, 2)} />
      )}
    </div>
  );
}

function ToolResultContent({ text }: { text: string }) {
  const parsed = tryParseJsonRecord(text);
  if (!parsed) {
    const language = detectLanguageFromContent(text);
    return (
      <div className="tool-result-view">
        <CodeBlock language={language} codeValue={text} />
      </div>
    );
  }

  const output = asString(parsed.output);
  const metadata = asObject(parsed.metadata);
  const normalizedOutput = output ? output : null;
  const inner = normalizedOutput ? tryParseJsonRecord(normalizedOutput) : null;
  const outputLanguage = detectLanguageFromContent(normalizedOutput ?? "");

  return (
    <div className="tool-result-view">
      {metadata ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Metadata</div>
          <CodeBlock language="json" codeValue={JSON.stringify(metadata, null, 2)} />
        </div>
      ) : null}
      {normalizedOutput ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Output</div>
          <CodeBlock
            language={inner ? "json" : outputLanguage}
            codeValue={inner ? JSON.stringify(inner, null, 2) : normalizedOutput}
          />
        </div>
      ) : (
        <CodeBlock language="json" codeValue={JSON.stringify(parsed, null, 2)} />
      )}
    </div>
  );
}

function ToolEditContent({ text, query }: { text: string; query: string }) {
  const parsed = parseToolEditPayload(text);
  if (!parsed) {
    const formatted = tryFormatJson(text);
    return (
      <pre className="tool-block tool-edit-block">
        {buildHighlightedTextNodes(formatted, query, "tool-edit")}
      </pre>
    );
  }

  if (parsed.diff && isLikelyDiff("diff", parsed.diff)) {
    return (
      <div className="tool-edit-view">
        {parsed.filePath ? <div className="tool-edit-path">{parsed.filePath}</div> : null}
        <DiffBlock codeValue={parsed.diff} />
      </div>
    );
  }

  if (parsed.oldText !== null && parsed.newText !== null) {
    const diff = buildUnifiedDiffFromTextPair({
      oldText: parsed.oldText,
      newText: parsed.newText,
      filePath: parsed.filePath,
    });
    return (
      <div className="tool-edit-view">
        {parsed.filePath ? <div className="tool-edit-path">{parsed.filePath}</div> : null}
        <DiffBlock codeValue={diff} />
      </div>
    );
  }

  if (parsed.newText !== null) {
    return (
      <div className="tool-edit-view">
        {parsed.filePath ? <div className="tool-edit-path">{parsed.filePath}</div> : null}
        <div className="tool-use-section">
          <div className="tool-use-section-label">Written Content</div>
          <CodeBlock
            language={detectLanguageFromFilePath(parsed.filePath)}
            codeValue={parsed.newText}
          />
        </div>
      </div>
    );
  }

  const formatted = tryFormatJson(text);
  return (
    <pre className="tool-block tool-edit-block">
      {buildHighlightedTextNodes(formatted, query, "tool-edit")}
    </pre>
  );
}

function renderRichText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codeFence = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match = codeFence.exec(value);

  while (match) {
    const blockStart = match.index;
    if (blockStart > cursor) {
      const textChunk = value.slice(cursor, blockStart);
      nodes.push(renderTextChunk(textChunk, query, `${keyPrefix}:${cursor}:t`));
    }

    const language = match[1] ?? "";
    const codeValue = match[2] ?? "";
    nodes.push(
      <CodeBlock key={`${keyPrefix}:${blockStart}:c`} language={language} codeValue={codeValue} />,
    );

    cursor = blockStart + match[0].length;
    match = codeFence.exec(value);
  }

  if (cursor < value.length) {
    nodes.push(renderTextChunk(value.slice(cursor), query, `${keyPrefix}:${cursor}:tail`));
  }

  if (nodes.length === 0) {
    nodes.push(renderTextChunk(value, query, `${keyPrefix}:only`));
  }
  return nodes;
}

function renderTextChunk(value: string, query: string, keyPrefix: string): ReactNode {
  const lines = value.split(/\r?\n/);
  const items: ReactNode[] = [];
  let lineCursor = 0;
  let bulletBuffer: Array<{ key: string; content: string }> = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) {
      return;
    }

    items.push(
      <ul key={`${keyPrefix}:${bulletBuffer[0]?.key ?? "b"}:list`} className="md-list">
        {bulletBuffer.map((bullet) => (
          <li key={bullet.key}>
            {renderInlineText(bullet.content, query, `${keyPrefix}:${bullet.key}`)}
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const currentKey = `${lineCursor}`;
    lineCursor += line.length + 1;

    if (line.startsWith("- ")) {
      bulletBuffer.push({ key: currentKey, content: line.slice(2) });
      continue;
    }

    flushBullets();

    if (line.trim().length === 0) {
      items.push(<div key={`${keyPrefix}:${currentKey}:empty`} className="md-empty" />);
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const marks = headingMatch[1] ?? "";
      const level = marks.length;
      const text = headingMatch[2] ?? "";
      if (level === 1) {
        items.push(
          <h3 key={`${keyPrefix}:${currentKey}:h1`} className="md-h1">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h1`)}
          </h3>,
        );
      } else if (level === 2) {
        items.push(
          <h4 key={`${keyPrefix}:${currentKey}:h2`} className="md-h2">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h2`)}
          </h4>,
        );
      } else {
        items.push(
          <h5 key={`${keyPrefix}:${currentKey}:h3`} className="md-h3">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h3`)}
          </h5>,
        );
      }
      continue;
    }

    items.push(
      <p key={`${keyPrefix}:${currentKey}:p`} className="md-p">
        {renderInlineText(line, query, `${keyPrefix}:${currentKey}:p`)}
      </p>,
    );
  }

  flushBullets();

  return <div key={`${keyPrefix}:chunk`}>{items}</div>;
}

function renderInlineText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const tokens = value.split(/(`[^`]+`)/g);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const key = `${keyPrefix}:${cursor}`;
    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      nodes.push(<code key={`${key}:code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(...buildHighlightedTextNodes(token, query, `${key}:txt`));
    }
    cursor += token.length;
  }
  return nodes;
}

function CodeBlock({
  language,
  codeValue,
}: {
  language: string;
  codeValue: string;
}) {
  const normalizedLanguage = language.trim().toLowerCase();
  if (isLikelyDiff(normalizedLanguage, codeValue)) {
    return <DiffBlock codeValue={codeValue} />;
  }

  const lines = codeValue.split(/\r?\n/);
  const renderedLines = lines.map((line, index) => (
    <span key={`${index}:${line.length}`} className="code-line">
      {renderSyntaxHighlightedLine(line, normalizedLanguage)}
      {"\n"}
    </span>
  ));

  return (
    <div className="code-block">
      <div className="code-meta">{normalizedLanguage || "code"}</div>
      <pre className="code-pre">{renderedLines}</pre>
    </div>
  );
}

function DiffBlock({ codeValue }: { codeValue: string }) {
  const lines = codeValue.split(/\r?\n/);
  const rows: ReactNode[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineKey = `${index}:${line.length}`;
    if (line.startsWith("@@")) {
      const hunkStart = parseDiffHunkStart(line);
      if (hunkStart) {
        oldLineNumber = hunkStart.oldLine;
        newLineNumber = hunkStart.newLine;
      }
      rows.push(
        <div key={`${lineKey}:meta`} className="diff-row diff-meta">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">{line}</span>
        </div>,
      );
      index += 1;
      continue;
    }

    if (isRemovedDiffLine(line) && isAddedDiffLine(lines[index + 1] ?? "")) {
      const nextLine = lines[index + 1] ?? "";
      const inlineDiff = diffInlineSegments(line.slice(1), nextLine.slice(1));
      rows.push(
        <div key={`${lineKey}:remove`} className="diff-row diff-remove">
          <span className="diff-ln old">{oldLineNumber}</span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">
            {(() => {
              let leftCursor = 0;
              return inlineDiff.left.map((part) => {
                const key = `${lineKey}:l:${leftCursor}:${part.changed ? "1" : "0"}`;
                leftCursor += part.text.length;
                return (
                  <span key={key} className={part.changed ? "diff-word-remove" : undefined}>
                    {part.text}
                  </span>
                );
              });
            })()}
          </span>
        </div>,
      );
      rows.push(
        <div key={`${lineKey}:add`} className="diff-row diff-add">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new">{newLineNumber}</span>
          <span className="diff-code">
            {(() => {
              let rightCursor = 0;
              return inlineDiff.right.map((part) => {
                const key = `${lineKey}:r:${rightCursor}:${part.changed ? "1" : "0"}`;
                rightCursor += part.text.length;
                return (
                  <span key={key} className={part.changed ? "diff-word-add" : undefined}>
                    {part.text}
                  </span>
                );
              });
            })()}
          </span>
        </div>,
      );
      oldLineNumber += 1;
      newLineNumber += 1;
      index += 2;
      continue;
    }

    if (isAddedDiffLine(line)) {
      rows.push(
        <div key={`${lineKey}:add-only`} className="diff-row diff-add">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new">{newLineNumber}</span>
          <span className="diff-code">{line.slice(1)}</span>
        </div>,
      );
      newLineNumber += 1;
    } else if (isRemovedDiffLine(line)) {
      rows.push(
        <div key={`${lineKey}:remove-only`} className="diff-row diff-remove">
          <span className="diff-ln old">{oldLineNumber}</span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">{line.slice(1)}</span>
        </div>,
      );
      oldLineNumber += 1;
    } else if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      rows.push(
        <div key={`${lineKey}:meta`} className="diff-row diff-meta">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">{line}</span>
        </div>,
      );
    } else {
      rows.push(
        <div key={`${lineKey}:context`} className="diff-row diff-context">
          <span className="diff-ln old">{oldLineNumber}</span>
          <span className="diff-ln new">{newLineNumber}</span>
          <span className="diff-code">{line.startsWith(" ") ? line.slice(1) : line}</span>
        </div>,
      );
      oldLineNumber += 1;
      newLineNumber += 1;
    }
    index += 1;
  }

  return (
    <div className="code-block diff-block">
      <div className="code-meta">diff</div>
      <div className="diff-table">{rows}</div>
    </div>
  );
}

function renderSyntaxHighlightedLine(line: string, language: string): ReactNode[] {
  const tokens = tokenizeCodeLine(line, language);
  return tokens.map((token, index) =>
    token.kind === "plain" ? (
      <span key={`${index}:${token.text.length}`}>{token.text}</span>
    ) : (
      <span key={`${index}:${token.text.length}`} className={`tok-${token.kind}`}>
        {token.text}
      </span>
    ),
  );
}

function tokenizeCodeLine(
  line: string,
  language: string,
): Array<{ text: string; kind: "plain" | "keyword" | "string" | "number" | "comment" }> {
  const keywordSet = languageKeywords(language);
  const pattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|#.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const tokens: Array<{
    text: string;
    kind: "plain" | "keyword" | "string" | "number" | "comment";
  }> = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const value = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: line.slice(cursor, index), kind: "plain" });
    }
    if (value.startsWith("//") || value.startsWith("#")) {
      tokens.push({ text: value, kind: "comment" });
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("`") && value.endsWith("`"))
    ) {
      tokens.push({ text: value, kind: "string" });
    } else if (/^\d/.test(value)) {
      tokens.push({ text: value, kind: "number" });
    } else if (keywordSet.has(language === "sql" ? value.toUpperCase() : value)) {
      tokens.push({ text: value, kind: "keyword" });
    } else {
      tokens.push({ text: value, kind: "plain" });
    }
    cursor = index + value.length;
  }

  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor), kind: "plain" });
  }
  if (tokens.length === 0) {
    tokens.push({ text: line, kind: "plain" });
  }
  return tokens;
}

function languageKeywords(language: string): Set<string> {
  if (
    language === "js" ||
    language === "jsx" ||
    language === "ts" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "typescript"
  ) {
    return new Set([
      "const",
      "let",
      "var",
      "function",
      "return",
      "if",
      "else",
      "for",
      "while",
      "switch",
      "case",
      "break",
      "continue",
      "class",
      "extends",
      "new",
      "import",
      "from",
      "export",
      "default",
      "async",
      "await",
      "try",
      "catch",
      "finally",
      "throw",
      "type",
      "interface",
    ]);
  }
  if (language === "py" || language === "python") {
    return new Set([
      "def",
      "class",
      "if",
      "elif",
      "else",
      "for",
      "while",
      "return",
      "import",
      "from",
      "as",
      "try",
      "except",
      "finally",
      "with",
      "lambda",
      "pass",
      "raise",
      "yield",
      "async",
      "await",
    ]);
  }
  if (language === "sql") {
    return new Set([
      "SELECT",
      "FROM",
      "WHERE",
      "JOIN",
      "LEFT",
      "RIGHT",
      "INNER",
      "OUTER",
      "ON",
      "GROUP",
      "BY",
      "ORDER",
      "LIMIT",
      "OFFSET",
      "INSERT",
      "UPDATE",
      "DELETE",
      "INTO",
      "VALUES",
      "AND",
      "OR",
      "NOT",
      "AS",
    ]);
  }
  if (language === "json") {
    return new Set(["true", "false", "null"]);
  }
  if (language === "bash" || language === "sh" || language === "zsh" || language === "shell") {
    return new Set(["if", "then", "else", "fi", "for", "in", "do", "done", "case", "esac"]);
  }
  return new Set();
}

function detectLanguageFromContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "text";
  }
  if (isLikelyDiff("", value)) {
    return "diff";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJsonRecord(value);
    if (parsed || trimmed.startsWith("[")) {
      return "json";
    }
  }
  if (trimmed.includes("<html") || trimmed.includes("</")) {
    return "html";
  }
  return "text";
}

function detectLanguageFromFilePath(path: string | null): string {
  if (!path) {
    return "text";
  }
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) {
    return "typescript";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
    return "javascript";
  }
  if (normalized.endsWith(".py")) {
    return "python";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".css")) {
    return "css";
  }
  if (normalized.endsWith(".html")) {
    return "html";
  }
  if (normalized.endsWith(".sql")) {
    return "sql";
  }
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  if (normalized.endsWith(".sh") || normalized.endsWith(".zsh") || normalized.endsWith(".bash")) {
    return "shell";
  }
  return "text";
}

function isLikelyDiff(language: string, codeValue: string): boolean {
  if (language.includes("diff") || language === "patch") {
    return true;
  }
  const lines = codeValue.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  const hasStrongMarker = lines.some(
    (line) =>
      line.startsWith("@@") ||
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ "),
  );
  if (hasStrongMarker) {
    return true;
  }

  const addedLines = lines.filter((line) => isAddedDiffLine(line)).length;
  const removedLines = lines.filter((line) => isRemovedDiffLine(line)).length;
  const contextLines = lines.filter((line) => line.startsWith(" ")).length;
  return addedLines > 0 && removedLines > 0 && addedLines + removedLines + contextLines >= 4;
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++ ");
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("--- ");
}

function parseDiffHunkStart(line: string): { oldLine: number; newLine: number } | null {
  const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return null;
  }
  const oldLine = Number(match[1]);
  const newLine = Number(match[2]);
  if (!Number.isFinite(oldLine) || !Number.isFinite(newLine)) {
    return null;
  }
  return { oldLine, newLine };
}

function parseToolInvocationPayload(text: string): {
  record: Record<string, unknown>;
  name: string | null;
  prettyName: string | null;
  inputRecord: Record<string, unknown> | null;
  isWrite: boolean;
} | null {
  const record = tryParseJsonRecord(text);
  if (!record) {
    return null;
  }

  const functionCall = asObject(record.functionCall);
  const name =
    asNonEmptyString(record.name) ??
    asNonEmptyString(record.tool_name) ??
    asNonEmptyString(record.tool) ??
    asNonEmptyString(functionCall?.name) ??
    null;
  const inputRecord = asObject(record.input) ?? asObject(record.args) ?? asObject(record.arguments);
  const rawHint = [
    name,
    asNonEmptyString(record.operation),
    asNonEmptyString(inputRecord?.operation),
  ]
    .filter((value) => !!value)
    .join(" ");

  return {
    record,
    name,
    prettyName: name ? prettyToolName(name) : null,
    inputRecord,
    isWrite: looksLikeWriteOperation(rawHint),
  };
}

function prettyToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const mapped: Record<string, string> = {
    exec_command: "Execute Command",
    run_command: "Execute Command",
    command: "Execute Command",
    grep: "Grep",
    search: "Search",
    read: "Read",
    edit: "Edit",
    apply_patch: "Apply Patch",
    write: "Write",
    write_file: "Write File",
    str_replace: "Replace Text",
    multi_edit: "Multi Edit",
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function looksLikeWriteOperation(value: string): boolean {
  const normalized = value.toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    "edit",
    "write",
    "patch",
    "apply_patch",
    "replace",
    "multi_edit",
    "create_file",
    "update_file",
    "delete_file",
    "str_replace",
  ].some((hint) => normalized.includes(hint));
}

function parseToolEditPayload(text: string): {
  filePath: string | null;
  oldText: string | null;
  newText: string | null;
  diff: string | null;
} | null {
  const parsed = tryParseJsonRecord(text);
  if (!parsed) {
    return null;
  }

  const input = asObject(parsed.input);
  const args = asObject(parsed.args);
  const payload = input ?? args ?? parsed;
  const filePath =
    asNonEmptyString(payload.file_path) ??
    asNonEmptyString(payload.path) ??
    asNonEmptyString(payload.file) ??
    asNonEmptyString(parsed.file_path) ??
    asNonEmptyString(parsed.path) ??
    null;
  const oldText =
    asString(payload.old_string) ??
    asString(payload.oldText) ??
    asString(payload.before) ??
    asString(parsed.old_string) ??
    null;
  const newText =
    asString(payload.new_string) ??
    asString(payload.newText) ??
    asString(payload.after) ??
    asString(payload.content) ??
    asString(payload.text) ??
    asString(payload.write_content) ??
    asString(payload.new_content) ??
    asString(parsed.new_string) ??
    null;
  const diff =
    asNonEmptyString(payload.diff) ??
    asNonEmptyString(payload.patch) ??
    asNonEmptyString(parsed.diff) ??
    asNonEmptyString(parsed.patch) ??
    null;
  const applyPatchInput =
    asNonEmptyString(parsed.input) ??
    asNonEmptyString(payload.input) ??
    asNonEmptyString(parsed.arguments) ??
    null;
  const normalizedDiff =
    diff ??
    (looksLikeApplyPatchPayload(parsed, payload)
      ? convertApplyPatchToUnifiedDiff(applyPatchInput)
      : null);
  const normalizedFilePath = filePath ?? extractApplyPatchFirstPath(applyPatchInput);

  return { filePath: normalizedFilePath, oldText, newText, diff: normalizedDiff };
}

function buildUnifiedDiffFromTextPair(args: {
  oldText: string;
  newText: string;
  filePath: string | null;
}): string {
  const oldLines = args.oldText.split(/\r?\n/);
  const newLines = args.newText.split(/\r?\n/);
  const operations = buildLineOperations(oldLines, newLines);
  const hunks = buildDiffHunks(operations, 2);
  const headerFile = args.filePath ?? "file";
  const output: string[] = [`--- a/${headerFile}`, `+++ b/${headerFile}`];
  if (hunks.length === 0) {
    output.push("@@ -1,0 +1,0 @@");
    return output.join("\n");
  }

  for (const hunk of hunks) {
    output.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      ...hunk.lines,
    );
  }
  return output.join("\n");
}

function buildLineOperations(
  oldLines: string[],
  newLines: string[],
): Array<{ type: "equal" | "remove" | "add"; line: string; oldLine: number; newLine: number }> {
  const matrix: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const currentRow = matrix[i];
      if (!currentRow) {
        continue;
      }
      if ((oldLines[i] ?? "") === (newLines[j] ?? "")) {
        currentRow[j] = (matrix[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(matrix[i + 1]?.[j] ?? 0, currentRow[j + 1] ?? 0);
      }
    }
  }

  const operations: Array<{
    type: "equal" | "remove" | "add";
    line: string;
    oldLine: number;
    newLine: number;
  }> = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;

  while (i < oldLines.length && j < newLines.length) {
    const left = oldLines[i] ?? "";
    const right = newLines[j] ?? "";
    if (left === right) {
      operations.push({ type: "equal", line: left, oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      operations.push({ type: "remove", line: left, oldLine, newLine: 0 });
      i += 1;
      oldLine += 1;
    } else {
      operations.push({ type: "add", line: right, oldLine: 0, newLine });
      j += 1;
      newLine += 1;
    }
  }

  while (i < oldLines.length) {
    operations.push({ type: "remove", line: oldLines[i] ?? "", oldLine, newLine: 0 });
    i += 1;
    oldLine += 1;
  }
  while (j < newLines.length) {
    operations.push({ type: "add", line: newLines[j] ?? "", oldLine: 0, newLine });
    j += 1;
    newLine += 1;
  }

  return operations;
}

function buildDiffHunks(
  operations: Array<{
    type: "equal" | "remove" | "add";
    line: string;
    oldLine: number;
    newLine: number;
  }>,
  context: number,
): Array<{
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}> {
  const hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }> = [];
  let cursor = 0;
  while (cursor < operations.length) {
    let firstChange = -1;
    for (let index = cursor; index < operations.length; index += 1) {
      if (operations[index]?.type !== "equal") {
        firstChange = index;
        break;
      }
    }
    if (firstChange < 0) {
      break;
    }

    let hunkStart = Math.max(0, firstChange - context);
    let hunkEnd = firstChange;
    let lastChange = firstChange;
    for (let index = firstChange + 1; index < operations.length; index += 1) {
      const op = operations[index];
      if (!op) {
        continue;
      }
      if (op.type !== "equal") {
        lastChange = index;
      }
      if (index - lastChange > context) {
        break;
      }
      hunkEnd = index;
    }

    hunkEnd = Math.min(operations.length - 1, hunkEnd);
    if (lastChange + context > hunkEnd) {
      hunkEnd = Math.min(operations.length - 1, lastChange + context);
    }
    if (hunkStart > hunkEnd) {
      hunkStart = hunkEnd;
    }

    const hunkOps = operations.slice(hunkStart, hunkEnd + 1);
    const oldStartCandidate = hunkOps.find((op) => op.oldLine > 0)?.oldLine ?? 1;
    const newStartCandidate = hunkOps.find((op) => op.newLine > 0)?.newLine ?? 1;
    const oldCount = hunkOps.filter((op) => op.type !== "add").length;
    const newCount = hunkOps.filter((op) => op.type !== "remove").length;
    const lines = hunkOps.map((op) => {
      if (op.type === "remove") {
        return `-${op.line}`;
      }
      if (op.type === "add") {
        return `+${op.line}`;
      }
      return ` ${op.line}`;
    });
    hunks.push({
      oldStart: oldStartCandidate,
      oldCount,
      newStart: newStartCandidate,
      newCount,
      lines,
    });
    cursor = hunkEnd + 1;
  }
  return hunks;
}

function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeApplyPatchPayload(
  parsed: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const normalized = [
    asNonEmptyString(parsed.name),
    asNonEmptyString(parsed.tool),
    asNonEmptyString(parsed.type),
    asNonEmptyString(payload.operation),
    asNonEmptyString(payload.mode),
  ]
    .filter((value) => !!value)
    .join(" ")
    .toLowerCase();
  if (normalized.includes("apply_patch")) {
    return true;
  }
  return (
    asNonEmptyString(parsed.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(payload.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(parsed.arguments)?.includes("*** Begin Patch") === true
  );
}

function extractApplyPatchFirstPath(patchText: string | null): string | null {
  if (!patchText) {
    return null;
  }
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("*** Update File: ")) {
      return line.slice("*** Update File: ".length).trim() || null;
    }
    if (line.startsWith("*** Add File: ")) {
      return line.slice("*** Add File: ".length).trim() || null;
    }
    if (line.startsWith("*** Delete File: ")) {
      return line.slice("*** Delete File: ".length).trim() || null;
    }
  }
  return null;
}

function convertApplyPatchToUnifiedDiff(patchText: string | null): string | null {
  if (!patchText) {
    return null;
  }

  const lines = patchText.split(/\r?\n/);
  const output: string[] = [];
  let headerDiffIndex = -1;
  let headerOldIndex = -1;
  let headerNewIndex = -1;
  let oldPath = "";
  let newPath = "";
  let hasDiffRows = false;

  const startFile = (mode: "update" | "add" | "delete", path: string) => {
    const normalized = path.trim();
    if (!normalized) {
      return;
    }

    oldPath = mode === "add" ? "/dev/null" : `a/${normalized}`;
    newPath = mode === "delete" ? "/dev/null" : `b/${normalized}`;
    headerDiffIndex = output.length;
    output.push(`diff --git ${oldPath} ${newPath}`);
    headerOldIndex = output.length;
    output.push(`--- ${oldPath}`);
    headerNewIndex = output.length;
    output.push(`+++ ${newPath}`);
  };

  for (const line of lines) {
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "*** End of File") {
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      startFile("update", line.slice("*** Update File: ".length));
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      startFile("add", line.slice("*** Add File: ".length));
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      startFile("delete", line.slice("*** Delete File: ".length));
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      const destination = line.slice("*** Move to: ".length).trim();
      if (!destination) {
        continue;
      }
      newPath = `b/${destination}`;
      if (headerDiffIndex >= 0) {
        output[headerDiffIndex] = `diff --git ${oldPath} ${newPath}`;
      }
      if (headerNewIndex >= 0) {
        output[headerNewIndex] = `+++ ${newPath}`;
      }
      continue;
    }

    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      output.push(line);
      hasDiffRows = true;
    }
  }

  return hasDiffRows && output.length > 0 ? output.join("\n") : null;
}

function diffInlineSegments(
  left: string,
  right: string,
): {
  left: Array<{ text: string; changed: boolean }>;
  right: Array<{ text: string; changed: boolean }>;
} {
  const leftTokens = left.split(/(\s+)/).filter((part) => part.length > 0);
  const rightTokens = right.split(/(\s+)/).filter((part) => part.length > 0);
  const matrix: number[][] = Array.from({ length: leftTokens.length + 1 }, () =>
    Array.from({ length: rightTokens.length + 1 }, () => 0),
  );

  for (let i = leftTokens.length - 1; i >= 0; i -= 1) {
    for (let j = rightTokens.length - 1; j >= 0; j -= 1) {
      const leftToken = leftTokens[i] ?? "";
      const rightToken = rightTokens[j] ?? "";
      const currentRow = matrix[i];
      if (!currentRow) {
        continue;
      }
      if (leftToken === rightToken) {
        currentRow[j] = (matrix[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(matrix[i + 1]?.[j] ?? 0, currentRow[j + 1] ?? 0);
      }
    }
  }

  const leftParts: Array<{ text: string; changed: boolean }> = [];
  const rightParts: Array<{ text: string; changed: boolean }> = [];
  let i = 0;
  let j = 0;
  while (i < leftTokens.length && j < rightTokens.length) {
    const leftToken = leftTokens[i] ?? "";
    const rightToken = rightTokens[j] ?? "";
    if (leftToken === rightToken) {
      leftParts.push({ text: leftToken, changed: false });
      rightParts.push({ text: rightToken, changed: false });
      i += 1;
      j += 1;
      continue;
    }
    if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      leftParts.push({ text: leftToken, changed: true });
      i += 1;
      continue;
    }
    rightParts.push({ text: rightToken, changed: true });
    j += 1;
  }

  while (i < leftTokens.length) {
    leftParts.push({ text: leftTokens[i] ?? "", changed: true });
    i += 1;
  }
  while (j < rightTokens.length) {
    rightParts.push({ text: rightTokens[j] ?? "", changed: true });
    j += 1;
  }

  return { left: leftParts, right: rightParts };
}

function buildHighlightedTextNodes(value: string, query: string, keyPrefix: string): ReactNode[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [<span key={`${keyPrefix}:all`}>{value}</span>];
  }

  const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig");
  const parts = value.split(matcher);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [index, part] of parts.entries()) {
    const key = `${keyPrefix}:${cursor}:${part.length}`;
    if (index % 2 === 1) {
      nodes.push(<mark key={`${key}:m`}>{part}</mark>);
    } else if (part.length > 0) {
      nodes.push(<span key={`${key}:t`}>{part}</span>);
    }
    cursor += part.length;
  }
  return nodes;
}

function renderMarkedSnippet(value: string): ReactNode {
  const segments = value.split(/(<\/?mark>)/g);
  let markOpen = false;
  let cursor = 0;
  const content: ReactNode[] = [];

  for (const segment of segments) {
    if (segment === "<mark>") {
      markOpen = true;
      cursor += segment.length;
      continue;
    }
    if (segment === "</mark>") {
      markOpen = false;
      cursor += segment.length;
      continue;
    }

    const key = `${cursor}:${segment.length}:${markOpen ? "m" : "t"}`;
    if (markOpen) {
      content.push(<mark key={key}>{segment}</mark>);
    } else {
      content.push(<span key={key}>{segment}</span>);
    }
    cursor += segment.length;
  }

  return content;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tryFormatJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}
