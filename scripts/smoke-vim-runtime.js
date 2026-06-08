'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${shellQuote(command)}`], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function vimString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function writeSmokeScript(tempDir) {
  const sourceFile = path.join(tempDir, 'sample.js');
  const scriptFile = path.join(tempDir, 'smoke.vim');

  fs.writeFileSync(sourceFile, 'function soma(a, b) {\n  return a + b\n}\n', 'utf8');
  fs.writeFileSync(scriptFile, [
    'set nomore',
    'let g:pingu_start_on_editor_enter = 0',
    'let g:pingu_open_window_on_start = 0',
    `execute 'set runtimepath^=' . fnameescape(${vimString(ROOT)})`,
    'runtime plugin/pingu_dev_agent.vim',
    `execute 'edit ' . fnameescape(${vimString(sourceFile)})`,
    "if exists(':PinguCheck') == 0",
    "  echoerr 'PinguCheck ausente'",
    '  cquit',
    'endif',
    'quitall!',
    '',
  ].join('\n'), 'utf8');

  return scriptFile;
}

function runSmoke(command, args) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pingu-${command}-smoke-`));
  const scriptFile = writeSmokeScript(tempDir);
  const result = spawnSync(command, [...args, '-S', scriptFile], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} smoke falhou\n${output}`);
  }

  process.stdout.write(`${command} smoke ok\n`);
}

function run() {
  const runners = [
    {
      command: 'nvim',
      args: ['--headless', '-u', 'NONE', '-i', 'NONE'],
    },
    {
      command: 'vim',
      args: ['-Nu', 'NONE', '-n', '-es'],
    },
  ].filter((runner) => commandExists(runner.command));

  if (runners.length === 0) {
    process.stdout.write('vim smoke skipped: vim/nvim ausentes\n');
    return;
  }

  runners.forEach((runner) => runSmoke(runner.command, runner.args));
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(1);
}
