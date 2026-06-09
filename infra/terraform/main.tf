# infra/terraform/main.tf
terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "nexustrade"
  cidr = "10.42.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.42.1.0/24", "10.42.2.0/24", "10.42.3.0/24"]
  public_subnets  = ["10.42.101.0/24", "10.42.102.0/24", "10.42.103.0/24"]

  enable_nat_gateway = true
}

resource "aws_s3_bucket" "audit" {
  bucket = "nexustrade-audit-${var.environment}"
}

resource "aws_db_instance" "postgres" {
  identifier             = "nexustrade-${var.environment}"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.r6g.large"
  allocated_storage      = 100
  db_name                = "nexus"
  username               = "nexus"
  password               = var.database_password
  skip_final_snapshot    = false
  backup_retention_period = 35
}
