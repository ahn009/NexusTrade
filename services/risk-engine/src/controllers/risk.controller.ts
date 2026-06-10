// services/risk-engine/src/controllers/risk.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { PositionDto } from '../dto/risk.dto';
import { RiskService } from '../services/risk.service';

@Controller()
export class RiskController {
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
