import readline from 'node:readline';
import { PromptInterrupted, readHiddenLine } from './prompt.js';
import { runSetup, type SetupIo } from './run-setup.js';

const USAGE = [
  'Usage: npm run setup [-- --password-stdin]',
  '  Chooses the dashboard administrator password and writes it, with a JWT_SECRET, into the env file the server reads.',
  '  --password-stdin  read the password from one line of piped or redirected standard input (for Docker and CI);',
  '                    when standard input is a terminal the password is asked for with echo off, as without the option',
  '  The password is never taken from a command-line argument.',
].join('\n');

function readStdinLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
      const end = text.indexOf('\n');
      if (end >= 0) {
        process.stdin.pause();
        resolve(text.slice(0, end).replace(/\r$/, ''));
      }
    });
    process.stdin.on('end', () => resolve(text.replace(/\r$/, '')));
    process.stdin.on('error', reject);
  });
}

function askLine(question: string): Promise<string> {
  const lines = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => lines.question(question, (answer) => { lines.close(); resolve(answer); }));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (args.some((arg) => arg !== '--password-stdin')) {
    console.error(`Unknown option.\n${USAGE}`);
    return 1;
  }
  const io: SetupIo = {
    interactive: process.stdin.isTTY === true,
    askHidden: (question) => readHiddenLine(question, process.stdin as never, process.stdout),
    askLine,
    readStdinLine,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
  try {
    return await runSetup(io, { passwordStdin: args.includes('--password-stdin') });
  } catch (error) {
    if (error instanceof PromptInterrupted) {
      console.error('Cancelled. Nothing was changed.');
      return 130;
    }
    console.error(`Setup failed: ${(error as Error).message}`);
    return 1;
  }
}

process.exitCode = await main();
