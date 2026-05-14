defmodule PinguApi.MixProject do
  use Mix.Project

  def project do
    [
      app: :pingu_api,
      version: "0.1.0",
      elixir: "~> 1.16",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {PinguApi.Application, []}
    ]
  end

  defp deps do
    [
      {:plug_cowboy, "~> 2.7"},
      {:plug, "~> 1.16"},
      {:jason, "~> 1.4"}
    ]
  end
end
