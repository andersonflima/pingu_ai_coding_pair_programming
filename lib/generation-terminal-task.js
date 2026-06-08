'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { enrichTerminalActionRisk } = require('./terminal-risk');

function createTerminalTaskTools(deps) {
  const {
    analysisExtension,
    isGoExtension,
    isPythonLikeExtension,
    isRubyExtension,
    isRustExtension,
    pathExists,
    resolveProjectRoot,
    safeComment,
  } = deps;

  function inferTerminalTaskAction(file, instruction) {
    const normalizedInstruction = safeComment(instruction);
    const lowerInstruction = normalizedInstruction.toLowerCase();
    const projectRoot = resolveProjectRoot(file);
    const packageContext = readPackageContext(projectRoot);
    const explicitCommitMessage = extractCommitMessage(normalizedInstruction);
    const explicitCommand = extractExplicitTerminalCommand(normalizedInstruction);

    if (explicitCommand) {
      return buildTerminalAction(projectRoot, explicitCommand, explicitCommand);
    }

    if (/\b(?:pwd|diretorio atual|diretório atual|working directory|current directory)\b/.test(lowerInstruction)) {
      return buildTerminalAction(projectRoot, 'pwd', 'pwd');
    }
    if (
      /\bls\s+-la\b/.test(lowerInstruction)
      || (/\b(?:lista|listar|liste|ls)\b/.test(lowerInstruction)
        && /\b(?:arquivos?|diretorio|diretório|pasta|projeto|files?)\b/.test(lowerInstruction))
    ) {
      return buildTerminalAction(projectRoot, 'ls -la', 'ls -la');
    }
    if (/\b(?:git\s+)?status\b/.test(lowerInstruction)) {
      return buildTerminalAction(projectRoot, 'git status --short --branch', 'git status --short --branch');
    }
    if (/\b(?:git\s+)?diff\b/.test(lowerInstruction)) {
      return buildTerminalAction(projectRoot, 'git diff --stat', 'git diff --stat');
    }
    if (/\b(?:git\s+)?commit(?:ar|e|a|ar)?\b|\bcommite\b|\bcommit\b/.test(lowerInstruction)) {
      const commitMessage = explicitCommitMessage || defaultCommitMessage(file, normalizedInstruction);
      return buildTerminalAction(
        projectRoot,
        `git add -A && git commit -m ${shellQuote(commitMessage)}`,
        `git add -A && git commit -m ${commitMessage}`,
      );
    }
    if (/\b(?:instalar|instale|install)\b.*\b(?:dependencias|dependência|dependencias|deps|dependencies)\b/.test(lowerInstruction)) {
      const installCommand = inferProjectInstallCommand(projectRoot, packageContext);
      return installCommand ? buildTerminalAction(projectRoot, installCommand, installCommand) : null;
    }
    if (/\b(?:lint|lintar)\b/.test(lowerInstruction)) {
      const lintCommand = inferProjectLintCommand(file, projectRoot, packageContext);
      return lintCommand ? buildTerminalAction(projectRoot, lintCommand, lintCommand) : null;
    }
    if (/\b(?:format|formatar|fmt)\b/.test(lowerInstruction)) {
      const formatCommand = inferProjectFormatCommand(file, projectRoot, packageContext);
      return formatCommand ? buildTerminalAction(projectRoot, formatCommand, formatCommand) : null;
    }
    if (/\b(?:build|compilar|compile)\b/.test(lowerInstruction)) {
      const buildCommand = inferProjectBuildCommand(file, projectRoot, packageContext);
      return buildCommand ? buildTerminalAction(projectRoot, buildCommand, buildCommand) : null;
    }
    if (/\b(?:teste|testes|test|tests)\b/.test(lowerInstruction)) {
      const testCommand = inferProjectTestCommand(file, projectRoot, packageContext);
      return testCommand ? buildTerminalAction(projectRoot, testCommand, testCommand) : null;
    }
    if (/\b(?:rodar|rode|executar|execute|run|iniciar|subir)\b/.test(lowerInstruction)) {
      const runCommand = inferProjectRunCommand(file, projectRoot, packageContext, lowerInstruction);
      if (runCommand) {
        return buildTerminalAction(projectRoot, runCommand, runCommand);
      }
    }

    return null;
  }

  function extractExplicitTerminalCommand(instruction) {
    const normalizedInstruction = String(instruction || '').trim();
    if (!normalizedInstruction) {
      return '';
    }

    if (/^(?:\.{1,2}\/|\/)/.test(normalizedInstruction)) {
      return normalizedInstruction;
    }

    const directCommandPattern = /^(?:git|npm|pnpm|yarn|bun|npx|node|python|python3|pytest|pip|pip3|go|cargo|mix|sh|bash|zsh|fish|make|docker|docker-compose|kubectl|helm|terraform|ansible|echo|printf|pwd|ls|cat|grep|rg|bundle|busted|rspec|rake)\b/i;
    if (!directCommandPattern.test(normalizedInstruction)) {
      return '';
    }

    return normalizedInstruction;
  }

  function buildTerminalAction(cwd, command, description) {
    return enrichTerminalActionRisk({
      cwd,
      command,
      description,
    });
  }

  function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
  }

  function vimHeadlessSourceCommand(file) {
    return `nvim --headless -u NONE -i NONE -S ${shellQuote(file)} +qa!`;
  }

  function defaultCommitMessage(file, instruction) {
    const base = path.basename(file || 'arquivo');
    const normalizedInstruction = safeComment(instruction);
    if (!normalizedInstruction) {
      return `chore: atualiza ${base}`;
    }
    return `chore: ${normalizedInstruction}`.slice(0, 120);
  }

  function extractCommitMessage(instruction) {
    const source = String(instruction || '').trim();
    if (!source) {
      return '';
    }

    const quotedMessage = source.match(/["']([^"']+)["']/);
    if (quotedMessage && quotedMessage[1]) {
      return safeComment(quotedMessage[1]);
    }

    const colonMessage = source.match(/\bcommit(?:ar|e|a|ar)?\b\s*:?\s*(.+)$/i);
    if (!colonMessage || !colonMessage[1]) {
      return '';
    }

    const normalized = safeComment(colonMessage[1]);
    if (!normalized || /^(do projeto|das mudancas|das mudanças|agora)$/i.test(normalized)) {
      return '';
    }
    return normalized;
  }

  function readPackageContext(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!pathExists(packageJsonPath)) {
      return null;
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return {
        manager: detectPackageManager(projectRoot),
        scripts: packageJson && typeof packageJson.scripts === 'object' ? packageJson.scripts : {},
      };
    } catch (_error) {
      return {
        manager: detectPackageManager(projectRoot),
        scripts: {},
      };
    }
  }

  function detectPackageManager(projectRoot) {
    if (pathExists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (pathExists(path.join(projectRoot, 'yarn.lock'))) {
      return 'yarn';
    }
    if (pathExists(path.join(projectRoot, 'bun.lockb')) || pathExists(path.join(projectRoot, 'bun.lock'))) {
      return 'bun';
    }
    return 'npm';
  }

  function packageScriptCommand(packageContext, scriptName) {
    if (!packageContext || !packageContext.scripts || !packageContext.scripts[scriptName]) {
      return '';
    }
    return `${packageContext.manager} run ${scriptName}`;
  }

  function inferProjectInstallCommand(projectRoot, packageContext) {
    const pythonCommand = preferredPythonCommand(projectRoot);
    if (packageContext) {
      return `${packageContext.manager} install`;
    }
    if (pathExists(path.join(projectRoot, 'mix.exs'))) {
      return 'mix deps.get';
    }
    if (pathExists(path.join(projectRoot, 'go.mod'))) {
      return 'go mod tidy';
    }
    if (pathExists(path.join(projectRoot, 'Cargo.toml'))) {
      return 'cargo fetch';
    }
    if (pythonCommand && pathExists(path.join(projectRoot, 'requirements.txt'))) {
      return `${pythonCommand} -m pip install -r requirements.txt`;
    }
    return '';
  }

  function inferProjectTestCommand(file, projectRoot, packageContext) {
    const ext = analysisExtension(file);
    const hasTestsDirectory = pathExists(path.join(projectRoot, 'tests')) || pathExists(path.join(projectRoot, 'test'));
    const pythonCommand = preferredPythonCommand(projectRoot);
    if (['.ex', '.exs'].includes(ext) || pathExists(path.join(projectRoot, 'mix.exs'))) {
      return 'mix test';
    }
    const packageCommand = packageScriptCommand(packageContext, 'test');
    if (packageCommand) {
      return packageCommand;
    }
    if (packageContext) {
      return `${packageContext.manager} test`;
    }
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      return 'npm test';
    }
    if (['.c', '.cpp', '.h', '.hpp'].includes(ext)) {
      if (pathExists(path.join(projectRoot, 'CMakeLists.txt')) || pathExists(path.join(projectRoot, 'CTestTestfile.cmake'))) {
        return 'ctest --output-on-failure';
      }
      if (pathExists(path.join(projectRoot, 'Makefile')) || pathExists(path.join(projectRoot, 'makefile')) || pathExists(path.join(projectRoot, 'GNUmakefile'))) {
        return 'make test';
      }
      if (hasTestsDirectory) {
        return inferPortableCTestCommand(projectRoot);
      }
    }
    if (isGoExtension(ext) || pathExists(path.join(projectRoot, 'go.mod'))) {
      return 'go test ./...';
    }
    if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
      return 'cargo test';
    }
    if (pythonCommand && (isPythonLikeExtension(ext) || pathExists(path.join(projectRoot, 'pyproject.toml')) || pathExists(path.join(projectRoot, 'requirements.txt')))) {
      return `${pythonCommand} -m pytest`;
    }
    if (isRubyExtension(ext) || pathExists(path.join(projectRoot, 'Gemfile'))) {
      if (pathExists(path.join(projectRoot, 'test'))) {
        return inferPortableRubyTestCommand('test');
      }
      if (pathExists(path.join(projectRoot, 'tests'))) {
        return inferPortableRubyTestCommand('tests');
      }
    }
    if (ext === '.vim') {
      return vimHeadlessSourceCommand(file);
    }
    if (ext === '.lua') {
      return `lua ${shellQuote(file)}`;
    }
    if (hasTestsDirectory && ['.c', '.cpp', '.h', '.hpp'].includes(ext)) {
      return inferPortableCTestCommand(projectRoot);
    }
    if (hasTestsDirectory) {
      return 'make test';
    }
    return '';
  }

  function inferPortableCTestCommand(projectRoot) {
    const preferredCompiler = detectCCompiler(projectRoot);
    const testsRoots = ['tests', 'test']
      .filter((entry) => pathExists(path.join(projectRoot, entry)))
      .join(' ');
    if (!preferredCompiler || !testsRoots) {
      return '';
    }

    const quotedCompiler = shellQuote(preferredCompiler);
    return [
      'test_files=$(find',
      testsRoots,
      `-type f \\( -name '*_test.c' -o -name '*.test.c' \\) 2>/dev/null);`,
      '[ -n "$test_files" ] || { echo "Nenhum teste C encontrado em test/ ou tests/" >&2; exit 2; };',
      'printf "%s\\n" "$test_files" | while IFS= read -r test_file; do',
      '  [ -n "$test_file" ] || continue;',
      '  printf "[Pingu] compilando teste C: %s\\n" "$test_file";',
      '  test_bin=$(mktemp /tmp/pingu-dev-agent-c-test.XXXXXX);',
      `  ${quotedCompiler} "$test_file" -o "$test_bin" || exit $?;`,
      '  printf "[Pingu] executando binario de teste: %s\\n" "$test_bin";',
      '  "$test_bin" || { status=$?; rm -f "$test_bin"; exit "$status"; };',
      '  rm -f "$test_bin";',
      'done',
    ].join(' ');
  }

  function inferPortableRubyTestCommand(testDirectory) {
    const normalizedDirectory = String(testDirectory || '').trim();
    if (!normalizedDirectory) {
      return '';
    }

    return [
      `test_files=$(find ${normalizedDirectory} -type f -name '*_test.rb' 2>/dev/null);`,
      `[ -n "$test_files" ] || { echo "Nenhum teste Ruby encontrado em ${normalizedDirectory}/" >&2; exit 2; };`,
      `ruby -I${normalizedDirectory} $test_files`,
    ].join(' ');
  }

  function detectCCompiler(projectRoot) {
    const candidates = [
      process.env.CC,
      'cc',
      'gcc',
      'clang',
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (commandExists(candidate, projectRoot)) {
        return candidate;
      }
    }

    return '';
  }

  function preferredExistingCommand(projectRoot, candidates) {
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (commandExists(candidate, projectRoot)) {
        return candidate;
      }
    }
    return '';
  }

  function preferredPythonCommand(projectRoot) {
    return preferredExistingCommand(projectRoot, ['python', 'python3']);
  }

  function commandExists(command, cwd) {
    try {
      const resolved = spawnSync('sh', ['-lc', `command -v ${shellQuote(command)}`], {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return resolved.status === 0;
    } catch (_error) {
      return false;
    }
  }

  function inferProjectBuildCommand(file, projectRoot, packageContext) {
    const packageCommand = packageScriptCommand(packageContext, 'build');
    if (packageCommand) {
      return packageCommand;
    }

    const ext = analysisExtension(file);
    if (['.ex', '.exs'].includes(ext) || pathExists(path.join(projectRoot, 'mix.exs'))) {
      return 'mix compile';
    }
    if (isGoExtension(ext) || pathExists(path.join(projectRoot, 'go.mod'))) {
      return 'go build ./...';
    }
    if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
      return 'cargo build';
    }
    return '';
  }

  function inferProjectLintCommand(file, projectRoot, packageContext) {
    const packageCommand = packageScriptCommand(packageContext, 'lint');
    if (packageCommand) {
      return packageCommand;
    }

    const ext = analysisExtension(file);
    const pythonCommand = preferredPythonCommand(projectRoot);
    if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
      return 'cargo clippy';
    }
    if (pythonCommand && isPythonLikeExtension(ext)) {
      return `${pythonCommand} -m py_compile ${shellQuote(file)}`;
    }
    return '';
  }

  function inferProjectFormatCommand(file, projectRoot, packageContext) {
    const packageCommand = packageScriptCommand(packageContext, 'format');
    if (packageCommand) {
      return packageCommand;
    }

    const ext = analysisExtension(file);
    if (['.ex', '.exs'].includes(ext) || pathExists(path.join(projectRoot, 'mix.exs'))) {
      return 'mix format';
    }
    if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
      return 'cargo fmt';
    }
    if (isGoExtension(ext)) {
      return `gofmt -w ${shellQuote(file)}`;
    }
    return '';
  }

  function inferProjectRunCommand(file, projectRoot, packageContext, lowerInstruction) {
    if (/\b(?:app|aplicacao|aplicação|projeto|dev|servidor|server)\b/.test(lowerInstruction)) {
      const packageDev = packageScriptCommand(packageContext, 'dev');
      if (packageDev) {
        return packageDev;
      }
      const packageStart = packageScriptCommand(packageContext, 'start');
      if (packageStart) {
        return packageStart;
      }
      if (pathExists(path.join(projectRoot, 'mix.exs'))) {
        return 'mix run';
      }
      if (pathExists(path.join(projectRoot, 'Cargo.toml'))) {
        return 'cargo run';
      }
    }

    const ext = analysisExtension(file);
    const pythonCommand = preferredPythonCommand(projectRoot);
    if (['.js', '.cjs', '.mjs'].includes(ext)) {
      return `node ${shellQuote(file)}`;
    }
    if (pythonCommand && isPythonLikeExtension(ext)) {
      return `${pythonCommand} ${shellQuote(file)}`;
    }
    if (isRubyExtension(ext)) {
      return `ruby ${shellQuote(file)}`;
    }
    if (ext === '.lua') {
      return `lua ${shellQuote(file)}`;
    }
    if (ext === '.sh') {
      return `bash ${shellQuote(file)}`;
    }
    if (isGoExtension(ext)) {
      return `go run ${shellQuote(file)}`;
    }
    if (ext === '.exs') {
      return `elixir ${shellQuote(file)}`;
    }
    if (ext === '.vim') {
      return vimHeadlessSourceCommand(file);
    }
    return '';
  }

  return {
    inferTerminalTaskAction,
  };
}

module.exports = {
  createTerminalTaskTools,
};
