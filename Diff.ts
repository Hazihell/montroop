// a line of a diff: kept, dropped from the old text or added in the new
type Line = { op: " " | "-" | "+"; text: string };

// a run of changes with the lines around them
type Hunk = { old_line: number; new_line: number; lines: Line[] };

const AROUND = 2;

// past this many cells, the middle of two texts is shown dropped then added
const CELLS = 4e6;

export namespace Diff {

  export function lines(a: string, b: string): Line[] {
    const [x, y] = [a.split("\n"), b.split("\n")];
    let head = 0;
    while (head < x.length && head < y.length && x[head] === y[head]) {
      head++;
    }
    let tail = 0;
    while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) {
      tail++;
    }
    const keep = (text: string): Line => ({ op: " ", text });
    const [xs, ys] = [x.slice(head, x.length - tail), y.slice(head, y.length - tail)];
    const middle = xs.length * ys.length > CELLS ? [...xs.map((text): Line => ({ op: "-", text })), ...ys.map((text): Line => ({ op: "+", text }))] : Diff.common(xs, ys);
    return [...x.slice(0, head).map(keep), ...middle, ...x.slice(x.length - tail).map(keep)];
  }

  // the longest common subsequence of two lists of lines, walked into a diff
  export function common(xs: string[], ys: string[]): Line[] {
    const [n, m] = [xs.length, ys.length];
    const t = new Uint32Array((n + 1) * (m + 1));
    const at = (i: number, j: number) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[at(i, j)] = xs[i] === ys[j] ? t[at(i + 1, j + 1)] + 1 : Math.max(t[at(i + 1, j)], t[at(i, j + 1)]);
      }
    }
    const out: Line[] = [];
    let [i, j] = [0, 0];
    while (i < n && j < m) {
      if (xs[i] === ys[j]) {
        out.push({ op: " ", text: xs[i] });
        [i, j] = [i + 1, j + 1];
      } else if (t[at(i + 1, j)] >= t[at(i, j + 1)]) {
        out.push({ op: "-", text: xs[i++] });
      } else {
        out.push({ op: "+", text: ys[j++] });
      }
    }
    return [...out, ...xs.slice(i).map((text): Line => ({ op: "-", text })), ...ys.slice(j).map((text): Line => ({ op: "+", text }))];
  }

  export function hunks(a: string, b: string): Hunk[] {
    const all = Diff.lines(a, b);
    let [i, j] = [1, 1];
    const at = all.map((line) => {
      const here = [i, j];
      i += line.op === "+" ? 0 : 1;
      j += line.op === "-" ? 0 : 1;
      return here;
    });
    const changed = all.flatMap((line, k) => (line.op === " " ? [] : [k]));
    const out: Hunk[] = [];
    for (let k = 0; k < changed.length; k++) {
      const from = Math.max(0, changed[k] - AROUND);
      while (k + 1 < changed.length && changed[k + 1] - changed[k] - 1 <= 2 * AROUND) {
        k++;
      }
      out.push({ old_line: at[from][0], new_line: at[from][1], lines: all.slice(from, Math.min(all.length, changed[k] + AROUND + 1)) });
    }
    return out;
  }

  // a unified diff, cut after most lines
  export function unified(a: string, b: string, most: number): string {
    const out = Diff.hunks(a, b).flatMap((h) => {
      const [olds, news] = [h.lines.filter((l) => l.op !== "+").length, h.lines.filter((l) => l.op !== "-").length];
      return ["@@ -" + h.old_line + "," + olds + " +" + h.new_line + "," + news + " @@", ...h.lines.map((l) => l.op + l.text)];
    });
    return out.length <= most ? out.join("\n") : [...out.slice(0, most), "… " + (out.length - most) + " more lines"].join("\n");
  }

}
