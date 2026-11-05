// Turns GitHub alert blockquotes (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
// `[!CAUTION]`) into titled callouts instead of showing the marker as literal text.
type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, string> };
};

const ALERT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/iu;

export function remarkGithubAlerts() {
  return (tree: MarkdownNode): void => markAlerts(tree);
}

function markAlerts(node: MarkdownNode): void {
  if (node.type === 'blockquote') markAlert(node);
  node.children?.forEach(markAlerts);
}

function markAlert(blockquote: MarkdownNode): void {
  const paragraph = blockquote.children?.[0];
  const text = paragraph?.type === 'paragraph' ? paragraph.children?.[0] : undefined;
  const match = text?.type === 'text' ? ALERT_MARKER.exec(text.value ?? '') : null;
  if (!paragraph || !text || !match) return;

  const kind = match[1].toLowerCase();
  text.value = (text.value ?? '').slice(match[0].length);
  // A marker alone on its line leaves an empty first text node (or a leading break).
  if (!text.value && paragraph.children?.[1]?.type === 'break') paragraph.children.splice(0, 2);
  else if (!text.value) paragraph.children?.shift();
  if (!paragraph.children?.length) blockquote.children?.shift();
  blockquote.data = { hProperties: { 'data-alert': kind, 'data-alert-title': ALERT_TITLES[kind] } };
}
