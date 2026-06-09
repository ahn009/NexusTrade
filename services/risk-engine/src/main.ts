// services/risk-engine/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsString } from 'class-validator';
import { createEvent, EventType, money } from '@nexus/shared';

class PositionDto {
  @IsString()
  userId!: string;

  @IsString()
  symbol!: string;

  @IsString()
  notional!: string;

  @IsString()
  equity!: string;

  @IsString()
  maintenanceMargin!: string;
}

class RiskService {
  evaluate(position: PositionDto) {
    const equity = money(position.equity);
    const maintenance = money(position.maintenanceMargin);
    const marginRatio = equity.div(position.notional).toFixed();
    const liquidatable = equity.minus(maintenance).lt(0);
    const payload = { ...position, marginRatio, liquidatable, insuranceFundAsset: 'USDT' };
    return {
      payload,
      event: liquidatable ? createEvent(EventType.LiquidationTriggered, `${position.userId}:${position.symbol}`, payload, 'risk-engine', { userId: position.userId }) : null
    };
  }

  insuranceFund() {
    return { asset: 'USDT', balance: '25000000', stressScenarioCoverage: '30pct-1min' };
  }
}

@Controller()
class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'risk-engine' };
  }

  @Post('risk/evaluate')
  evaluate(@Body() dto: PositionDto) {
    return this.risk.evaluate(dto);
  }

  @Get('risk/insurance-fund')
  insuranceFund() {
    return this.risk.insuranceFund();
  }
}

@Module({ controllers: [RiskController], providers: [RiskService] })
class RiskModule {}

async function bootstrap() {
  const app = await NestFactory.create(RiskModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3006);
}

void bootstrap();
