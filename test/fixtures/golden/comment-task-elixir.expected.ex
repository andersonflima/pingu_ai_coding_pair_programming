defmodule Calculator do
  @doc """
    Executa a etapa principal de soma preservando o contrato esperado

    ## Argumentos
    - a: Valor numerico usado na regra principal da funcao.
    - b: Valor numerico usado na regra principal da funcao.

    ## Retorno
    Valor numerico calculado conforme a regra principal da funcao.
    """
  @spec soma(any(), any()) :: any()
  def soma(a, b) do
    a + b
  end
end
