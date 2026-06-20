'use strict';

const {
  isElixirExtension,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isRubyExtension,
  supportsHashComments,
  supportsSlashComments,
} = require('./language-profiles');

function checkCommonDeveloperErrors(lines, file, kind, opts = {}) {
  const focusRange = opts.focusRange || null;
  const checks = [
    checkLooseEquality,
    checkAssignmentInCondition,
    checkPythonNoneComparison,
    checkPythonBareExcept,
    checkPythonMutableDefaultArg,
    checkRubyNilComparison,
    checkElixirNilComparison,
  ];

  return (Array.isArray(lines) ? lines : []).flatMap((line, index) => {
    if (!isLineInsideFocusRange(focusRange, index + 1)) {
      return [];
    }

    return checks
      .map((check) => check(String(line || ''), file, kind, index + 1))
      .filter(Boolean);
  });
}

function isLineInsideFocusRange(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  const normalizedLine = Number.isFinite(lineNumber) ? lineNumber : Number.parseInt(String(lineNumber || 0), 10);
  return normalizedLine >= focusRange.start && normalizedLine <= focusRange.end;
}

function checkLooseEquality(line, file, kind, lineNumber) {
  if (!isJavaScriptLikeExtension(kind)) {
    return null;
  }

  const snippet = rewriteCodeSegments(line, kind, replaceJavaScriptLooseEquality);
  if (snippet === line) {
    return null;
  }

  return buildDeveloperErrorIssue({
    file,
    line: lineNumber,
    kind: 'loose_equality',
    message: 'Comparacao frouxa detectada',
    suggestion: 'Use igualdade estrita para evitar coercao implicita de tipo.',
    snippet,
  });
}

function checkAssignmentInCondition(line, file, kind, lineNumber) {
  if (!isJavaScriptLikeExtension(kind)) {
    return null;
  }

  const condition = extractConditionExpression(line, kind);
  if (!condition) {
    return null;
  }
  // Parenteses duplos sao a convencao para assinalar atribuicao intencional.
  if (condition.includes('((')) {
    return null;
  }

  // LHS identificador/acesso seguido de um unico '=' (nao ==, ===, =>, <=, >=, !=, +=...).
  const assignmentPattern = /(?:^|[(&|!,\s])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*)\s=(?![=>])\s/;
  if (!assignmentPattern.test(condition)) {
    return null;
  }

  const snippet = rewriteCodeSegments(line, kind, (code) =>
    code.replace(/((?:^|[(&|!,\s])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*\s)=(?![=>])(\s)/g, '$1===$2'));
  if (snippet === line) {
    return null;
  }

  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'assignment_in_condition',
    message: 'Atribuicao dentro de condicao: provavel comparacao pretendida',
    suggestion: 'Use === para comparar. Se a atribuicao for intencional, envolva em parenteses duplos para deixar explicito.',
    snippet,
    action: { op: 'replace_line' },
  };
}

function maskProtectedSegments(line, kind) {
  return splitCodeProtectedSegments(String(line || ''), kind)
    .map((segment) => (segment.kind === 'code' ? segment.text : ' '.repeat(segment.text.length)))
    .join('');
}

function extractConditionExpression(line, kind) {
  const source = maskProtectedSegments(line, kind);
  const match = source.match(/\b(?:if|while)\s*\(/);
  if (!match) {
    return '';
  }
  const openIndex = source.indexOf('(', match.index);
  if (openIndex < 0) {
    return '';
  }
  let depth = 0;
  for (let cursor = openIndex; cursor < source.length; cursor += 1) {
    const current = source[cursor];
    if (current === '(') {
      depth += 1;
    } else if (current === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, cursor + 1);
      }
    }
  }
  return source.slice(openIndex);
}

function checkPythonNoneComparison(line, file, kind, lineNumber) {
  if (!isPythonLikeExtension(kind)) {
    return null;
  }

  const snippet = rewriteCodeSegments(line, kind, replacePythonNoneComparison);
  if (snippet === line) {
    return null;
  }

  return buildDeveloperErrorIssue({
    file,
    line: lineNumber,
    kind: 'none_comparison',
    message: 'Comparacao com None usando operador de igualdade',
    suggestion: 'Use is/is not para comparar identidade com None em Python.',
    snippet,
  });
}

