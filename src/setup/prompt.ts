export class PromptInterrupted extends Error {
  constructor() {
    super('Cancelled');
  }
}

export interface HiddenInput {
  setEncoding(encoding: BufferEncoding): unknown;
  setRawMode(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  off(event: 'data', listener: (chunk: string) => void): unknown;
}

/** Reads one line from a terminal without echoing what is typed. Ctrl-C and Ctrl-D cancel. */
export function readHiddenLine(question: string, input: HiddenInput, output: { write(text: string): unknown }): Promise<string> {
  return new Promise((resolve, reject) => {
    let typed = '';
    const finish = (settle: () => void) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      settle();
    };
    const onData = (chunk: string) => {
      if (chunk.startsWith('\u001b')) return;
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(() => resolve(typed));
        if (char === '\u0003' || char === '\u0004') return finish(() => reject(new PromptInterrupted()));
        if (char === '\u007f' || char === '\b') typed = typed.slice(0, -1);
        else if (char >= ' ') typed += char;
      }
    };
    output.write(question);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.on('data', onData);
    input.resume();
  });
}
