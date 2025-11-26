// src/ai/services/ai-usage.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { TrackUsageParams } from '../interfaces/index.interface';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Track an AI usage event
   */
  async trackUsage(params: TrackUsageParams) {
    try {
      await this.prisma.aIUsage.create({
        data: {
          organizationId: params.organizationId,
          userId: params.userId,
          type: params.type,
          tokensUsed: params.tokensUsed,
          cost: params.cost,
          metadata: params.metadata,
        },
      });

      // Optional: Update organization's monthly usage (can later use Redis caching)
      await this.updateMonthlyUsage(params.organizationId, params.cost);
    } catch (error) {
      this.logger.error('Failed to track AI usage:', error);
      // Do not throw - usage tracking should not break main functionality
    }
  }

  /**
   * Get the total AI usage for the current month for an organization
   */
  async getMonthlyUsage(
    organizationId: string,
  ): Promise<{ cost: number; tokens: number }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usage = await this.prisma.aIUsage.groupBy({
      by: ['organizationId'],
      where: {
        organizationId,
        createdAt: { gte: startOfMonth },
      },
      _sum: {
        cost: true,
        tokensUsed: true,
      },
    });

    return {
      cost: usage[0]?._sum.cost || 0,
      tokens: usage[0]?._sum.tokensUsed || 0,
    };
  }

  /**
   * Update monthly usage (currently just logs, can integrate Redis cache later)
   */
  private async updateMonthlyUsage(organizationId: string, cost: number) {
    this.logger.debug(
      `Organization ${organizationId} AI cost increased by $${cost}`,
    );
    // Future: update Redis or other cache for quick monthly usage read
  }
}
