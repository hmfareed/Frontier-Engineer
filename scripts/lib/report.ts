import type { CheckResult, Finding, Severity } from "./types.ts";

const ORDER: Severity[] = ["error", "warning", "note"];

export function countBySeverity(results: CheckResult[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, note: 0 };
  for (const result of results) {
    for (const finding of result.findings) {
      counts[finding.severity] += 1;
    }
  }
  return counts;
}

export function formatReport(results: CheckResult[]): string {
  const lines: string[] = ["Frontier Engineer foundation validation", ""];

  for (const result of results) {
    const ordered = [...result.findings].sort(
      (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
    );
    lines.push(`[${result.name}] ${ordered.length === 0 ? "ok" : `${ordered.length} finding(s)`}`);
    for (const finding of ordered) {
      lines.push(
        `  ${finding.severity.toUpperCase().padEnd(7)} ${finding.file} :: ${finding.rule} :: ${finding.message}`,
      );
    }
  }

  const counts = countBySeverity(results);
  lines.push("");
  lines.push(
    `Summary: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.note} note(s).`,
  );
  if (counts.error > 0) {
    lines.push("Critical checks failed. Fix every ERROR above before proceeding.");
  } else {
    lines.push("All critical checks passed.");
  }
  return lines.join("\n");
}

export function finding(severity: Severity, rule: string, file: string, message: string): Finding {
  return { severity, rule, file, message };
}
