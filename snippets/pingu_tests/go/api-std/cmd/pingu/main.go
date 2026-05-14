package main

import (
	"log"
	"net/http"
	"os"

	"pingu-go-sample/internal/handler"
)

func main() {
	http.HandleFunc("/health", handler.Health)
	http.HandleFunc("/users", handler.ListUsers)

	http.HandleFunc("/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
		content, err := os.ReadFile("api/openapi.yaml")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("{\"error\": \"unable to read spec\"}"))
			return
		}

		w.Header().Set("Content-Type", "application/x-yaml")
		_, _ = w.Write(content)
	})

	log.Println("listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}
