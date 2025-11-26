import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PLANS, CREDIT_COST } from './billing.constants';
import { RecordUsageDto } from './dtos/usage-record.dto';
import { CreateCheckoutSessionDto, BillingPortalSessionDto, UpdateSubscriptionDto } from './types/billing.types';
import { PrismaService } from '@/prisma/prisma.service';
import { CreditType, PlanTier, BillingInterval } from '@generated/enums';


@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    //private readonly stripeService: StripeService,
  ) {}

  async createCheckoutSession(
    organizationId: string,
    dto: CreateCheckoutSessionDto,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Check if already has active subscription
    if (
      organization.subscription &&
      organization.subscription.status === 'ACTIVE'
    ) {
      throw new ConflictException(
        'Organization already has an active subscription',
      );
    }

    let customerId = organization.subscription?.stripeCustomerId;

    // Create Stripe customer if doesn't exist
  //   if (!customerId) {
  //     const customer = await this.stripeService.createCustomer(
  //       organizationId,
  //       organization.billingEmail || 'admin@organization.com',
  //       organization.name,
  //     );
  //     customerId = customer.id;

  //     // Update organization with customer ID
  //     await this.prisma.subscription.upsert({
  //       where: { organizationId },
  //       create: {
  //         organizationId,
  //         stripeCustomerId: customerId,
  //         planTier: dto.planTier,
  //         billingInterval: dto.billingInterval,
  //         status: 'INCOMPLETE',
  //         unitAmount: PLANS[dto.planTier].monthlyPrice * 100,
  //         maxMembers: PLANS[dto.planTier].maxMembers,
  //         currentPeriodStart: new Date(),
  //         currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  //       },
  //       update: {
  //         stripeCustomerId: customerId,
  //       },
  //     });
  //   }

  //   // Create checkout session
  //   const session = await this.stripeService.createCheckoutSession(
  //     customerId,
  //     dto.planTier,
  //     dto.billingInterval,
  //     dto.successUrl,
  //     dto.cancelUrl,
  //     dto.couponCode,
  //   );

  //   return { sessionId: session.id, url: session.url };
  }

  async createBillingPortalSession(
    organizationId: string,
    dto: BillingPortalSessionDto,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription || !subscription.stripeCustomerId) {
      throw new NotFoundException('No subscription found');
    }

    // const session = await this.stripeService.createBillingPortalSession(
    //   subscription.stripeCustomerId,
    //   dto.returnUrl,
    // );

    //return { url: session.url };
    return { url: 'https://example.com' }; // Placeholder
  }

  async getBillingOverview(organizationId: string) {
    const [subscription, creditBalance, usageRecords] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { organizationId },
        include: {
          invoices: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      }),
      this.getCreditBalance(organizationId),
      this.getCurrentPeriodUsage(organizationId),
    ]);

    if (!subscription) {
      throw new NotFoundException('No subscription found');
    }

    let upcomingInvoice = null;
    // if (subscription.stripeCustomerId) {
    //   try {
    //     upcomingInvoice = await this.stripeService.getUpcomingInvoice(
    //       subscription.stripeCustomerId,
    //     );
    //   } catch (error) {
    //     this.logger.warn('Failed to fetch upcoming invoice', error);
    //   }
    // }

    return {
      subscription,
      currentPeriodUsage: usageRecords,
      upcomingInvoice,
      creditBalance,
    };
  }

  async recordUsage(organizationId: string, dto: RecordUsageDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found');
    }

    // Record usage in database
    const usageRecord = await this.prisma.usageRecord.upsert({
      where: {
        subscriptionId_date_metric: {
          subscriptionId: subscription.id,
          date: dto.date || new Date(),
          metric: dto.metric,
        },
      },
      create: {
        subscriptionId: subscription.id,
        date: dto.date || new Date(),
        metric: dto.metric,
        quantity: dto.quantity,
      },
      update: {
        quantity: { increment: dto.quantity },
      },
    });

    // Record usage in Stripe if applicable
    if (
      subscription.stripeSubscriptionId &&
      this.shouldReportToStripe(dto.metric)
    ) {
      try {
        // This requires having subscription item IDs stored
        // For simplicity, we'll skip this in the example
        // await this.stripeService.createUsageRecord(subscriptionItemId, dto.quantity);
      } catch (error) {
        this.logger.error('Failed to record usage in Stripe', error);
      }
    }

    // Deduct credits
    await this.deductCredits(organizationId, dto.metric, dto.quantity);

    return usageRecord;
  }

  async updateSubscription(organizationId: string, dto: UpdateSubscriptionDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('No active subscription found');
    }

    const newPriceId = await this.getPriceId(dto.planTier, dto.billingInterval);

    // const updatedSubscription = await this.stripeService.updateSubscription(
    //   subscription.stripeSubscriptionId,
    //   newPriceId,
    // );

    // Update local database
    return this.prisma.subscription.update({
      where: { organizationId },
      data: {
        planTier: dto.planTier,
        billingInterval: dto.billingInterval,
        unitAmount: PLANS[dto.planTier].monthlyPrice * 100,
        maxMembers: PLANS[dto.planTier].maxMembers,
        updatedAt: new Date(),
      },
    });
  }

  async cancelSubscription(organizationId: string, cancelAtPeriodEnd = true) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('No active subscription found');
    }

    // const canceledSubscription = await this.stripeService.cancelSubscription(
    //   subscription.stripeSubscriptionId,
    //   cancelAtPeriodEnd,
    // );

    // return this.prisma.subscription.update({
    //   where: { organizationId },
    //   data: {
    //     status: cancelAtPeriodEnd ? 'ACTIVE' : 'CANCELED',
    //     cancelAt: cancelAtPeriodEnd
    //       ? new Date(canceledSubscription.current_period_end * 1000)
    //       : null,
    //     canceledAt: cancelAtPeriodEnd ? null : new Date(),
    //   },
    // });
    return this.prisma.subscription.update({
      where: { organizationId },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });
  }

  async handleWebhookEvent(event: any) {
    this.logger.log(`Processing webhook: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoiceFailed(event.data.object);
        break;
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSubscriptionCreated(subscription: any) {
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: subscription.status.toUpperCase(),
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        planTier: subscription.metadata.planTier,
        billingInterval: subscription.metadata.billingInterval.toUpperCase(),
      },
    });
  }

  private async handleSubscriptionUpdated(subscription: any) {
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: subscription.status.toUpperCase(),
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAt: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000)
          : null,
        canceledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000)
          : null,
      },
    });
  }

  private async handleSubscriptionDeleted(subscription: any) {
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });
  }

  private async handleInvoicePaid(invoice: any,) {
    await this.prisma.invoice.create({
      data: {
        subscription: {
          connect: { stripeSubscriptionId: invoice.subscription },
        },
        stripeInvoiceId: invoice.id,
        number: invoice.number,
        status: 'PAID',
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        tax: invoice.tax,
        invoiceDate: new Date(invoice.created * 1000),
        paidAt: new Date(),
        invoicePdfUrl: invoice.invoice_pdf,
        lineItems: invoice.lines.data.map((line) => ({
          description: line.description,
          amount: line.amount,
          quantity: line.quantity,
        })),
      },
    });

    // Add credits to organization
    if (invoice.amount_paid > 0) {
      await this.addCredits(
        invoice.customer,
        Math.floor(invoice.amount_paid / 100), // Convert cents to dollars
        'PURCHASE',
        invoice.id,
      );
    }
  }

  private async handleInvoiceFailed(invoice: any) {
    await this.prisma.invoice.create({
      data: {
        subscription: {
          connect: { stripeSubscriptionId: invoice.subscription },
        },
        stripeInvoiceId: invoice.id,
        number: invoice.number,
        status: 'UNCOLLECTIBLE',
        amountDue: invoice.amount_due,
        invoiceDate: new Date(invoice.created * 1000),
        lineItems: invoice.lines.data.map((line) => ({
          description: line.description,
          amount: line.amount,
          quantity: line.quantity,
        })),
      },
    });
  }

  private async getCreditBalance(organizationId: string): Promise<number> {
    const lastTransaction = await this.prisma.creditTransaction.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });

    return lastTransaction?.balanceAfter || 0;
  }

  private async addCredits(
    stripeCustomerId: string,
    amount: number,
    type: CreditType,
    referenceId?: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId },
    });

    if (!subscription) return;

    const lastTransaction = await this.prisma.creditTransaction.findFirst({
      where: { organizationId: subscription.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const balanceAfter = (lastTransaction?.balanceAfter || 0) + amount;

    await this.prisma.creditTransaction.create({
      data: {
        organizationId: subscription.organizationId,
        type,
        amount,
        description: `Credit ${type.toLowerCase()}`,
        referenceId,
        balanceAfter,
      },
    });
  }

  private async deductCredits(
    organizationId: string,
    metric: string,
    quantity: number,
  ) {
    const creditCost = CREDIT_COST[metric] || 1;
    const creditDeduction = quantity * creditCost;

    const lastTransaction = await this.prisma.creditTransaction.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const balanceAfter = (lastTransaction?.balanceAfter || 0) - creditDeduction;

    await this.prisma.creditTransaction.create({
      data: {
        organizationId,
        type: 'USAGE',
        amount: -creditDeduction,
        description: `Usage deduction for ${metric}`,
        balanceAfter,
      },
    });
  }

  private async getCurrentPeriodUsage(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) return [];

    const usageRecords = await this.prisma.usageRecord.groupBy({
      by: ['metric'],
      where: {
        subscriptionId: subscription.id,
        date: {
          gte: subscription.currentPeriodStart,
          lte: subscription.currentPeriodEnd,
        },
      },
      _sum: { quantity: true },
    });

    return usageRecords.map((record) => ({
      metric: record.metric,
      currentUsage: record._sum.quantity || 0,
      allowedUsage: this.getAllowedUsage(subscription.planTier, record.metric),
      percentage: Math.min(
        100,
        ((record._sum.quantity || 0) /
          this.getAllowedUsage(subscription.planTier, record.metric)) *
          100,
      ),
    }));
  }

  private getAllowedUsage(planTier: PlanTier, metric: string): number {
    const plan = PLANS[planTier];
    switch (metric) {
      case 'ai_tokens':
        return plan.credits;
      case 'image_generations':
        return Math.floor(plan.credits / CREDIT_COST.AI_IMAGE);
      case 'posts':
        return Math.floor(plan.credits / CREDIT_COST.POST);
      default:
        return plan.credits;
    }
  }

  private shouldReportToStripe(metric: string): boolean {
    // Only report usage-based metrics to Stripe
    return ['ai_tokens', 'image_generations'].includes(metric);
  }

  private async getPriceId(
    planTier: PlanTier,
    billingInterval: BillingInterval,
  ): Promise<string> {
    // This would be implemented based on your Stripe price setup
    // For now, return a placeholder
    return `price_${planTier.toLowerCase()}_${billingInterval.toLowerCase()}`;
  }
}
