export class NotImplementedError extends Error {
  constructor(what: string, task: string) {
    super(`${what} is not implemented yet (task ${task}, see docs/TASKS.md)`);
    this.name = "NotImplementedError";
  }
}
