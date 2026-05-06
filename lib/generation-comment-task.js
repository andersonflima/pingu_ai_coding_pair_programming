'use strict';

const { normalizeActionCommentMarker } = require('./action-comment-context');

function createCommentTaskTools(deps) {
  const {
    analysisExtension,
    buildContextBlueprintTasks,
    buildSnippetDependencyIssues,
    commentTaskAlreadyApplied,
    inferTerminalTaskAction,
    isMermaidExtension,
    normalizeGeneratedTaskResult,
    mustUseAiForCommentAction,
    requiresAiForFeature,
    hasOpenAiConfiguration,
    supportsEditorFeature,
    supportsHashComments,
    supportsSlashComments,
    synthesizeFromCommentTask,
  } = deps;

  function hasExplicitAction(action) {
    return Boolean(action && typeof action === 'object' && String(action.op || '').trim());
  }

  function normalizeComparableLines(linesOrText) {
    if (Array.isArray(linesOrText)) {
      return linesOrText
        .map((line) => String(line || '').trim())
        .filter(Boolean);
    }
    return String(linesOrText || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  function overlapsWholeBuffer(snippet, lines) {
    const sourceLines = normalizeComparableLines(lines);
    const snippetLines = normalizeComparableLines(snippet);
    if (sourceLines.length < 6 || snippetLines.length < 6) {
      return false;
    }

    const sourceSet = new Set(sourceLines);
    const overlapCount = snippetLines.reduce((count, line) =>
      count + (sourceSet.has(line) ? 1 : 0), 0);
    const overlapRatio = overlapCount / sourceLines.length;
    const sizeRatio = snippetLines.length / sourceLines.length;
    const sourceHead = sourceLines[0];
    const sourceTail = sourceLines[sourceLines.length - 1];
    const startsWithSourceHead = sourceHead ? snippetLines[0] === sourceHead : false;
    const includesSourceTail = sourceTail ? snippetLines.includes(sourceTail) : false;

    return overlapRatio >= 0.55
      && sizeRatio >= 0.7
      && startsWithSourceHead
      && includesSourceTail;
  }

  function isContextualCorrectionInstruction(instruction) {
    return /\b(corrige|corrigir|corrigindo|ajusta|ajustar|substitui|substituir|altera|alterar|troca|trocar|remove|remover|troque|corrija|refatora|refatorar|refactor|atualiza|atualizar|atualize|update|melhora|melhorar|melhore|aprimora|aprimorar|aprimore|conclua|concluir|completa|completar|finaliza|finalizar)\b/i
      .test(String(instruction || ''));
  }

  function resolveGeneratedTaskAction(generatedTask, lines, file, instruction) {
    if (!generatedTask || typeof generatedTask !== 'object') {
      return undefined;
    }
    if (hasExplicitAction(generatedTask.action)) {
      return generatedTask.action;
    }

    const snippet = String(generatedTask.snippet || '');
    if (!snippet.trim()) {
      return undefined;
    }

    if (isContextualCorrectionInstruction(instruction) && overlapsWholeBuffer(snippet, lines)) {
      return {
        op: 'write_file',
        target_file: file,
        mkdir_p: true,
        remove_trigger: true,
      };
    }

    return undefined;
  }

  function normalizeCommentInstruction(raw) {
    return String(raw || '')
      .trim()
      .replace(/^\s*(?::::|::|\*\*|[:*])\s*/, '')
      .trim();
  }

  function isActionableCommentTask(instruction) {
    const normalized = String(instruction || '').trim();
    if (normalized.length < 4) {
      return false;
    }
    if (isMetaCommentDirective(normalized)) {
      return false;
    }
    return !isIncompleteCommentTask(normalized);
  }

  function isMetaCommentDirective(instruction) {
    const lower = String(instruction || '').toLowerCase().trim();
    if (!lower) {
      return false;
    }

    return /^pingu\s*-\s*correction\s*:/.test(lower)
      || /^(?:nao|não)\s+traduzir\b/.test(lower)
      || /\bcomentario\s+no\s+formato\b/.test(lower);
  }

  function isIncompleteCommentTask(instruction) {
    const lower = String(instruction || '').toLowerCase().trim();
    if (!lower) {
      return true;
    }

    if (/:$/.test(lower)) {
      return true;
    }

    if (/\b(que|de|do|da|para|com|sem|e|ou|a|o|um|uma|that|to|for|with|from|and|or)\s*$/.test(lower)) {
      return true;
    }

    if (/\badicionar\s+comentario\s+no\s+formato\b/.test(lower)) {
      return true;
    }

    if (/^(?:funcao|função|function|metodo|método|method)\s*$/.test(lower)) {
      return true;
    }

    if (/^(?:funcao|função|function|metodo|método|method)\s+(?:que|de|do|da|para|com|sem|that|to|for|with)\s*$/.test(lower)) {
      return true;
    }

    if (/^(?:crie|criar|cria|implemente|implementar|implementa|escreva|escrever|faça|faca|adicione|adicionar)\s+(?:uma?\s+)?(?:funcao|função|function|metodo|método|method)\s*$/.test(lower)) {
      return true;
    }

    return false;
  }

  function commentTaskMatchers(ext) {
    const lowerExt = analysisExtension(ext);
    if (supportsHashComments(lowerExt) || ['.tf'].includes(lowerExt)) {
      return [
        { regex: /^\s*#\s*(:::|::|\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (lowerExt === '.md') {
      return [
        { regex: /^\s*<!--\s*(:::|::|\*\*|[:*])\s*(.+?)\s*-->\s*$/ },
      ];
    }
    if (isMermaidExtension(lowerExt)) {
      return [
        { regex: /^\s*%%\s*(:::|::|\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (supportsSlashComments(lowerExt)) {
      return [
        { regex: /^\s*\/\/\s*(:::|::|\*\*|[:*])\s*(.+)$/ },
        { regex: /^\s*\/\*:::\s*(.+?)\s*\*\/\s*$/, marker: ':::' },
        { regex: /^\s*\/\*:::\s*(.+)$/, marker: ':::' },
        { regex: /^\s*\/\*::\s*(.+?)\s*\*\/\s*$/, marker: '::' },
        { regex: /^\s*\/\*::\s*(.+)$/, marker: '::' },
        { regex: /^\s*\/\*:\s*(.+?)\s*\*\/\s*$/, marker: ':' },
        { regex: /^\s*\/\*:\s*(.+)$/, marker: ':' },
        { regex: /^\s*\/\*\s+(:::|::|\*\*|[:*])\s*(.+?)\s*\*\/\s*$/ },
        { regex: /^\s*\/\*\s+(:::|::|\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (lowerExt === '.lua') {
      return [
        { regex: /^\s*--\s*(:::|::|\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (lowerExt === '.vim') {
      return [
        { regex: /^\s*"\s*(:::|::|\*\*|[:*])\s*(.+)$/ },
      ];
    }
    return [
      { regex: /^\s*(?:#|\/\/|--|")\s*(:::|::|\*\*|[:*])\s*(.+)$/ },
    ];
  }

  function matchCommentTask(line, ext) {
    const matchers = commentTaskMatchers(ext);
    return matchers.reduce((resolved, matcher) => {
      if (resolved) {
        return resolved;
      }

      const match = String(line || '').match(matcher.regex);
      if (!match) {
        return null;
      }

      if (matcher.marker) {
        const rawMarker = matcher.marker;
        return {
          rawMarker,
          marker: normalizeActionCommentMarker(rawMarker),
          instruction: String(match[1] || '').trim(),
        };
      }

      const rawMarker = String(match[1] || '').trim();
      return {
        rawMarker,
        marker: normalizeActionCommentMarker(rawMarker),
        instruction: String(match[2] || '').trim(),
      };
    }, null);
  }

  function buildTerminalTask(lines, file, lineNumber, instruction, ext, strictAiCommentAction, rawMarker = '*') {
    const requiresAiTerminalTask = Boolean(strictAiCommentAction || requiresAiForFeature(file, 'terminal_task'));
    if (requiresAiTerminalTask && !hasOpenAiConfiguration()) {
      return buildAiRequiredIssue(file, lineNumber, 'terminal_task');
    }

    const aiGeneratedTask = normalizeGeneratedTaskResult(
      synthesizeFromCommentTask(
        instruction,
        ext,
        lines,
        file,
        {
          lineIndex: Math.max(0, lineNumber - 1),
          forceTerminalAction: true,
          marker: '*',
          rawMarker,
        },
      ),
      ext,
    );
    if (aiGeneratedTask.aiFailure) {
      if (!requiresAiTerminalTask) {
        return null;
      }
      return buildAiRequiredIssue(
        file,
        lineNumber,
        'terminal_task',
        aiGeneratedTask.aiFailureMessage || 'IA obrigatoria nao retornou uma acao de terminal valida para o comment_task.',
      );
    }

    const aiAction = aiGeneratedTask && aiGeneratedTask.action && typeof aiGeneratedTask.action === 'object'
      ? aiGeneratedTask.action
      : {};
    const aiCommand = String(aiAction.command || '').trim();
    if (String(aiAction.op || '').trim() === 'run_command' && aiCommand) {
      return {
        file,
        line: lineNumber,
        severity: 'info',
        kind: 'terminal_task',
        message: 'Acao de terminal solicitada no comentario',
        suggestion: `Executar no terminal: ${String(aiAction.description || aiCommand)}`,
        action: {
          ...aiAction,
          op: 'run_command',
          command: aiCommand,
          description: String(aiAction.description || aiCommand),
          remove_trigger: true,
        },
      };
    }

    if (requiresAiTerminalTask) {
      return buildAiRequiredIssue(
        file,
        lineNumber,
        'terminal_task',
        'IA obrigatoria nao retornou action.run_command valida para o comment_task de terminal.',
      );
    }

    const action = inferTerminalTaskAction(file, instruction);
    if (!action || !action.command) {
      return null;
    }

    return {
      file,
      line: lineNumber,
      severity: 'info',
      kind: 'terminal_task',
      message: 'Acao de terminal solicitada no comentario',
      suggestion: `Executar no terminal: ${action.description}`,
      action: {
        ...action,
        op: 'run_command',
        remove_trigger: true,
      },
    };
  }

  function isLineInsideFocusRange(focusRange, lineNumber) {
    if (!focusRange || typeof focusRange !== 'object') {
      return true;
    }

    const start = Number.parseInt(String(focusRange.start || 0), 10);
    const end = Number.parseInt(String(focusRange.end || 0), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start) {
      return true;
    }

    return lineNumber >= start && lineNumber <= end;
  }

  function shouldScanWholeBufferForCommentTasks(opts = {}) {
    if (!opts || typeof opts !== 'object') {
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(opts, 'scanWholeBuffer')) {
      return true;
    }
    return opts.scanWholeBuffer !== false;
  }

  function checkCommentTask(lines, file, opts = {}) {
    const ext = analysisExtension(file);
    if (!supportsEditorFeature(file, 'comment_task')) {
      return [];
    }
    const issues = [];
    const focusRange = opts && typeof opts === 'object'
      ? opts.focusRange || null
      : null;
    const scanWholeBuffer = shouldScanWholeBufferForCommentTasks(opts);

    lines.forEach((line, idx) => {
      const lineNumber = idx + 1;
      if (!scanWholeBuffer && !isLineInsideFocusRange(focusRange, lineNumber)) {
        return;
      }

      const match = matchCommentTask(line, ext);
      if (!match) {
        return;
      }

      const marker = match.marker;
      const rawMarker = match.rawMarker || marker;
      const instruction = normalizeCommentInstruction(match.instruction);
      const strictAiCommentAction = typeof mustUseAiForCommentAction === 'function'
        ? mustUseAiForCommentAction(file, marker)
        : false;
      if (!isActionableCommentTask(instruction)) {
        return;
      }

      if (marker === '*') {
        if (!supportsEditorFeature(file, 'terminal_task')) {
          return;
        }
        const terminalTask = buildTerminalTask(lines, file, idx + 1, instruction, ext, strictAiCommentAction, rawMarker);
        if (terminalTask) {
          issues.push(terminalTask);
        }
        return;
      }
      if (marker === '**') {
        if (!supportsEditorFeature(file, 'context_file')) {
          return;
        }
        if ((strictAiCommentAction || requiresAiForFeature(file, 'context_file')) && !hasOpenAiConfiguration()) {
          issues.push(buildAiRequiredIssue(file, lineNumber, 'context_file'));
          return;
        }
        issues.push(...buildContextBlueprintTasks(lines, file, lineNumber, instruction));
        return;
      }
      if ((strictAiCommentAction || requiresAiForFeature(file, 'comment_task')) && !hasOpenAiConfiguration()) {
        issues.push(buildAiRequiredIssue(file, lineNumber, 'comment_task'));
        return;
      }

      const generatedTask = normalizeGeneratedTaskResult(
        synthesizeFromCommentTask(instruction, ext, lines, file, {
          lineIndex: idx,
          marker,
          rawMarker,
        }),
        ext,
      );
      if (generatedTask.aiFailure) {
        issues.push(buildAiRequiredIssue(
          file,
          lineNumber,
          'comment_task',
          generatedTask.aiFailureMessage || 'IA obrigatoria nao retornou implementacao valida para o comment_task.',
        ));
        return;
      }
      if (!generatedTask.snippet) {
        return;
      }
      if (!strictAiCommentAction && commentTaskAlreadyApplied(lines, idx, generatedTask, ext)) {
        return;
      }

      issues.push({
        file,
        line: lineNumber,
        severity: 'info',
        kind: 'comment_task',
        message: 'Tarefa solicitada no comentario',
        suggestion: `Implementacao sugerida para: ${instruction}`,
        snippet: generatedTask.snippet,
        action: resolveGeneratedTaskAction(generatedTask, lines, file, instruction),
        _trigger_line: String(line || ''),
        intent: generatedTask.semanticIntent || null,
        intentIR: generatedTask.intentIR || null,
        generationValidation: generatedTask.generationValidation || null,
      });

      issues.push(
        ...buildSnippetDependencyIssues(
          lines,
          file,
          lineNumber,
          generatedTask.snippet,
          instruction,
          ext,
          generatedTask.dependencies,
        ),
      );
    });

    return issues;
  }
  function buildAiRequiredIssue(file, line, feature, message = '') {
    return {
      file,
      line,
      severity: 'error',
      kind: 'ai_required',
      message: message || `IA obrigatoria para ${feature} em ${analysisExtension(file)}`,
      suggestion: 'Configure OPENAI_API_KEY para habilitar o fluxo de IA com OpenAI Codex.',
      snippet: '',
      action: { op: 'insert_before' },
    };
  }

  return {
    checkCommentTask,
  };
}

module.exports = {
  createCommentTaskTools,
};
