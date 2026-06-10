// services/withdrawal-service/src/dto/withdrawal.dto.ts
import { IsString } from 'class-validator';

export class WithdrawalDto {
  @IsString()
  userId!: string;

  @IsString()
  asset!: string;

  @IsString()
  network!: string;

  @IsString()
  address!: string;

  @IsString()
  amount!: string;

  @IsString()
  totpCode!: string;
}
