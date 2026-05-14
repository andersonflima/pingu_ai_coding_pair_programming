terraform {
  required_version = ">= 1.6.0"
}

resource "null_resource" "pingu_smoke" {
  provisioner "local-exec" {
    command = "echo pingu terraform smoke test"
  }
}
