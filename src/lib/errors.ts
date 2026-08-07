export class CliError extends Error {
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

export function assertValue<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null || value === "") {
    throw new CliError(message);
  }
  return value;
}
