'use strict';

// Detecta segredos hardcoded no codigo — um dos erros mais caros e comuns em
// qualquer nivel. Duas frentes:
//   - padroes de provedor conhecidos (AWS, GitHub, Stripe, Google, Slack, chave
//     privada): altissima confianca, independente do nome da variavel;
//   - atribuicao a um nome claramente sensivel (password/secret/token/api_key)
//     com um literal de string que nao seja placeholder nem leitura de ambiente.
// Suggest-only: o Pingu sinaliza e orienta mover para variavel de ambiente ou
// cofre de segredos; nunca reescreve (a correcao depende de infraestrutura).

const PROVIDER_PATTERNS = [
  { label: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', regex: /\bgh[posru]_[A-Za-z0-9]{36,}\b/ },
  { label: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { label: 'Stripe secret key', regex: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
  { label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'chave privada', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
];

// Nome de variavel/chave que sugere um segredo.
const SECRET_NAME = /(?:passwd|password|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|token)/i;

// Atribuicao `nomeSensivel = "valor"` / `nomeSensivel: "valor"` (aspas simples,
// duplas ou crase).
const SECRET_ASSIGNMENT = new RegExp(
  `\\b([A-Za-z0-9_-]*(?:${SECRET_NAME.source})[A-Za-z0-9_-]*)\\s*[:=]\\s*(['"\`])([^'"\`]{6,})\\2`,
  'i',
);

// Valores que claramente nao sao um segredo real (placeholders, exemplos, refs).
const PLACEHOLDER_VALUE = /^(?:x+|\*+|\.+|change[_-]?me|placeholder|your[_-]?\w+|example|sample|dummy|test(?:ing)?|fake|todo|none|null|nil|undefined|secret|password|token|<[^>]*>|\$\{[^}]*\}|%[^%]+%|env\.\w+|process\.env|os\.environ)/i;

function checkHardcodedSecrets(lines, file, kind, opts = {}) {
  const focusRange = opts.focusRange || null;
  return (Array.isArray(lines) ? lines : []).flatMap((rawLine, index) => {
    const lineNumber = index + 1;
    if (!isLineInFocus(focusRange, lineNumber)) {
      return [];
    }
    const line = String(rawLine || '');
    const provider = matchProviderSecret(line);
    if (provider) {
      return [buildSecretIssue(file, lineNumber, `Possivel ${provider} exposto no codigo`)];
    }
    const assignment = matchAssignedSecret(line);
    if (assignment) {
      return [buildSecretIssue(file, lineNumber, `Segredo hardcoded na atribuicao de '${assignment}'`)];
    }
    return [];
  });
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

function matchProviderSecret(line) {
  for (const { label, regex } of PROVIDER_PATTERNS) {
    if (regex.test(line)) {
      return label;
    }
  }
  return '';
}

function matchAssignedSecret(line) {
  const match = String(line || '').match(SECRET_ASSIGNMENT);
  if (!match) {
    return '';
  }
  const value = String(match[3] || '').trim();
  if (!value || PLACEHOLDER_VALUE.test(value)) {
    return '';
  }
  // Baixa entropia: uma unica palavra minuscula (postgres, admin, root) ou so
  // digitos (porta/id) e quase sempre default de dev, nao um segredo real.
  if (/^[a-z]+$/.test(value) || /^\d+$/.test(value)) {
    return '';
  }
  return match[1];
}

function buildSecretIssue(file, lineNumber, message) {
  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'hardcoded_secret',
    message,
    suggestion: 'Mova o valor para uma variavel de ambiente ou cofre de segredos e referencie por configuracao; nunca versione segredos.',
    snippet: '',
    action: { op: 'insert_before' },
  };
}

module.exports = {
  checkHardcodedSecrets,
};
