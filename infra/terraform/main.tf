# infra/terraform/main.tf
terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
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

resource "aws_security_group" "app" {
  name        = "nexustrade-app-${var.environment}"
  description = "NexusTrade service security group"
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "nexustrade-${var.environment}"
  cluster_version = "1.30"
  subnet_ids      = module.vpc.private_subnets
  vpc_id          = module.vpc.vpc_id

  eks_managed_node_groups = {
    general = {
      min_size       = 3
      max_size       = 20
      desired_size   = 3
      instance_types = ["m7i.large"]
    }
  }
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
  multi_az               = true
  storage_encrypted      = true
  skip_final_snapshot    = false
  backup_retention_period = 35
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "nexustrade-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "nexustrade-${var.environment}"
  description                = "NexusTrade Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.r7g.large"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.app.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}

resource "aws_msk_cluster" "kafka" {
  cluster_name           = "nexustrade-${var.environment}"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = "kafka.m7g.large"
    client_subnets  = module.vpc.private_subnets
    security_groups = [aws_security_group.app.id]
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }
}

resource "aws_cloudwatch_log_group" "services" {
  name              = "/aws/eks/nexustrade-${var.environment}/services"
  retention_in_days = 30
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "nexustrade-${var.environment}-api-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
}
