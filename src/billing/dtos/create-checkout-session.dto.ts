import { PlanTier, BillingInterval } from '@generated/enums';
import { IsEnum, IsUrl, IsOptional } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsEnum(PlanTier)
  planTier: PlanTier;

  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @IsUrl()
  successUrl: string;

  @IsUrl()
  cancelUrl: string;

  @IsOptional()
  couponCode?: string;
}