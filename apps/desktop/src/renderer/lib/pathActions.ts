type ProjectPathLike = {
  id: string;
  path: string;
};

export async function openInFileManager(
  projects: ProjectPathLike[],
  selectedProjectId: string,
  setStatusText: (value: string) => void,
): Promise<void> {
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (!selected) {
    return;
  }
  await openPath(selected.path, setStatusText);
}

export async function openPath(
  path: string,
  setStatusText: (value: string) => void,
): Promise<void> {
  const result = await window.cch.invoke("path:openInFileManager", { path });
  if (!result.ok) {
    setStatusText(result.error ?? `Failed to open ${path}`);
  }
}
