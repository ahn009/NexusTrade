// services/user-service/src/dto/user.dto.ts
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { KycLevel } from '@nexus/shared';

export class ProfileDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  @Length(2, 2)
  country!: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class KycDto {
  @IsIn([1, 2, 3])
  level!: KycLevel;

  @IsString()
  provider!: string;
}

export class AddressBookDto {
  @IsString()
  asset!: string;

  @IsString()
  network!: string;

  @IsString()
  address!: string;

  @IsString()
  label!: string;
}
