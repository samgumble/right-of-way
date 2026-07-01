/** A tiny hand-rolled Markdown-to-HTML converter — not a general-purpose parser, just
 * enough for GUIDE.md's actual constructs (h1/h2, bullet lists, bold, inline code,
 * paragraphs). Extends the project's "hand-write the math" precedent (catenary solver,
 * terrain noise, procedural audio) into markdown rendering rather than adding a
 * dependency for a few hundred words of static content. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '') {
      closeList();
      continue;
    }
    if (line.startsWith('## ')) {
      closeList();
      html.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      closeList();
      html.push(`<h1>${inline(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return html.join('\n');
}

/** Bold and inline-code spans, applied after escaping so the source text can't inject
 * markup — the `<strong>`/`<code>` tags inserted here are the only "real" HTML added. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
