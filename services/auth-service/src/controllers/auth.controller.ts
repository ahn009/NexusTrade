// services/auth-service/src/controllers/auth.controller.ts
import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { Public } from '@nexus/shared';
import { LogoutDto, LoginDto, RefreshTokenDto, RegisterDto, TotpVerifyDto } from '../dto/auth.dto';
import { AuthService } from '../services/auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'auth-service' };
  }

  @Public()
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('auth/login')
  login(@Body() dto: LoginDto, @Headers('x-forwarded-for') ip?: string) {
    return this.auth.login(dto, ip);
  }

  @Public()
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto);
  }

  @Public()
  @Post('auth/logout')
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto);
  }

  @Post('auth/totp/setup')
  setupTotp(@Body('userId') userId: string) {
    return this.auth.setupTotp(userId);
  }

  @Post('auth/totp/verify')
  verifyTotp(@Body() dto: TotpVerifyDto) {
    return this.auth.verifyTotpForUser(dto);
  }

  @Public()
  @Post('auth/passkeys/options')
  passkeyOptions(@Body('userId') userId: string) {
    return this.auth.registerPasskey(userId);
  }
}
