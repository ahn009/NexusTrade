// services/deposit-service/src/dto/deposit.dto.ts
import { IsIn, IsString } from 'class-validator';

export class AddressRequestDto {
  @IsString()
  userId!: string;

  @IsIn(['BTC', 'ETH', 'USDT', 'SOL'])
  asset!: string;

  @IsIn(['bitcoin', 'ethereum', 'erc20', 'solana'])
  network!: string;
}

export class SimulateDepositDto extends AddressRequestDto {
  @IsString()
  txHash!: string;

  @IsString()
  amount!: string;
}
