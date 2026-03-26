export class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  async spawn(prompt, config) {
    throw new Error(`${this.name}: spawn() not implemented`);
  }

  buildArgs(prompt, config) {
    throw new Error(`${this.name}: buildArgs() not implemented`);
  }
}
