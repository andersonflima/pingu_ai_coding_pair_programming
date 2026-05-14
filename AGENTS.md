# AGENTS.md

## Propósito

Este repositório utiliza este arquivo como referência de engenharia para alterações de código.
O runtime atual do Pingu é orientado por automação de análise estática, validações e templates; não depende de um modelo de IA no fluxo local de execução.

## Princípios de engenharia

- Priorize código funcional: funções pequenas, imutabilidade quando fizer sentido, composição e transformação explícita de dados.
- Preserve arquitetura de camadas: domínio → casos de uso → contratos → adaptadores → infraestrutura → interface externa → testes.
- Domínio não depende de frameworks e bibliotecas externas.
- Separe responsabilidade por arquivo e mantenha baixa complexidade ciclomática.
- Prefira composição a herança e evite acoplamento desnecessário.
- Tipagem e validações explícitas sempre que possível.
- Evite comentários óbvios; use comentários apenas para decisões técnicas relevantes.

## Alterações automáticas e docs

- Sempre trate `function_doc`, `function_spec` e `unit_test_signature` como contratos automáticos de manutenção quando há mudança de assinatura.
- Sempre que possível, mantenha documentação e testes alinhados à assinatura pública atual.
- Quando uma ação automática não tiver confiança mínima, não aplique automaticamente e deixe para revisão explícita.

## Padrões de fluxo

- Use `npm run check` antes de mudanças significativas.
- Faça mudanças pequenas e reversíveis.
- Não execute alterações destrutivas fora do escopo solicitado.
- Evite ler/gravar código sem necessidade.

## Contratos de publicação (release)

- `scripts/check-release-version.js` é a fonte de decisão de versão de release.
- `release:check`/`release:prepare` devem permanecer alinhados com o comportamento de bump e documentação de decisão.
- Em ajustes de versão e changelog, mantenha rastreabilidade do motivo da decisão.

## Boas práticas de Git

- Commits no padrão Conventional Commits.
- Evite alterar arquivos não relacionados ao objetivo da mudança.
- Ao concluir uma alteração, descreva:
  1. comportamento anterior,
  2. problema identificado,
  3. mudança realizada,
  4. comportamento depois,
  5. motivo técnico,
  6. impacto esperado,
  7. riscos e pontos de atenção.

## Testes

- Cubra regra de negócio e comportamento importante.
- Priorize cenários de sucesso, falha e borda.
- Não introduza regressão por mudanças de contrato (assinatura pública, docs, testes).

