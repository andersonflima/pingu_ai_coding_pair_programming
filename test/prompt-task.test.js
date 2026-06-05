'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPromptTaskRequest,
  resolvePromptTask,
  trimBoundaryNewlines,
} = require('../lib/prompt-task');

test('buildPromptTaskRequest captures selected range and constraints', () => {
  const request = buildPromptTaskRequest({
    file: '/tmp/sample.js',
    language: 'javascript',
    prompt: 'corrige esse bloco',
    lines: ['const a = 1', 'const b = 2', 'console.log(a + b)'],
    startLine: 2,
    endLine: 3,
    cursorLine: 3,
    cursorColumn: 8,
  });

  assert.equal(request.mode, 'prompt_task');
  assert.equal(request.prompt, 'corrige esse bloco');
  assert.equal(request.selectedText, 'const b = 2\nconsole.log(a + b)');
  assert.deepEqual(request.selection, { startLine: 2, endLine: 3, hasExplicitRange: false });
  assert.deepEqual(request.context, { startLine: 1, endLine: 3, radius: 80 });
  assert.equal(request.constraints.some((item) => item.includes('range selecionado')), true);
  assert.equal(request.constraints.some((item) => item.includes('indentacao relativa')), true);
  assert.equal(request.constraints.some((item) => item.includes('espacos iniciais')), true);
});

test('buildPromptTaskRequest limits provider context around selected range', () => {
  const lines = Array.from({ length: 20 }, (_value, index) => `line ${index + 1}`);
  const request = buildPromptTaskRequest({
    file: '/tmp/sample.ex',
    language: 'elixir',
    prompt: 'corrige bloco',
    lines,
    startLine: 10,
    endLine: 11,
    contextRadius: 2,
  });

  assert.deepEqual(request.lines, [
    'line 8',
    'line 9',
    'line 10',
    'line 11',
    'line 12',
    'line 13',
  ]);
  assert.deepEqual(request.context, { startLine: 8, endLine: 13, radius: 2 });
  assert.equal(request.selectedText, 'line 10\nline 11');
});

test('buildPromptTaskRequest accepts zero context radius for selected range only', () => {
  const request = buildPromptTaskRequest({
    file: '/tmp/sample.ex',
    language: 'elixir',
    prompt: 'corrige bloco',
    lines: ['line 1', 'line 2', 'line 3'],
    startLine: 2,
    endLine: 2,
    contextRadius: 0,
  });

  assert.deepEqual(request.lines, ['line 2']);
  assert.deepEqual(request.context, { startLine: 2, endLine: 2, radius: 0 });
});

test('trimBoundaryNewlines preserves indentation inside prompt snippets', () => {
  const snippet = '\n      Logger.debug("a")\n      Logger.debug("b")\n';
  assert.equal(
    trimBoundaryNewlines(snippet),
    '      Logger.debug("a")\n      Logger.debug("b")',
  );
});

test('resolvePromptTask returns replace_range issue for provider snippet', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: (request) => ({
      snippet: `${request.selectedText};`,
      message: 'Bloco ajustado',
      suggestion: 'Aplicar ajuste',
      action: {},
    }),
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.js',
    prompt: 'adicione ponto e virgula',
    lines: ['const a = 1', 'const b = 2'],
    startLine: 2,
    endLine: 2,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.kind, 'prompt_task');
  assert.equal(result.issue.snippet, 'const b = 2;');
  assert.deepEqual(result.issue.action, {
    op: 'replace_range',
    indent: '',
    range: {
      start: { line: 1, character: 0 },
      end: { line: 2, character: 0 },
    },
  });
});

test('resolvePromptTask preserves provider snippet indentation and exposes base indent', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: () => ({
      snippet: '\n      Logger.debug("a")\n      Logger.debug("b")\n',
      message: 'Bloco ajustado',
      suggestion: 'Aplicar ajuste',
      action: {},
    }),
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.ex',
    prompt: 'corrige logs',
    lines: ['      Logger.debug("old")'],
    startLine: 1,
    endLine: 1,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(
    result.issue.snippet,
    '      Logger.debug("a")\n      Logger.debug("b")',
  );
  assert.equal(result.issue.action.indent, '      ');
});

