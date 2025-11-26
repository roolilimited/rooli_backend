import { PlanTier, BillingInterval } from "@generated/enums";

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  credits: number;
  maxMembers: number;
  features: string[];
}

export interface CreateCheckoutSessionDto {
  planTier: PlanTier;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

export interface UpdateSubscriptionDto {
  planTier?: PlanTier;
  billingInterval?: BillingInterval;
}

export interface BillingPortalSessionDto {
  returnUrl: string;
}

export interface UsageSummary {
  metric: string;
  currentUsage: number;
  allowedUsage: number;
  percentage: number;
}

export interface BillingOverview {
  subscription: any;
  currentPeriodUsage: UsageSummary[];
  upcomingInvoice?: any;
  creditBalance: number;
}
