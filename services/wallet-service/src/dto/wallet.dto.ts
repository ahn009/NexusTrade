// services/wallet-service/src/dto/wallet.dto.ts
import { IsOptional, IsString } from 'class-validator';

export class BalanceMutationDto {
  @IsString()
  userId!: string;

  @IsString()
  asset!: string;

  @IsString()
  amount!: string;

  @IsString()
  referenceId!: string;
}

export class SettlementDto {
  @IsString()
  makerUserId!: string;

  @IsString()
  takerUserId!: string;

  @IsString()
  makerSide!: 'BUY' | 'SELL';

  @IsString()
  baseAsset!: string;

  @IsString()
  quoteAsset!: string;

  @IsString()
  price!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  makerFee?: string;

  @IsOptional()
  @IsString()
  takerFee?: string;

  @IsOptional()
  @IsString()
  feeAsset?: string;

  @IsString()
  referenceId!: string;
}

export interface BalanceLeg {
  userId: string;
  asset: string;
  amount: string;
  bucket: 'available' | 'locked';
}