test('resolvePromptTask remove comentarios localmente quando provider retorna vazio', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: () => null,
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.py',
    prompt: 'remova os comentarios do codigo',
    lines: [
      '# comentario inicial',
      'def run(value):  # comentario inline',
      '    text = "# nao e comentario"',
      '',
      '    return value',
    ],
    startLine: 1,
    endLine: 5,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.providerFallbackReason, 'empty_provider_response');
  assert.equal(
    result.issue.snippet,
    'def run(value):\n    text = "# nao e comentario"\n\n    return value',
  );
  assert.deepEqual(result.issue.action.range, {
    start: { line: 0, character: 0 },
    end: { line: 5, character: 0 },
  });
});

test('resolvePromptTask remove comentarios do arquivo aberto quando nao ha range explicito', () => {
  let providerRequest;
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: (request) => {
      providerRequest = request;
      return null;
    },
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.py',
    prompt: 'remova os comentarios do codigo aberto',
    lines: [
      '# comentario inicial',
      'def run(value):',
      '    text = "# nao e comentario"',
      '    return value  # comentario inline',
    ],
    selectedText: 'def run(value):',
    startLine: 2,
    endLine: 2,
    hasExplicitRange: false,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(providerRequest.allLines, undefined);
  assert.equal(result.issue.providerFallbackReason, 'empty_provider_response');
  assert.equal(result.issue.line, 1);
  assert.equal(
    result.issue.snippet,
    'def run(value):\n    text = "# nao e comentario"\n    return value',
  );
  assert.deepEqual(result.issue.action.range, {
    start: { line: 0, character: 0 },
    end: { line: 4, character: 0 },
  });
});

test('resolvePromptTask remove docstring Python quando usuario pede remover comentarios', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: () => null,
  };

  const result = resolvePromptTask({
    file: '/tmp/farm.py',
    language: 'python',
    prompt: 'remova os comentarios do codigo',
    lines: [
      'def helper(planta, fert):',
      '    def interna():',
      '        """',
      '        Executa a etapa principal de interna preservando o contrato esperado',
      '',
      '        Args:',
      '          Nenhum argumento recebido.',
      '',
      '        Returns:',
      '          Any: Valor calculado conforme a regra principal da funcao.',
      '        """',
      '        use_item(fert)',
      '        plant(planta)',
      '',
      '    return interna',
    ],
    selectedText: '        Executa a etapa principal de interna preservando o contrato esperado',
    startLine: 4,
    endLine: 4,
    hasExplicitRange: false,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(
    result.issue.snippet,
    'def helper(planta, fert):\n'
      + '    def interna():\n'
      + '        use_item(fert)\n'
      + '        plant(planta)\n'
      + '\n'
      + '    return interna',
  );
  assert.deepEqual(result.issue.action.range, {
    start: { line: 0, character: 0 },
    end: { line: 15, character: 0 },
  });
});

test('resolvePromptTask remove comentarios localmente quando provider esta indisponivel', () => {
  const provider = {
    hasOpenAiConfiguration: () => false,
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.js',
    prompt: 'remove comments',
    lines: [
      'const value = 1; // inline',
      '// remove esta linha',
      'const label = "http://example.test";',
    ],
    startLine: 1,
    endLine: 3,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.providerFallbackReason, 'provider_unavailable');
  assert.equal(result.issue.snippet, 'const value = 1;\nconst label = "http://example.test";');
});

test('resolvePromptTask refuses direct terminal action from provider', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: () => ({
      snippet: 'npm test',
      action: { op: 'run_command', command: 'npm test' },
    }),
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.js',
    prompt: 'rode os testes',
    lines: ['const a = 1'],
    startLine: 1,
    endLine: 1,
  }, { provider });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'terminal_action_requires_terminal_task');
});
