// services/compliance-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsString } from 'class-validator';
import { createEvent, EventType, money } from '@nexus/shared';

class TransactionScreenDto {
  @IsString()
  userId!: string;

  @IsString()
  asset!: string;

  @IsString()
  amountUsd!: string;

  @IsString()
  counterparty!: string;
}

class ComplianceService {
  private watchlist = new Set(['blocked-address', 'sanctioned-entity']);

  screen(dto: TransactionScreenDto) {
    const highValue = money(dto.amountUsd).gte(10000);
    const sanctionsHit = this.watchlist.has(dto.counterparty);
    const suspicious = highValue || sanctionsHit;
    const payload = { ...dto, highValue, sanctionsHit, suspicious, travelRuleRequired: money(dto.amountUsd).gte(1000) };
    return {
      payload,
      event: suspicious ? createEvent(EventType.SuspiciousActivityDetected, dto.userId, payload, 'compliance-service', { userId: dto.userId }) : null
    };
  }

  regulatoryMatrix() {
    return [
      { region: 'Singapore', regulations: ['PSA', 'MAS Guidelines'], license: 'MPI License', phase: 1 },
      { region: 'European Union', regulations: ['MiCA', 'AMLD6', 'GDPR'], license: 'CASP License', phase: 2 },
      { region: 'United States', regulations: ['BSA', 'SEC', 'CFTC', 'FinCEN'], license: 'MTS + Broker-Dealer', phase: 3 }
    ];
  }
}

@Controller()
class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'compliance-service' };
  }

  @Post('compliance/screen')
  screen(@Body() dto: TransactionScreenDto) {
    return this.compliance.screen(dto);
  }

  @Get('compliance/regulatory-matrix')
  matrix() {
    return this.compliance.regulatoryMatrix();
  }
}

@Module({ controllers: [ComplianceController], providers: [ComplianceService] })
class ComplianceModule {}

async function bootstrap() {
  const app = await NestFactory.create(ComplianceModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3009);
}

void bootstrap();
