// services/compliance-service/src/controllers/compliance.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { TransactionScreenDto } from '../dto/compliance.dto';
import { ComplianceService } from '../services/compliance.service';

@Controller()
export class ComplianceController {
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
