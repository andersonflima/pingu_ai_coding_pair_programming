defmodule Calculator do
  @doc """
    Orquestra o comportamento principal de soma

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
