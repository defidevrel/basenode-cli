/** Validate typical HTTP(S) / WS(S) endpoint strings for wizard flags. */
export function isProbablyUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

export function ensureNonEmpty(label: string, value: string): string {
  const v = value.trim();
  if (!v) throw new Error(`${label} is required`);
  return v;
}

/** Set `KEY=value` on the first matching assignment line, or append at EOF. */
export function setEnvVarLine(
  contents: string,
  key: string,
  value: string
): { next: string; changed: boolean } {
  const lines = contents.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let changed = false;
  let found = false;
  const nextLines = lines.map((line) => {
    if (re.test(line)) {
      found = true;
      const next = `${key}=${value}`;
      if (line !== next) changed = true;
      return next;
    }
    return line;
  });
  if (!found) {
    changed = true;
    nextLines.push(`${key}=${value}`);
  }
  return { next: nextLines.join("\n"), changed };
}

/**
 * If `# KEY=...` exists, replace that commented line with `KEY=value`.
 * Otherwise behaves like `setEnvVarLine`.
 */
export function uncommentOrSet(
  contents: string,
  key: string,
  value: string
): { next: string; changed: boolean } {
  const commentRe = new RegExp(`^\\s*#\\s*${key}\\s*=.*$`, "m");
  if (commentRe.test(contents)) {
    const next = contents.replace(commentRe, `${key}=${value}`);
    return { next, changed: next !== contents };
  }
  return setEnvVarLine(contents, key, value);
}

/** Read the first non-comment assignment for `KEY=value` in a dotenv-like file. */
export function readDotEnvValue(contents: string, key: string): string | undefined {
  const lines = contents.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = re.exec(line);
    if (!m) continue;
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v || undefined;
  }
  return undefined;
}
