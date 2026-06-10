// services/notification-service/src/dto/notification.dto.ts
import { IsEmail, IsIn, IsString } from 'class-validator';

export class NotificationDto {
  @IsIn(['email', 'sms', 'push', 'in_app'])
  channel!: 'email' | 'sms' | 'push' | 'in_app';

  @IsEmail()
  recipient!: string;

  @IsString()
  template!: string;

  @IsString()
  message!: string;
}
