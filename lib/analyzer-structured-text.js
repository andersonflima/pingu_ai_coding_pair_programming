'use strict';

// Checks de leaf para formatos de texto estruturado, extraidos do analyzer:
// titulo principal ausente em Markdown, fence de bloco Markdown sem fechamento,
// bloco/arquivo Terraform sem required_version e Dockerfile sem WORKDIR. Sao
// funcoes puras (apenas varrem as linhas e produzem issues), sem dependencia de
// outros checks.

function checkMarkdownTitle(lines, file) {
  const firstNonEmpty = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstNonEmpty < 0) {
    return [];
  }
  if (/^#\s+\S/.test(String(lines[firstNonEmpty] || '').trim())) {
    return [];
  }
  return [
    {
      file,
      line: firstNonEmpty + 1,
      severity: 'info',
      kind: 'markdown_title',
      message: 'Documento Markdown sem titulo principal',
      suggestion: 'Adicione um H1 para explicitar o objetivo do documento.',
      snippet: '# Titulo do documento',
    },
  ];
}

function checkMarkdownFenceIssues(lines, file, kind) {
  if (kind !== '.md') {
    return [];
  }

  let openFence = null;
  lines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    const match = trimmed.match(/^(```+|~~~+)(.*)$/);
    if (!match) {
      return;
    }
    if (!openFence) {
      openFence = { marker: match[1], line: index + 1 };
      return;
    }
    if (match[1][0] === openFence.marker[0] && match[1].length >= openFence.marker.length) {
      openFence = null;
    }
  });

  if (!openFence) {
    return [];
  }

  return [
    {
      file,
      line: lines.length > 0 ? lines.length : 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: 'Bloco Markdown sem fence de fechamento',
      suggestion: `Feche o bloco com ${openFence.marker} para restaurar a estrutura do documento.`,
      snippet: openFence.marker,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    },
  ];
}

function checkTerraformRequiredVersion(lines, file) {
  const terraformLine = lines.findIndex((line) => /^\s*terraform\s*{/.test(String(line || '')));
  const hasRequiredVersion = lines.some((line) => /required_version\s*=/.test(String(line || '')));
  const hasTerraformContent = lines.some((line) => /^\s*(resource|data|module|provider|variable|output|locals)\b/.test(String(line || '')));
  if (!hasTerraformContent || hasRequiredVersion) {
    return [];
  }
  if (terraformLine >= 0) {
    return [
      {
        file,
        line: terraformLine + 1,
        severity: 'info',
        kind: 'terraform_required_version',
        message: 'Bloco Terraform sem required_version',
        suggestion: 'Declare a versao minima do Terraform para reduzir drift entre ambientes.',
        snippet: '  required_version = ">= 1.5.0"',
        action: { op: 'insert_after', dedupeLookahead: 6 },
      },
    ];
  }
  return [
    {
      file,
      line: 1,
      severity: 'info',
      kind: 'terraform_required_version',
      message: 'Arquivo Terraform sem bloco de versao declarada',
      suggestion: 'Defina required_version para estabilizar o comportamento entre ambientes.',
      snippet: ['terraform {', '  required_version = ">= 1.5.0"', '}'].join('\n'),
    },
  ];
}

function checkDockerfileWorkdir(lines, file) {
  const fromLine = lines.findIndex((line) => /^\s*FROM\b/i.test(String(line || '')));
  const hasWorkdir = lines.some((line) => /^\s*WORKDIR\b/i.test(String(line || '')));
  if (fromLine < 0 || hasWorkdir) {
    return [];
  }
  return [
    {
      file,
      line: fromLine + 1,
      severity: 'info',
      kind: 'dockerfile_workdir',
      message: 'Dockerfile sem WORKDIR explicito',
      suggestion: 'Defina WORKDIR para estabilizar o contexto de copia e execucao.',
      snippet: 'WORKDIR /app',
      action: { op: 'insert_after', dedupeLookahead: 6 },
    },
  ];
}

module.exports = {
  checkMarkdownTitle,
  checkMarkdownFenceIssues,
  checkTerraformRequiredVersion,
  checkDockerfileWorkdir,
};
