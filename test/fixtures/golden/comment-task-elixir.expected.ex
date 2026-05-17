defmodule Calculator do
  @doc """
    Executa a etapa principal de soma preservando o contrato esperado

    ## Parametros
    - `a`: Valor numerico usado na regra principal da funcao.
    - `b`: Valor numerico usado na regra principal da funcao.

    ## Retorno
    Valor numerico calculado conforme a regra principal da funcao.

    ## Contrato
    `@spec soma(term(), term()) :: term()`
    """
  @spec soma(term(), term()) :: term()
  def soma(a, b) do
    a + b
  end
end
