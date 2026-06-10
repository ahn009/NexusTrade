// services/trading-service/src/controllers/trading.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { PlaceOrderDto } from '../dto/trading.dto';
import { TradingService } from '../services/trading.service';

@Controller()
export class TradingController {
  constructor(private readonly trading: TradingService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'trading-service' };
  }

  @Post('orders')
  placeOrder(@Body() dto: PlaceOrderDto) {
    return this.trading.placeOrder(dto);
  }

  @Delete('orders/:orderId')
  cancelOrder(@Param('orderId') orderId: string, @Query('symbol') symbol: string, @Query('userId') userId: string) {
    return this.trading.cancelOrder(orderId, symbol, userId);
  }

  @Get('orders')
  listOrders(@Query('userId') userId?: string) {
    return this.trading.listOrders(userId);
  }

  @Get('trades')
  listTrades(@Query('userId') userId?: string) {
    return this.trading.listTrades(userId);
  }
}
