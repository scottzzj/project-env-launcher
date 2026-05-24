import { spawn } from 'node:child_process';

const commands = [
  ['api', 'node', ['--disable-warning=ExperimentalWarning', 'server/index.js']],
  ['web', 'npm.cmd', ['run', 'dev']],
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });

  return child;
});

function shutdown() {
  for (const child of children) {
    child.kill();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
