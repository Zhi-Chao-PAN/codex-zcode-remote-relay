export function summarizeWorkspaceList(list) {
  const workspaces = Array.isArray(list?.workspaces) ? list.workspaces : [];
  return {
    activeWorkspaceKey: list?.activeWorkspaceKey,
    activeTaskId: list?.activeTaskId,
    workspaceCount: workspaces.length,
    workspaces: workspaces.map(workspace => ({
      key: workspace.key,
      label: workspace.label || workspace.name || workspace.workspaceName || workspace.workspacePath,
      taskCount: Array.isArray(workspace.tasks) ? workspace.tasks.length : 0,
      tasks: Array.isArray(workspace.tasks)
        ? workspace.tasks.map(task => ({
            id: task.id || task.taskId,
            title: task.title,
            model: task.model || task.currentModel
          }))
        : []
    }))
  };
}

export function summarizeSnapshot(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const assistantMessages = messages.filter(message => message?.info?.role === 'assistant' || message?.role === 'assistant');
  const userMessages = messages.filter(message => message?.info?.role === 'user' || message?.role === 'user');
  const lastMessage = messages.at(-1);
  return {
    title: snapshot?.title || snapshot?.meta?.title,
    runtimeStatus: snapshot?.runtimeStatus || snapshot?.runtime?.activeTurnKind || snapshot?.meta?.status,
    currentModel: snapshot?.settings?.model?.current || snapshot?.currentModel || snapshot?.meta?.model,
    provider: snapshot?.meta?.provider,
    pendingElicitationCount: Array.isArray(snapshot?.runtime?.pendingElicitations) ? snapshot.runtime.pendingElicitations.length : 0,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    lastMessageRole: lastMessage?.info?.role || lastMessage?.role,
    lastMessagePreview: previewMessage(lastMessage)
  };
}

export function previewMessage(message, maxLength = 300) {
  const text = extractMessageText(message);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function extractMessageText(message) {
  if (!message) return '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (typeof message.info?.text === 'string') return message.info.text;
  if (Array.isArray(message.parts)) return message.parts.map(extractPartText).filter(Boolean).join('\n');
  if (Array.isArray(message.content)) return message.content.map(extractPartText).filter(Boolean).join('\n');
  if (Array.isArray(message.messages)) return message.messages.map(extractMessageText).filter(Boolean).join('\n');
  return '';
}

function extractPartText(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (typeof part.value === 'string') return part.value;
  return '';
}
