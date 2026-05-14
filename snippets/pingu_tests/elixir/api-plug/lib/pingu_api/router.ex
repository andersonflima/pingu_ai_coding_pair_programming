defmodule PinguApi.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  @users [
    %{id: 1, name: "Ana", email: "ana@exemplo.com"},
    %{id: 2, name: "Bruno", email: "bruno@exemplo.com"}
  ]

  get "/health" do
    send_resp(conn, 200, Jason.encode!(%{status: "ok", service: "pingu-elixir-api"}))
  end

  get "/users" do
    send_resp(conn, 200, Jason.encode!(@users))
  end

  match _ do
    send_resp(conn, 404, Jason.encode!(%{error: "not_found"}))
  end
end
