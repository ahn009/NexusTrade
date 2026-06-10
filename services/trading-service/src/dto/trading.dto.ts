// services/trading-service/src/dto/trading.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderSide, OrderType } from '@nexus/shared';

export class PlaceOrderDto {
  @IsString()
  userId!: string;

  @IsString()
  accountId!: string;

  @IsString()
  symbol!: string;

  @IsEnum(OrderSide)
  side!: OrderSide;

  @IsEnum(OrderType)
  type!: OrderType;

  @IsOptional()
  @IsString()
  price?: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  clientOrderId?: string;
}
