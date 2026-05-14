variable "project_name" {
  type        = string
  description = "Nome do projeto de validação."
  default     = "pingu-tests"
}

variable "environment" {
  type        = string
  description = "Ambiente alvo para testes." 
  default     = "dev"
}
