# Security Policy

## Superficie Sensivel

O Pingu roda no ambiente local do usuario e pode analisar arquivos, escrever no workspace e preparar comandos de terminal quando o fluxo estiver habilitado.

## Contrato de Terminal

- `terminal_task` fica desabilitado por padrao no editor.
- `safe` permite comandos de leitura e introspeccao.
- `workspace_write` permite comandos que podem escrever no workspace, como testes, builds e instalacao.
- `all` deve ser usado apenas em repositorios confiaveis.

## Credenciais

- Nunca registre `OPENAI_API_KEY` ou outros segredos em arquivos versionados.
- `doctor` mostra apenas presenca de credencial, sem imprimir o valor.
- O runtime residente deve ser reiniciado quando variaveis de ambiente sensiveis forem alteradas.

## Reporte

Abra uma issue com reproducao minima, impacto e superficie afetada. Para risco de execucao local, marque como `bug`, `breaking-risk` e `P0`.
