/**
 * Output helper for commands that support the --json flag.
 * In JSON mode, stdout contains only newline-delimited JSON objects (one event per line) with a "type" property, it
 * makes the CLI easy to drive from scripts and AI agents. Human readable messages are written otherwise.
 */
export class CliOutput {
  public readonly isJson: boolean;

  public constructor(isJson: boolean) {
    this.isJson = isJson;
  }

  // Human readable message, ignored in JSON mode.
  public log(message: string) {
    if (!this.isJson) {
      console.log(message);
    }
  }

  // Structured event, written only in JSON mode.
  public event(type: string, payload: Record<string, unknown> = {}) {
    if (this.isJson) {
      console.log(JSON.stringify({ type, ...payload }));
    }
  }

  // Writes the message in human mode or the event in JSON mode.
  public logOrEvent(message: string, type: string, payload: Record<string, unknown> = {}) {
    if (this.isJson) {
      this.event(type, payload);
    } else {
      console.log(message);
    }
  }

  public error(message: string, payload: Record<string, unknown> = {}) {
    if (this.isJson) {
      console.log(JSON.stringify({ type: 'error', message, ...payload }));
    } else {
      console.error(message);
    }
  }

  // Writes a final result, JSON mode prints the data, human mode prints the lines.
  public result(data: unknown, humanLines: () => string[]) {
    if (this.isJson) {
      console.log(JSON.stringify({ type: 'result', data }));
      return;
    }

    for (const line of humanLines()) {
      console.log(line);
    }
  }
}
