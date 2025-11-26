import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateBrandKitDto } from './dtos/create-brand-kit.dto';
import { UpdateBrandKitDto } from './dtos/update-brand-kit.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { BrandKit } from '@generated/client';

@Injectable()
export class BrandKitService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  /** Create a new brand kit and set it as active */
  async create(organizationId: string, data: CreateBrandKitDto) {
    // Deactivate existing active brand kits
    await this.prisma.brandKit.updateMany({
      where: { organizationId, isActive: true },
      data: { isActive: false },
    });

    const brandKit = await this.prisma.brandKit.create({
      data: {
        organizationId,
        name: data.name || 'Our Brand',
        logoUrl: data.logoUrl,
        colors: data.colors,
        brandVoice: data.brandVoice,
        tone: data.tone,
        guidelines: data.guidelines,
        isActive: true,
        isDefault: data.isDefault || false,
      },
    });

    // Cache the active brand kit in Redis for 5 minutes
    await this.redisService.set(
      this.getCacheKey(organizationId),
      JSON.stringify(brandKit),
      300,
    );

    return brandKit;
  }

  /** Get all brand kits for an organization */
  async findByOrganization(organizationId: string, includeInactive = false) {
    const where: any = { organizationId };
    if (!includeInactive) where.isActive = true;

    return this.prisma.brandKit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get the currently active brand kit (with Redis caching) */
  async getActiveBrandKit(organizationId: string): Promise<BrandKit | null> {
    const cacheKey = this.getCacheKey(organizationId);

    // Check Redis first
    const cached = await this.redisService.get(cacheKey);
    if (cached) return JSON.parse(cached) as BrandKit;

    // Fallback: fetch from DB
    const brandKit = await this.prisma.brandKit.findFirst({
      where: { organizationId, isActive: true },
    });

    if (brandKit) {
      await this.redisService.set(cacheKey, JSON.stringify(brandKit), 300);
    }

    return brandKit;
  }

  /** Update a brand kit */
  async update(id: string, organizationId: string, data: UpdateBrandKitDto) {
    const updated = await this.prisma.brandKit.update({
      where: { id, organizationId },
      data: { ...data, updatedAt: new Date() },
    });

    // If updated brand kit is active, refresh Redis cache
    if (updated.isActive) {
      await this.redisService.set(
        this.getCacheKey(organizationId),
        JSON.stringify(updated),
        300,
      );
    }

    return updated;
  }

  /** Get brand kit by ID */
  async getById(id: string): Promise<BrandKit | null> {
    const brandKit = await this.prisma.brandKit.findUnique({
      where: { id },
    });

    if (!brandKit) {
      throw new NotFoundException('Brand kit not found');
    }

    return brandKit;
  }

/** Deactivate a brand kit */
async deactivate(id: string, organizationId: string) {
 const brandKit = await this.getById(id); // Ensure it exists

  if (!brandKit.isActive) {
    throw new BadRequestException('Brand kit is already inactive');
  }

  // Optional: Check if this is the last active brand kit
  const activeBrandKitsCount = await this.prisma.brandKit.count({
    where: { organizationId, isActive: true },
  });

  if (activeBrandKitsCount === 1) {
    throw new BadRequestException(
      'Cannot deactivate the only active brand kit. Please activate another brand kit first.'
    );
  }

  const updated = await this.prisma.brandKit.update({
    where: { id, organizationId },
    data: { isActive: false },
  });

  // Remove from Redis cache
  await this.redisService.del(this.getCacheKey(organizationId));

  return updated;
}
  /** Activate a brand kit */
  async activate(id: string, organizationId: string) {
    // Use a transaction to ensure atomicity
    const updated = await this.prisma.$transaction(async (tx) => {
      // First, deactivate all active brand kits for this organization
      await tx.brandKit.updateMany({
        where: {
          organizationId,
          isActive: true,
          id: { not: id }, // Exclude the one we're about to activate
        },
        data: { isActive: false },
      });

      // Then activate the requested brand kit
      return await tx.brandKit.update({
        where: { id, organizationId },
        data: { isActive: true },
      });
    });

    // Remove from Redis cache to force refresh
    await this.redisService.del(this.getCacheKey(organizationId));

    return updated;
  }

  /** Delete a brand kit */
  async delete(id: string, organizationId: string) {
    // Check if this is the active brand kit
    const brandKit = await this.getById(id); // Ensure it exists

    // Prevent deletion of the active brand kit
    if (brandKit.isActive) {
      throw new BadRequestException(
        'Cannot delete an active brand kit. Please activate another brand kit first.',
      );
    }

    // Delete the brand kit
    await this.prisma.brandKit.delete({
      where: { id, organizationId },
    });

    // Remove from Redis cache
    await this.redisService.del(this.getCacheKey(organizationId));

    return { message: 'Brand kit deleted successfully' };
  }

  private getCacheKey(organizationId: string) {
    return `brandkit:${organizationId}`;
  }
}
