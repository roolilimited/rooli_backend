import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { PostFilterDto } from './dto/post-filter.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { parseISO, isBefore } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { HttpService } from '@nestjs/axios';
import { ApprovalsService } from '@/approvals/approvals.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { MediaService } from '@/media/media.service';
import { Prisma } from '@generated/client';
import { PostStatus, Platform } from '@generated/enums';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);
  private readonly MAX_RETRIES = 3;


  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly mediaService: MediaService,
    private readonly encryptionService: EncryptionService,
    private readonly http: HttpService,
  ) {}

  /**
   * Create a new post
   */
async createPost(organizationId: string, userId: string, dto: CreatePostDto) {
  return this.prisma.$transaction(async (tx) => {
    await this.validatePostCreation(organizationId, userId, dto);

    const mediaFileIds = dto.mediaFileIds ?? [];
 
    // 2. Determine if this is a profile post or page post
    const isProfilePost = !dto.pageAccountId;

    let finalScheduledAt: Date | null = null;

  if (dto.scheduledAt && dto.timezone) {
     finalScheduledAt = this.calculateUtcTime(dto.scheduledAt, dto.timezone);
     
     if (finalScheduledAt <= new Date()) {
        throw new BadRequestException('Scheduled time must be in the future');
     }
  }

    // 3. Build nested connect object for media relation (only when present)
    const mediaRelation =
      mediaFileIds.length > 0
        ? { connect: mediaFileIds.map((id) => ({ id })) }
        : undefined;

    // 4. Create post as DRAFT
    const post = await tx.post.create({
      data: {
        organizationId,
        authorId: userId,
        socialAccountId: dto.socialAccountId,
        pageAccountId: dto.pageAccountId ?? null,
        content: dto.content,
        ...(mediaRelation ? { mediaFileIds: mediaRelation } : {}),
        status: PostStatus.DRAFT,
        timezone: dto.timezone,
        scheduledAt: finalScheduledAt,
        platform: dto.platform,
        metadata: {
          ...(dto.metadata || {}),
          postType: isProfilePost ? 'PROFILE' : 'PAGE',
        } as Prisma.JsonValue,
      },
      include: this.getPostIncludes(),
    });

    this.logger.log(`💾 Post ${post.id} created as draft`);

    return post;
  });
}
  /**
   * Submit a draft post for approval workflow
   */
  async submitForApproval(
    postId: string,
    organizationId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Validate post
      const post = await tx.post.findFirst({
        where: {
          id: postId,
          organizationId,
          status: PostStatus.DRAFT,
        },
      });

      if (!post) {
        throw new NotFoundException(
          'Draft post not found or already submitted',
        );
      }

      // 2. Create approval request record
      await this.approvalsService.createApprovalRequest(postId, userId);

      // 3. Update post status to PENDING_APPROVAL
      const updatedPost = await tx.post.update({
        where: { id: postId },
        data: { status: PostStatus.PENDING_APPROVAL },
      });

      // 4. Optionally notify approvers
      // await this.notificationsService.notifyApprovers(organizationId, postId);

      this.logger.log(`📋 Draft post ${postId} submitted for approval`);

      return updatedPost;
    });
  }

  /**
   * Get organization posts with filters and pagination
   */
  async getOrganizationPosts(organizationId: string, filters: PostFilterDto) {
    const where = this.buildPostWhereClause(organizationId, filters);

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: this.getPostIncludes(),
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      posts,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * Delete a post (only drafts and failed posts)
   */
  async deletePost(postId: string, organizationId: string): Promise<void> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId },
      select: { status: true, jobId: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (
      !(
        [
          PostStatus.DRAFT,
          PostStatus.FAILED,
          PostStatus.CANCELED,
        ] as readonly PostStatus[]
      ).includes(post.status)
    ) {
      throw new BadRequestException(
        `Cannot delete post with status ${post.status}`,
      );
    }

    // Note: Job cancellation would now be handled by ApprovalsService
    // if it scheduled the post

    await this.prisma.post.delete({ where: { id: postId } });
    this.logger.log(`🗑️ Deleted post ${postId}`);
  }

  /** Get a single post by ID with details */
  async getPostById(postId: string, organizationId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId },
      include: this.getPostIncludes(),
    });

    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  /**
   * Update a post (only drafts or failed posts)
   */
