import { PassThrough } from 'node:stream';
import { PromptInterrupted, readHiddenLine, type HiddenInput } from '../../src/setup/prompt.js';

function terminal() {
  const stream = new PassThrough() as PassThrough & HiddenInput;
  const rawModes: boolean[] = [];
  stream.setRawMode = (mode: boolean) => { rawModes.push(mode); return stream; };
  let shown = '';
  return { stream, rawModes, output: { write: (text: string) => { shown += text; } }, shown: () => shown };
}

describe('hidden password prompt', () => {
  it('returns what was typed, handles backspace, and echoes only the question and a line break', async () => {
    const term = terminal();
    const answer = readHiddenLine('Password: ', term.stream, term.output);
    term.stream.write('secrex');
    term.stream.write('\u007ft1\r');

    expect(await answer).toBe('secret1');
    expect(term.shown()).toBe('Password: \n');
    expect(term.rawModes).toEqual([true, false]);
  });

  it('takes a pasted line in one chunk', async () => {
    const term = terminal();
    const answer = readHiddenLine('', term.stream, term.output);
    term.stream.write('pasted-password-1\n');
    expect(await answer).toBe('pasted-password-1');
  });

  it('is cancelled by Ctrl-C and restores the terminal', async () => {
    const term = terminal();
    const answer = readHiddenLine('', term.stream, term.output);
    term.stream.write('abc\u0003');
    await expect(answer).rejects.toBeInstanceOf(PromptInterrupted);
    expect(term.rawModes).toEqual([true, false]);
  });
});
