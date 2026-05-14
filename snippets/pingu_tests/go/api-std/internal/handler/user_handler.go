package handler

import (
	"encoding/json"
	"net/http"
)

type User struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

var users = []User{
	{1, "Ana", "ana@exemplo.com"},
	{2, "Bruno", "bruno@exemplo.com"},
}

func Health(w http.ResponseWriter, _ *http.Request) {
	payload := map[string]string{"status": "ok", "service": "pingu-go-api"}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}

func ListUsers(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}
