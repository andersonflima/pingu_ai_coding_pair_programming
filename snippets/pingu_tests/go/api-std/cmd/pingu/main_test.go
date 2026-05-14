package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"pingu-go-sample/internal/handler"
)

func TestHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	handler.Health(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status inesperado: %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("json invalido: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status incorreto: %s", body["status"])
	}
}
