// services/wallet-service/src/controllers/wallet.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BalanceMutationDto, SettlementDto } from '../dto/wallet.dto';
import { WalletService } from '../services/wallet.service';

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'wallet-service' };
  }

  @Get('wallets/:userId/:asset')
  getBalance(@Param('userId') userId: string, @Param('asset') asset: string) {
    return this.wallet.getBalance(userId, asset);
  }

  @Get('wallets/:userId')
  listBalances(@Param('userId') userId: string) {
    return this.wallet.listBalances(userId);
  }

  @Post('wallets/credit')
  credit(@Body() dto: BalanceMutationDto) {
    return this.wallet.credit(dto);
  }

  @Post('wallets/lock')
  lock(@Body() dto: BalanceMutationDto) {
    return this.wallet.lock(dto);
  }

  @Post('wallets/unlock')
  unlock(@Body() dto: BalanceMutationDto) {
    return this.wallet.unlock(dto);
  }

  @Post('wallets/transfer/:toUserId')
  transfer(@Param('toUserId') toUserId: string, @Body() dto: BalanceMutationDto) {
    return this.wallet.internalTransfer(dto, toUserId);
  }

  @Post('wallets/settle-trade')
  settleTrade(@Body() dto: SettlementDto) {
    return this.wallet.settleTrade(dto);
  }
}
