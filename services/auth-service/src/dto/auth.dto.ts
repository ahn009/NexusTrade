// services/auth-service/src/dto/auth.dto.ts
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
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
  @IsString()
  userId!: string;

  @IsString()
  code!: string;
}