async updatePost(postId: string, organizationId: string, dto: UpdatePostDto) {
  // fetch post and include media relation so TS knows about it
  const post = await this.prisma.post.findFirst({
    where: { id: postId, organizationId },
    include: {
      mediaFileIds: { select: { id: true } }, // include relation to access existing media ids
    },
  });

  if (!post) throw new NotFoundException('Post not found');

  const EDITABLE_STATUSES: PostStatus[] = [
    PostStatus.DRAFT,
    PostStatus.FAILED,
    PostStatus.PENDING_APPROVAL,
  ];

  if (!EDITABLE_STATUSES.includes(post.status)) {
    throw new BadRequestException(`Cannot update post with status ${post.status}`);
  }

  // scheduledAt validation
  if (dto.scheduledAt) {
    const scheduled = new Date(dto.scheduledAt);
    if (isNaN(scheduled.getTime())) {
      throw new BadRequestException('Invalid scheduledAt date');
    }
    if (scheduled <= new Date()) {
      throw new BadRequestException('Scheduled time must be in the future');
    }
  }

  // validate media files if provided
  if (dto.mediaFileIds?.length) {
    await this.validateMediaFiles(dto.mediaFileIds, organizationId);
  }

  // build update payload
  const updateData: Prisma.PostUpdateInput = {
    content: dto.content ?? undefined,
    scheduledAt: dto.scheduledAt ?? undefined,
    updatedAt: new Date(), 
  };

  if (dto.mediaFileIds) {
    updateData.mediaFileIds = {
      set: dto.mediaFileIds.map((id) => ({ id })),
    };
  }

  // perform update and return requested includes
  const updated = await this.prisma.post.update({
    where: { id: postId },
    data: updateData,
    include: this.getPostIncludes(),
  });

  this.logger.log(`📝 Post ${postId} updated successfully`);
  return updated;
}


  // ========== ORCHESTRATION METHODS ==========
 
  /**
   * Validate post creation inputs
   */
  private async validatePostCreation(
    organizationId: string,
    userId: string,
    dto: CreatePostDto,
  ): Promise<void> {
    console.log(
      `Validating post creation for org ${organizationId}, user ${userId}`,
    );
    // Verify social account
    const socialAccount = await this.prisma.socialAccount.findFirst({
      where: {
        id: dto.socialAccountId,
        organizationId,
        isActive: true,
      },
      include: {
        pages: true,
      },
    });

    if (!socialAccount) {
      throw new ForbiddenException('Social account not found or inactive');
    }

    const platformMismatch =
      socialAccount.platform === 'META'
        ? !['FACEBOOK', 'INSTAGRAM'].includes(dto.platform)
        : dto.platform !== socialAccount.platform;

    if (platformMismatch) {
      throw new BadRequestException(
        `Platform mismatch: expected ${socialAccount.platform}, got ${dto.platform}`,
      );
    }

    // NEW: Page account validation
    let pageAccount = null;

    if (dto.pageAccountId) {
      // This is a PAGE post - validate the page account
      pageAccount = socialAccount.pages.find(
        (page) => page.id === dto.pageAccountId,
      );

      if (!pageAccount) {
        throw new BadRequestException(
          'Page not found or not associated with this social account',
        );
      }

      // Additional validation for LinkedIn pages
      if (
        socialAccount.platform === 'LINKEDIN' &&
        socialAccount.accountType !== 'PAGE'
      ) {
        throw new BadRequestException(
          'Cannot post to LinkedIn pages using a profile account',
        );
      }
    } else {
      // This is a PROFILE post - validate account type
      if (
        socialAccount.platform === 'LINKEDIN' &&
        socialAccount.accountType !== 'PROFILE'
      ) {
        throw new BadRequestException(
          'Cannot create profile post using a pages account. Please select a specific page.',
        );
      }
    }


    // Validate media files
    if (dto.mediaFileIds?.length > 0) {
      await this.validateMediaFiles(dto.mediaFileIds, organizationId);
    }
  }

  private calculateUtcTime(localDateTimeString: string, timezone: string): Date {
  // This helper converts "9:00 AM in Lagos" to the equivalent Javascript Date object (which is always UTC internally)
  const utcDate = fromZonedTime(localDateTimeString, timezone);
  
  return utcDate;
}

  /**
   * Validate media files belong to organization
   */
private async validateMediaFiles(
    mediaFileIds: string[],
    organizationId: string,
  ): Promise<void> {
    const count = await this.prisma.mediaFile.count({
      where: {
        id: { in: mediaFileIds },
        organizationId: organizationId,
      },
    });

    if (count !== mediaFileIds.length) {
      throw new ForbiddenException(
        'One or more media files do not exist or belong to another organization',
      );
    }
  }


  /**
   * Build WHERE clause for post filtering
   */
  private buildPostWhereClause(
    organizationId: string,
    filters: PostFilterDto,
  ): Prisma.PostWhereInput {
    const where: Prisma.PostWhereInput = { organizationId };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.platform) {
      where.socialAccount = { platform: filters.platform };
    }

    if (filters.startDate || filters.endDate) {
      where.scheduledAt = {};
      if (filters.startDate) {
        where.scheduledAt.gte = filters.startDate.toISOString();
      }
      if (filters.endDate) {
        where.scheduledAt.lte = filters.endDate.toISOString();
      }
    }

    if (filters.authorId) {
      where.authorId = filters.authorId;
    }

    return where;
  }
  /**
   * Standard post includes for queries
   */
  private getPostIncludes() {
    return {
      socialAccount: {
        select: {
          id: true,
          platform: true,
          username: true,
          isActive: true,
        },
      },
      author: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
        },
      },
      approvals: {
        include: {
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    };
  }

}
