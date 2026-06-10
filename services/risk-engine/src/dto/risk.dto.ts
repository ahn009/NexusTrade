// services/risk-engine/src/dto/risk.dto.ts
import { IsString } from 'class-validator';

export class PositionDto {
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
