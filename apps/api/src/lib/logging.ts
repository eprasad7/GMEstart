type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}
