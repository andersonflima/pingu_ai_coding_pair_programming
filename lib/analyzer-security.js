'use strict';

// Detectores de seguranca de alto valor e baixo falso-positivo, complementando o
// hardcoded_secret:
//   - command_injection: execucao de comando/codigo com entrada dinamica (eval,
//     exec/execSync com concatenacao, os.system, subprocess shell=True);
//   - unsafe_deserialization: desserializacao de dados nao confiaveis
//     (pickle.loads, yaml.load sem SafeLoader, marshal.loads).
// Suggest-only: o Pingu sinaliza e orienta a alternativa segura; a correcao
// depende do contexto (validacao/sanitizacao, API parametrizada, loader seguro).

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');
const { maskProtectedSegments } = require('./analyzer-developer-errors');

function checkSecurityIssues(lines, file, kind, opts = {}) {
  const focusRange = opts.focusRange || null;
  return (Array.isArray(lines) ? lines : []).flatMap((rawLine, index) => {
    const lineNumber = index + 1;
    if (!isLineInFocus(focusRange, lineNumber)) {
      return [];
    }
    const line = String(rawLine || '');
    return [
      checkCommandInjection(line, file, kind, lineNumber),
      checkUnsafeDeserialization(line, file, kind, lineNumber),
      checkSqlInjection(line, file, kind, lineNumber),
      checkWeakCrypto(line, file, kind, lineNumber),
    ].filter(Boolean);
  });
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

// Concatenacao/interpolacao no codigo da linha (fora de strings/comentarios).
function hasDynamicComposition(maskedLine) {
  return /\$\{|`|[^=!<>+\-*/%]\+\s|\+\s*[A-Za-z_$"'`]|\.format\s*\(|%\s*[A-Za-z(]/.test(maskedLine)
    || /\bf["']/.test(maskedLine);
}

function checkCommandInjection(line, file, kind, lineNumber) {
  const masked = maskProtectedSegments(line, kind);

  if (isJavaScriptLikeExtension(kind)) {
    // eval com argumento que nao e literal de string puro.
    if (/\beval\s*\(\s*[A-Za-z_$`]/.test(masked)) {
      return buildIssue(file, lineNumber, 'command_injection', 'eval() com entrada dinamica executa codigo arbitrario', 'Evite eval; use uma alternativa estruturada (JSON.parse, mapa de funcoes) ou valide rigorosamente a entrada.');
    }
    // exec/execSync de comando montado por concatenacao.
    if (/\b(?:exec|execSync)\s*\(/.test(masked) && hasDynamicComposition(masked)) {
      return buildIssue(file, lineNumber, 'command_injection', 'Comando shell montado com entrada dinamica (exec)', 'Use execFile/spawn com array de argumentos, sem shell, para evitar injecao de comando.');
    }
    return null;
  }

  if (isPythonLikeExtension(kind)) {
    if (/\b(?:eval|exec)\s*\(\s*[A-Za-z_]/.test(masked)) {
      return buildIssue(file, lineNumber, 'command_injection', 'eval()/exec() com entrada dinamica executa codigo arbitrario', 'Evite eval/exec; use ast.literal_eval para dados ou uma estrutura explicita.');
    }
    if (/\bos\.system\s*\(/.test(masked) && hasDynamicComposition(masked)) {
      return buildIssue(file, lineNumber, 'command_injection', 'Comando shell montado com entrada dinamica (os.system)', 'Use subprocess.run([...]) com lista de argumentos e sem shell=True.');
    }
    if (/\bsubprocess\.\w+\([^)]*shell\s*=\s*True/.test(masked)) {
      return buildIssue(file, lineNumber, 'command_injection', 'subprocess com shell=True e suscetivel a injecao', 'Passe os argumentos como lista e remova shell=True; use shlex.quote se o shell for indispensavel.');
    }
    return null;
  }

  return null;
}

function checkUnsafeDeserialization(line, file, kind, lineNumber) {
  if (!isPythonLikeExtension(kind)) {
    return null;
  }
  const masked = maskProtectedSegments(line, kind);

  if (/\b(?:pickle|cPickle|marshal)\.loads?\s*\(/.test(masked)) {
    return buildIssue(file, lineNumber, 'unsafe_deserialization', 'Desserializacao de dados nao confiaveis (pickle/marshal)', 'pickle/marshal executam codigo na carga; use um formato seguro (JSON) para dados externos.');
  }
  // yaml.load sem Loader seguro (yaml.safe_load nao casa este padrao).
  if (/\byaml\.load\s*\(/.test(masked) && !/Safe(?:Loader)?|safe/i.test(masked)) {
    return buildIssue(file, lineNumber, 'unsafe_deserialization', 'yaml.load sem loader seguro permite execucao de codigo', 'Use yaml.safe_load(...) ou yaml.load(..., Loader=yaml.SafeLoader).');
  }

  return null;
}

// Forma de query SQL inequivoca (multi-token, nao apenas uma palavra solta como
// "from"/"update" que aparecem em import/identificadores).
const SQL_QUERY_SHAPE = /\bSELECT\b[\s\S]*?\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b[\s\S]*?\bSET\b|\bDELETE\s+FROM\b/i;
// Composicao dinamica que injeta valor na string (sem contar placeholders
// parametrizados como %s, ?, :nome, $1, que sao a forma SEGURA).
const SQL_DYNAMIC = /["'`]\s*\+\s*[A-Za-z_$]|[A-Za-z_$][\w$]*\s*\+\s*["'`]|\$\{|\bf["'][^"']*\{/;

function checkSqlInjection(line, file, kind, lineNumber) {
  const source = String(line || '');
  if (!SQL_QUERY_SHAPE.test(source) || !SQL_DYNAMIC.test(source)) {
    return null;
  }
  return buildIssue(
    file,
    lineNumber,
    'sql_injection',
    'Query SQL montada com concatenacao de entrada dinamica',
    'Use consultas parametrizadas / prepared statements (placeholders) em vez de concatenar valores na string SQL.',
  );
}

// Hash fraco (MD5/SHA-1) em contexto de seguranca. Exige um termo de seguranca
// na linha para nao acusar usos legitimos (cache key, etag, checksum).
const SECURITY_CONTEXT = /\b(?:password|passwd|pwd|senha|secret|token|credential|auth|hash_?pass)\b/i;

function checkWeakCrypto(line, file, kind, lineNumber) {
  const source = String(line || '');
  const jsHash = isJavaScriptLikeExtension(kind) && /\bcreateHash\s*\(\s*['"](?:md5|sha1)['"]/i.test(source);
  const pyHash = isPythonLikeExtension(kind) && /\bhashlib\.(?:md5|sha1)\s*\(|\bhashlib\.new\s*\(\s*['"](?:md5|sha1)['"]/i.test(source);
  if ((!jsHash && !pyHash) || !SECURITY_CONTEXT.test(source)) {
    return null;
  }
  return buildIssue(
    file,
    lineNumber,
    'weak_crypto',
    'Hash fraco (MD5/SHA-1) para senha/segredo',
    'Para senhas use bcrypt/argon2/scrypt; para integridade use SHA-256 ou superior. MD5/SHA-1 sao quebraveis por colisao.',
  );
}

function buildIssue(file, lineNumber, kind, message, suggestion) {
  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind,
    message,
    suggestion,
    snippet: '',
    action: { op: 'insert_before' },
  };
}

module.exports = {
  checkSecurityIssues,
};
