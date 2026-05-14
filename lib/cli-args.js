'use strict';

const DEFAULT_MAX_LINE_LENGTH = 120;

const OPTION_DEFINITIONS = Object.freeze([
  { names: ['--analyze'], key: 'analyze', withValue: true },
  { names: ['--source-path'], key: 'sourcePath', withValue: true },
  { names: ['--stdin'], key: 'stdin', withValue: false, transform: () => true },
  { names: ['--vim'], key: 'output', withValue: false, transform: () => 'vim' },
  { names: ['--json'], key: 'output', withValue: false, transform: () => 'json' },
  { names: ['--max-line-length'], key: 'maxLineLength', withValue: true, transform: (value) => Number.parseInt(String(value), 10) },
  { names: ['--format'], key: 'format', withValue: true, transform: (value) => String(value || '').trim() },
  { names: ['--analysis-mode'], key: 'analysisMode', withValue: true },
  { names: ['--focus-start-line'], key: 'focusStartLine', withValue: true, transform: (value) => Number.parseInt(String(value), 10) },
  { names: ['--focus-end-line'], key: 'focusEndLine', withValue: true, transform: (value) => Number.parseInt(String(value), 10) },
  { names: ['--autofix-guard'], key: 'guardMode', withValue: false, transform: (_value, args) => {
    if (args) {
      args.output = 'json';
    }
    return true;
  } },
  { names: ['--serve'], key: 'serveMode', withValue: false, transform: () => true },
  { names: ['--help', '-h'], key: 'help', withValue: false, transform: () => true },
  { names: ['--write'], key: 'write', withValue: false, transform: () => true },
  { names: ['--force'], key: 'force', withValue: false, transform: () => true },
  { names: ['--dry-run'], key: 'write', withValue: false, transform: () => false },
  { names: ['--check'], key: 'check', withValue: false, transform: () => true },
  { names: ['--with-ai'], key: 'withAi', withValue: false, transform: () => true },
  { names: ['--kind', '--kinds'], key: 'kinds', withValue: true, transform: (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean) },
  { names: ['--min-confidence'], key: 'minConfidence', withValue: true, transform: (value) => Number.parseFloat(String(value)) },
  { names: ['--lines'], key: 'profileLines', withValue: true, transform: (value) => Number.parseInt(String(value), 10) },
]);

function createOptionIndex() {
  return OPTION_DEFINITIONS.reduce((index, definition) => {
    definition.names.forEach((name) => {
      index.set(name, definition);
    });
    return index;
  }, new Map());
}

const OPTION_INDEX = createOptionIndex();

function parseArgTokens(rawArgs = []) {
  const args = {
    output: 'text',
    maxLineLength: DEFAULT_MAX_LINE_LENGTH,
    stdin: false,
    guardMode: false,
    serveMode: false,
  };
  const normalizedArgs = Array.isArray(rawArgs) ? rawArgs : [];

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const option = String(normalizedArgs[index] || '');
    const definition = OPTION_INDEX.get(option);

    if (!definition) {
      continue;
    }

    if (definition.withValue) {
      const rawValue = normalizedArgs[index + 1];
      if (typeof rawValue === 'undefined') {
        continue;
      }
      index += 1;
      const value = definition.key === 'format'
        ? definition.transform(rawValue)
        : definition.transform ? definition.transform(rawValue) : rawValue;

      if (definition.key === 'format') {
        args.output = value || args.output;
        continue;
      }
      if (definition.key === 'output') {
        args[definition.key] = value || args.output;
        continue;
      }

      args[definition.key] = value;
      continue;
    }

    if (definition.key === 'check' && definition.transform) {
      args[definition.key] = definition.transform(args);
      args.write = false;
      continue;
    }

    const resolvedValue = definition.transform(undefined, args);
    args[definition.key] = resolvedValue;
    if (definition.key === 'output') {
      args.output = resolvedValue;
    }
  }
  return args;
}

function positionalArgs(rawArgs = []) {
  const tokens = Array.isArray(rawArgs) ? rawArgs : [];
  const options = positionalAwareTokens(tokens);
  return options;
}

function positionalAwareTokens(rawArgs = []) {
  const tokens = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = String(rawArgs[index] || '');
    if (!current || current.startsWith('-')) {
      if (optionConsumesNextValue(current)) {
        index += 1;
      }
      continue;
    }
    tokens.push(current);
  }
  return tokens;
}

function optionConsumesNextValue(option) {
  const definition = OPTION_INDEX.get(option);
  return Boolean(definition && definition.withValue);
}

module.exports = {
  DEFAULT_MAX_LINE_LENGTH,
  parseArgTokens,
  positionalArgs,
  optionConsumesNextValue,
  parseArgs: parseArgTokens,
};
