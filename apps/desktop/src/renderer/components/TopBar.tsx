import { ToolbarIcon } from "./ToolbarIcon";

export function TopBar({
  mainView,
  refreshing,
  refreshMode,
  focusMode,
  focusDisabled,
  onSelectHistory,
  onSelectSearch,
  onIncrementalRefresh,
  onForceRefresh,
  onToggleFocus,
  onCopyInfo,
  onToggleShortcuts,
}: {
  mainView: "history" | "search";
  refreshing: boolean;
  refreshMode: "incremental" | "force";
  focusMode: boolean;
  focusDisabled: boolean;
  onSelectHistory: () => void;
  onSelectSearch: () => void;
  onIncrementalRefresh: () => void;
  onForceRefresh: () => void;
  onToggleFocus: () => void;
  onCopyInfo: () => void;
  onToggleShortcuts: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-center">
        <button
          type="button"
          className={mainView === "history" ? "tab-button active" : "tab-button"}
          onClick={onSelectHistory}
        >
          <ToolbarIcon name="history" />
          History
        </button>
        <button
          type="button"
          className={mainView === "search" ? "tab-button active" : "tab-button"}
          onClick={onSelectSearch}
        >
          <ToolbarIcon name="search" />
          Global Search
        </button>
      </div>
      <div className="topbar-actions">
        <button type="button" onClick={onIncrementalRefresh} disabled={refreshing}>
          <ToolbarIcon name="refresh" />
          {refreshing && refreshMode === "incremental" ? "Refreshing..." : "Refresh"}
        </button>
        <button type="button" onClick={onForceRefresh} disabled={refreshing}>
          <ToolbarIcon name="reindex" />
          {refreshing && refreshMode === "force" ? "Reindexing..." : "Force Reindex"}
        </button>
        <button type="button" onClick={onToggleFocus} disabled={focusDisabled}>
          <ToolbarIcon name={focusMode ? "closeFocus" : "focus"} />
          {focusMode ? "Exit Focus" : "Focus"}
        </button>
        <button type="button" onClick={onCopyInfo}>
          <ToolbarIcon name="copy" />
          Copy Info
        </button>
        <button type="button" onClick={onToggleShortcuts}>
          <ToolbarIcon name="shortcuts" />
          Shortcuts
        </button>
      </div>
    </header>
  );
}
