// services/auth-service/src/dto/auth.dto.ts
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'password must include uppercase, lowercase, number, and special character'
  })
  password!: string;
}

export class LoginDto extends RegisterDto {
  @IsOptional()
  @IsString()
  totpCode?: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}

export class TotpVerifyDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  code!: string;
}

export class RefreshTokenDto {
  @IsString()
  sessionId!: string;

  @IsString()
  refreshToken!: string;
}

export class LogoutDto extends RefreshTokenDto {}
