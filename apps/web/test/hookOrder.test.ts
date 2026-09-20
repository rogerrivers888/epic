/**
 * A hook below an early return is a screen that throws itself away.
 *
 * React counts the hooks a component calls and expects the same number every
 * render. A `useState` written *after* an `if (cat) return …` is skipped the
 * moment a category is opened, React raises error #300 — "rendered fewer hooks
 * than expected" — and the error boundary replaces the whole back office with
 * "Epic stopped working". Try again then works, because a remount reads the
 * category straight off the address and never takes the long branch, which is
 * exactly what makes it look intermittent rather than broken (owner, 20 Sep
 * 2026, Places › SL5 › Food & drink).
 *
 * Nothing on the screen says this is coming and nothing in the build catches
 * it: there is no eslint here, and `tsc` is happy. So it is pinned by reading
 * the source, the way the census pins its prices.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Any `useSomething(` — the naming rule is the only thing that makes a hook a
// hook, and this screen's own set is far wider than React's (useViewport,
// useSession, useQueryState, useAnchor …). Naming them one by one would pass a
// board whose crash came from the one nobody added to the list.
const HOOK = /\buse[A-Z]\w*\s*\(/;
const COMPONENT = /^(export\s+)?(default\s+)?function\s+([A-Z]\w*)/;

function tsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsx(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/**
 * Every hook that sits under a return the component can take before reaching it.
 *
 * A return counts as an early one when it is in the component's own body, or
 * one block in under an `if` / `else` there — the two shapes a screen actually
 * uses to bail out. A return inside a callback, a `map` or a nested helper is
 * not an early return and is left alone.
 */
function lateHooks(source: string) {
  const lines = source.split('\n');
  const found: { component: string; hook: number; afterReturn: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = COMPONENT.exec(lines[i]);
    if (!head) continue;
    const name = head[3];
    let depth = 0;
    let open = false;
    let end = i;
    while (end < lines.length) {
      depth += (lines[end].match(/{/g) ?? []).length - (lines[end].match(/}/g) ?? []).length;
      if (lines[end].includes('{')) open = true;
      if (open && depth <= 0) break;
      end += 1;
    }
    const body = lines.slice(i, end + 1);
    let d = (body[0].match(/{/g) ?? []).length - (body[0].match(/}/g) ?? []).length;
    const blocks: boolean[] = [];
    let ret: number | null = null;
    for (let k = 1; k < body.length; k += 1) {
      const line = body[k];
      const opens = (line.match(/{/g) ?? []).length;
      const closes = (line.match(/}/g) ?? []).length;
      const conditional = /^\s*(if|else)\b/.test(line);
      // `return …` on its own line, and `if (place) return <Board />;` on one —
      // this screen uses both, and reading only the first form would let a hook
      // under the second through (Codex, 20 Sep 2026).
      const returns = /^\s*return\b/.test(line) || /^\s*(\}\s*)?(else\s+)?if\s*\(.*\)\s*return\b/.test(line) || /^\s*else\s+return\b/.test(line);
      if (ret == null && returns && (d === 1 || (d === 2 && blocks[blocks.length - 1]))) ret = k;
      if (ret != null && d === 1 && HOOK.test(line)) {
        found.push({ component: name, hook: i + 1 + k, afterReturn: i + 1 + ret });
        ret = null;
      }
      for (let n = 0; n < opens; n += 1) blocks.push(conditional);
      for (let n = 0; n < closes; n += 1) blocks.pop();
      d += opens - closes;
    }
    i = end;
  }
  return found;
}

test('no screen calls a hook below a return it can take first', () => {
  const offenders: string[] = [];
  for (const path of tsx(join(import.meta.dirname, '..', 'src'))) {
    for (const f of lateHooks(readFileSync(path, 'utf8'))) {
      offenders.push(`${path.replace(/.*\/src\//, 'src/')}:${f.hook} — ${f.component} calls a hook after the return on line ${f.afterReturn}`);
    }
  }
  assert.deepEqual(offenders, [], `Move these hooks above the early return:\n${offenders.join('\n')}`);
});

test('the reader can still see the shape it is looking for', () => {
  // The rule is only worth having if it still catches the thing that broke
  // Places, so the shape that broke it is kept here as the bench.
  const broken = [
    'function CategoryBoard({ cat }) {',
    '  const [data, setData] = useState(null);',
    '  if (cat) {',
    '    return <Sub />;',
    '  }',
    '  const [sort, setSort] = useState("known");',
    '  return <Board />;',
    '}',
  ].join('\n');
  assert.equal(lateHooks(broken).length, 1);

  // And a return inside a callback is not an early return.
  const fine = [
    'function Board({ rows }) {',
    '  const cells = rows.map((r) => {',
    '    if (!r) return null;',
    '    return r.label;',
    '  });',
    '  const [sort, setSort] = useState("known");',
    '  return <Ladder cells={cells} sort={sort} />;',
    '}',
  ].join('\n');
  assert.equal(lateHooks(fine).length, 0);

  // The form this screen actually uses to bail out, all on one line.
  const oneLine = [
    'function Places() {',
    '  const [place, setPlace] = useQueryState("place", "");',
    '  if (place) return <PlaceBoard refId={place} />;',
    '  const [tab, setTab] = useState("record");',
    '  return <Level tab={tab} />;',
    '}',
  ].join('\n');
  assert.equal(lateHooks(oneLine).length, 1);
});