function checkPythonMutableDefaultArg(line, file, kind, lineNumber) {
  if (!isPythonLikeExtension(kind)) {
    return null;
  }
  const header = String(line || '').match(/^\s*(?:async\s+)?def\s+\w+\s*\((.*)\)\s*(?:->[^:]+)?:/);
  if (!header) {
    return null;
  }
  const mutable = header[1].match(/(\w+)\s*=\s*(\[|\{|(?:dict|list|set)\s*\()/);
  if (!mutable) {
    return null;
  }
  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'mutable_default_arg',
    message: `Argumento '${mutable[1]}' com valor padrao mutavel`,
    suggestion: 'O valor padrao mutavel e compartilhado entre chamadas; use None como padrao e inicialize dentro da funcao.',
    snippet: '',
    action: { op: 'insert_before' },
  };
}

function checkPythonBareExcept(line, file, kind, lineNumber) {
  if (!isPythonLikeExtension(kind)) {
    return null;
  }

  const snippet = rewriteCodeSegments(line, kind, (code) =>
    code.replace(/^(\s*)except\s*:\s*(.*)$/, '$1except Exception:$2'));
  if (snippet === line) {
    return null;
  }

  return buildDeveloperErrorIssue({
    file,
    line: lineNumber,
    kind: 'bare_except',
    message: 'except generico captura interrupcoes e erros de sistema',
    suggestion: 'Capture Exception explicitamente para preservar KeyboardInterrupt/SystemExit.',
    snippet,
  });
}

function checkRubyNilComparison(line, file, kind, lineNumber) {
  if (!isRubyExtension(kind)) {
    return null;
  }

  const snippet = rewriteCodeSegments(line, kind, replaceRubyNilComparison);
  if (snippet === line) {
    return null;
  }

  return buildDeveloperErrorIssue({
    file,
    line: lineNumber,
    kind: 'nil_comparison',
    message: 'Comparacao com nil usando operador de igualdade',
    suggestion: 'Use nil? para expressar a verificacao idiomatica de ausencia em Ruby.',
    snippet,
  });
}

function checkElixirNilComparison(line, file, kind, lineNumber) {
  if (!isElixirExtension(kind)) {
    return null;
  }

  const snippet = rewriteCodeSegments(line, kind, replaceElixirNilComparison);
  if (snippet === line) {
    return null;
  }

  return buildDeveloperErrorIssue({
    file,
    line: lineNumber,
    kind: 'nil_comparison',
    message: 'Comparacao com nil usando operador de igualdade',
    suggestion: 'Use is_nil/1 para expressar ausencia em Elixir de forma idiomatica.',
    snippet,
  });
}

function buildDeveloperErrorIssue(issue) {
  return {
    severity: 'warning',
    action: { op: 'replace_line' },
    ...issue,
  };
}

function rewriteCodeSegments(line, kind, rewrite) {
  const source = String(line || '');
  const applyRewrite = typeof rewrite === 'function' ? rewrite : (value) => value;
  return splitCodeProtectedSegments(source, kind)
    .map((segment) => segment.kind === 'code' ? applyRewrite(segment.text) : segment.text)
    .join('');
}

function splitCodeProtectedSegments(line, kind) {
  const source = String(line || '');
  const segments = [];
  let currentCode = '';
  let cursor = 0;

  const pushCode = () => {
    if (currentCode) {
      segments.push({ kind: 'code', text: currentCode });
      currentCode = '';
    }
  };

  while (cursor < source.length) {
    if (startsInlineComment(source, cursor, kind)) {
      pushCode();
      segments.push({ kind: 'protected', text: source.slice(cursor) });
      return segments;
    }

    const current = source[cursor];
    if (current === '"' || current === '\'' || (isJavaScriptLikeExtension(kind) && current === '`')) {
      const quoted = readQuotedSegment(source, cursor, current);
      pushCode();
      segments.push({ kind: 'protected', text: quoted.text });
      cursor = quoted.nextIndex;
      continue;
    }

    currentCode += current;
    cursor += 1;
  }

  pushCode();
  return segments;
}

function startsInlineComment(line, cursor, kind) {
  const current = line[cursor];
  const next = line[cursor + 1] || '';
  const prev = cursor > 0 ? line[cursor - 1] : '';

  if (supportsSlashComments(kind)) {
    return current === '/' && next === '/';
  }
  if (supportsHashComments(kind) || kind === '.tf') {
    return current === '#';
  }
  if (kind === '.lua') {
    return current === '-' && next === '-';
  }
  if (kind === '.vim') {
    return current === '"' && (cursor === 0 || /\s/.test(prev));
  }
  if (kind === '.md') {
    return line.slice(cursor, cursor + 4) === '<!--';
  }
  return false;
}

function readQuotedSegment(source, startIndex, quote) {
  let cursor = startIndex + 1;
  while (cursor < source.length) {
    const current = source[cursor];
    if (current === '\\') {
      cursor += 2;
      continue;
    }
    cursor += 1;
    if (current === quote) {
      break;
    }
  }
  return {
    text: source.slice(startIndex, cursor),
    nextIndex: cursor,
  };
}

function replaceJavaScriptLooseEquality(code) {
  if (/\b(?:null|undefined)\s*(?:==|!=)|(?:==|!=)\s*(?:null|undefined)\b/.test(code)) {
    return code;
  }

  return String(code || '')
    .replace(/(^|[^=!])==(?!=)/g, '$1===')
    .replace(/(^|[^=!])!=(?!=)/g, '$1!==');
}

function replacePythonNoneComparison(code) {
  return String(code || '')
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.]*)\s*==\s*None\b/g, '$1 is None')
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.]*)\s*!=\s*None\b/g, '$1 is not None')
    .replace(/\bNone\s*==\s*([A-Za-z_][A-Za-z0-9_\.]*)\b/g, '$1 is None')
    .replace(/\bNone\s*!=\s*([A-Za-z_][A-Za-z0-9_\.]*)\b/g, '$1 is not None');
}

function replaceRubyNilComparison(code) {
  return String(code || '')
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.!?]*)\s*==\s*nil\b/g, '$1.nil?')
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.!?]*)\s*!=\s*nil\b/g, '!$1.nil?')
    .replace(/\bnil\s*==\s*([A-Za-z_][A-Za-z0-9_\.!?]*)\b/g, '$1.nil?')
    .replace(/\bnil\s*!=\s*([A-Za-z_][A-Za-z0-9_\.!?]*)\b/g, '!$1.nil?');
}

function replaceElixirNilComparison(code) {
  return String(code || '')
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.!?]*)\s*==\s*nil\b/g, 'is_nil($1)')
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.!?]*)\s*!=\s*nil\b/g, '!is_nil($1)')
    .replace(/\bnil\s*==\s*([A-Za-z_][A-Za-z0-9_\.!?]*)\b/g, 'is_nil($1)')
    .replace(/\bnil\s*!=\s*([A-Za-z_][A-Za-z0-9_\.!?]*)\b/g, '!is_nil($1)');
}

module.exports = {
  checkCommonDeveloperErrors,
  rewriteCodeSegments,
  maskProtectedSegments,
};
