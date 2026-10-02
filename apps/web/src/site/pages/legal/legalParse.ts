/**
 * The legal pack's Markdown, read into blocks (LegalMarkdown draws them): `###`
 * headings, paragraphs, `- ` lists and `| … |` tables — the `---` row skipped.
 */

export type Block =
  | { kind: 'h'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parseLegal(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('### ')) { out.push({ kind: 'h', text: line.slice(4).trim() }); continue; }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2).trim()); i += 1; }
      i -= 1;
      out.push({ kind: 'ul', items });
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!/^\|\s*-{3,}/.test(lines[i].trim())) rows.push(cells(lines[i]));
        i += 1;
      }
      i -= 1;
      const [head, ...body] = rows;
      out.push({ kind: 'table', head: head ?? [], rows: body });
      continue;
    }
    out.push({ kind: 'p', text: line.trim() });
  }
  return out;
}
