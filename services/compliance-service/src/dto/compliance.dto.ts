// services/compliance-service/src/dto/compliance.dto.ts
import { IsString } from 'class-validator';

export class TransactionScreenDto {
  @IsString()
  userId!: string;

  @IsString()
  asset!: string;

  @IsString()
  amountUsd!: string;

  @IsString()
  counterparty!: string;
}
