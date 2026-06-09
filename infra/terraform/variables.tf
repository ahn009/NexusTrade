# infra/terraform/variables.tf
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "database_password" {
  type      = string
  sensitive = true
}
