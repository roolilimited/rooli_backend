import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CreateTemplateDto } from './dtos/create-template.dto';
import { GenerateFromTemplateDto } from './dtos/generate-from-template.dto';
import { UpdateTemplateDto } from './dtos/update-template.dto';
import { TemplateContent, TemplateVariable } from './interfaces/index.interface';
import { AiContentService } from '@/ai/services/ai-content.service';
import { BrandKitService } from '@/brand-kit/brand-kit.service';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@generated/client';
import { Platform, ContentType, TemplateCategory, TemplateStatus } from '@generated/enums';



@Injectable()
export class ContentTemplatesService {
  private readonly logger = new Logger(ContentTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiContentService,
    private readonly brandKitService: BrandKitService,
  ) {}

  async createTemplate(
    userId: string,
    dto: CreateTemplateDto,
  ) {
    // Validate template content structure
    this.validateTemplateContent(dto.content);

    // Verify brand kit belongs to organization if provided
    if (dto.brandKitId) {
      await this.verifyBrandKitAccess(dto.organizationId, dto.brandKitId);
    }

    return this.prisma.contentTemplate.create({
      data: {
        organizationId: dto.organizationId || null, // null for system templates
        userId,
        name: dto.name,
        description: dto.description,
        platform: dto.platform,
        contentType: dto.contentType,
        category: dto.category,
        tags: dto.tags || [],
        content: dto.content as unknown as Prisma.InputJsonValue,
        variables: this.extractVariableDefinitions(
          dto.content,
        ) as unknown as Prisma.InputJsonValue,
        isPublic: dto.isPublic || false,
        brandKitId: dto.brandKitId,
        status: 'DRAFT',
      }
    });
  }

  async getTemplateById(id: string, organizationId?: string) {
    const where: any = { id };

    if (organizationId) {
      where.OR = [
        { organizationId },
        { isPublic: true, organizationId: null }, // System templates
      ];
    }

    const template = await this.prisma.contentTemplate.findFirst({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        brandKit: { select: { id: true, name: true } },
        _count: {
          select: { favorites: true },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  async getOrganizationTemplates(
    organizationId: string,
    filters: {
      platform?: Platform;
      contentType?: ContentType;
      category?: TemplateCategory;
      status?: TemplateStatus;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const where: any = {
      organizationId,
      status: { not: 'DELETED' },
    };

    if (filters.platform) where.platform = filters.platform;
    if (filters.contentType) where.contentType = filters.contentType;
    if (filters.category) where.category = filters.category;
    if (filters.status) where.status = filters.status;

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { tags: { hasSome: [filters.search] } },
      ];
    }

    const [templates, total] = await Promise.all([
      this.prisma.contentTemplate.findMany({
        where,
        include: {
          brandKit: { select: { name: true } },
          _count: {
            select: { favorites: true },
          },
        },
        orderBy: [
          { favoriteCount: 'desc' },
          { usageCount: 'desc' },
          { updatedAt: 'desc' },
        ],
        skip: (filters.page - 1) * (filters.limit || 20),
        take: filters.limit || 20,
      }),
      this.prisma.contentTemplate.count({ where }),
    ]);

    return {
      templates,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: Math.ceil(total / (filters.limit || 20)),
      },
    };
  }

  async getSystemTemplates(filters: {
    platform?: Platform;
    category?: TemplateCategory;
    featured?: boolean;
  }) {
    const where: any = {
      organizationId: null,
      isPublic: true,
      status: 'ACTIVE',
    };

    if (filters.platform) where.platform = filters.platform;
    if (filters.category) where.category = filters.category;
    //if (filters.featured) where.favoriteCount = { gt: 10 }; // Popular templates

    return this.prisma.contentTemplate.findMany({
      where,
      include: {
        _count: {
          select: { favorites: true },
        },
      },
      orderBy: [{ favoriteCount: 'desc' }, { usageCount: 'desc' }],
      take: 50,
    });
  }

  async updateTemplate(
    id: string,
    organizationId: string,
    dto: UpdateTemplateDto,
  ) {
    const template = await this.getTemplateById(id, organizationId);

    // Validate content if provided
    if (dto.content) {
      this.validateTemplateContent(dto.content);
    }

    // Verify brand kit access if changing
    if (dto.brandKitId && dto.brandKitId !== template.brandKitId) {
      await this.verifyBrandKitAccess(organizationId, dto.brandKitId);
    }

    const updateData: any = { ...dto };

    // Update example if content changed
    if (dto.content) {
      updateData.example = this.generateExample(dto.content);
      updateData.variables = this.extractVariableDefinitions(dto.content);
      updateData.version = template.version + 1;
    }

    return this.prisma.contentTemplate.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });
  }

  async deleteTemplate(id: string, organizationId: string) {
   await this.getTemplateById(id, organizationId);

    return this.prisma.contentTemplate.delete({
      where: { id },
    });
  }

  async generateFromTemplate(
    templateId: string,
    dto: GenerateFromTemplateDto,
    organizationId: string,
    userId: string
  ) {
    const template = await this.getTemplateById(templateId, organizationId);

    if (template.status !== 'ACTIVE') {
      throw new BadRequestException('Template is not active');
    }

    // Safely cast JSON to your type
    const templateContent = template.content as unknown as TemplateContent;

    // Validate variables
    this.validateTemplateVariables(templateContent, dto.variables);

    // Fill template with variables
    let content = this.fillTemplate(
      templateContent,
      dto.variables,
      dto.options,
    );

    // Enhance with AI if requested
    if (dto.options?.enhanceWithAI && organizationId) {
      content = await this.enhanceContentWithAI(
        content,
        userId,
        template,
        organizationId,
        dto.options,
      );
    }

    // Update usage stats
    await this.incrementTemplateUsage(template.id);

    return {
      content,
      template: {
        id: template.id,
        name: template.name,
        platform: template.platform,
      },
      variables: dto.variables,
      metadata: {
        length: content.length,
        idealLength: templateContent.metadata.idealLength,
        variableCount: Object.keys(dto.variables).length,
      },
    };
  }

  async favoriteTemplate(templateId: string, userId: string) {
    const template = await this.getTemplateById(templateId);

    try {
      await this.prisma.userFavoriteTemplate.create({
        data: {
          userId,
          templateId,
        },
      });

      // Update favorite count
      await this.prisma.contentTemplate.update({
        where: { id: templateId },
        data: { favoriteCount: { increment: 1 } },
      });

      return { success: true, message: 'Template added to favorites' };
    } catch (error) {
      if (error.code === 'P2002') {
        // Unique constraint violation
        throw new ConflictException('Template already in favorites');
      }
      throw error;
    }
  }

  async unfavoriteTemplate(templateId: string, userId: string) {
    const result = await this.prisma.userFavoriteTemplate.deleteMany({
      where: { userId, templateId },
    });

    if (result.count > 0) {
      await this.prisma.contentTemplate.update({
        where: { id: templateId },
        data: { favoriteCount: { decrement: 1 } },
      });
    }

    return { success: true, message: 'Template removed from favorites' };
  }

  async getUserFavorites(userId: string, organizationId?: string) {
    const where: any = {
      favorites: { some: { userId } },
      status: 'ACTIVE',
    };

    if (organizationId) {
      where.OR = [{ organizationId }, { isPublic: true, organizationId: null }];
    }

    return this.prisma.contentTemplate.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true } },
        brandKit: { select: { name: true } },
        _count: {
          select: { favorites: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async duplicateTemplate(
    templateId: string,
    userId: string,
    organizationId: string,
    newName?: string,
  ) {
    const template = await this.getTemplateById(templateId, organizationId);

    return this.createTemplate(userId, {
      name: newName || `${template.name} (Copy)`,
      description: template.description,
      platform: template.platform,
      contentType: template.contentType,
      category: template.category,
      tags: template.tags,
      content: template.content as unknown as TemplateContent,
      isPublic: false, 
      brandKitId: template.brandKitId,
    });
  }


  private validateTemplateContent(content: TemplateContent) {
    if (!content.structure || !content.structure.caption) {
      throw new BadRequestException('Template must have a caption structure');
    }

    if (!content.metadata || !content.metadata.tone) {
      throw new BadRequestException('Template must have tone metadata');
    }

    // Validate variable definitions
    if (content.structure.variables) {
      for (const [key, variable] of Object.entries(
        content.structure.variables,
      )) {
        if (variable.required && variable.defaultValue === undefined) {
          throw new BadRequestException(
            `Required variable ${key} must have a default value`,
          );
        }
      }
    }
  }

  private validateTemplateVariables(
    templateContent: TemplateContent,
    variables: Record<string, any>,
  ) {
    const definedVariables = templateContent.structure.variables || {};

    for (const [key, variable] of Object.entries(definedVariables)) {
      const v = variable as TemplateVariable; // 👈 cast so TS knows shape

      if (v.required && !variables[key]) {
        throw new BadRequestException(`Required variable '${key}' is missing`);
      }

      if (variables[key] && v.validation) {
        this.validateVariableValue(key, variables[key], v);
      }
    }
  }

  private validateVariableValue(key: string, value: any, variable: any) {
    if (variable.validation) {
      if (
        variable.validation.minLength &&
        value.length < variable.validation.minLength
      ) {
        throw new BadRequestException(
          `Variable '${key}' must be at least ${variable.validation.minLength} characters`,
        );
      }

      if (
        variable.validation.maxLength &&
        value.length > variable.validation.maxLength
      ) {
        throw new BadRequestException(
          `Variable '${key}' must be at most ${variable.validation.maxLength} characters`,
        );
      }

      if (
        variable.validation.pattern &&
        !new RegExp(variable.validation.pattern).test(value)
      ) {
        throw new BadRequestException(
          `Variable '${key}' does not match required pattern`,
        );
      }

      if (
        variable.validation.options &&
        !variable.validation.options.includes(value)
      ) {
        throw new BadRequestException(
          `Variable '${key}' must be one of: ${variable.validation.options.join(', ')}`,
        );
      }
    }
  }

  private fillTemplate(
    content: TemplateContent,
    variables: Record<string, any>,
    options?: any,
  ): string {
    let result = content.structure.caption;

    // Replace variables in caption
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{${key}}`, 'g');
      result = result.replace(placeholder, value || '');
    }

    // Add hashtags if enabled and they exist
    if (options?.includeHashtags !== false && content.structure.hashtags) {
      const filledHashtags = content.structure.hashtags.map((tag) => {
        for (const [key, value] of Object.entries(variables)) {
          tag = tag.replace(new RegExp(`{${key}}`, 'g'), value || '');
        }
        return tag;
      });
      result += `\n\n${filledHashtags.join(' ')}`;
    }

    // Add CTA if enabled and it exists
    if (options?.includeCTA !== false && content.structure.cta) {
      let cta = content.structure.cta;
      for (const [key, value] of Object.entries(variables)) {
        cta = cta.replace(new RegExp(`{${key}}`, 'g'), value || '');
      }
      result += `\n\n${cta}`;
    }

    return result;
  }

  private async enhanceContentWithAI(
    content: string,
    userId: string,
    template: any,
    organizationId: string,
    options: any,
  ): Promise<string> {
    try {
      const brandKit =
        await this.brandKitService.getActiveBrandKit(organizationId);

      const enhanced = await this.aiService.enhanceContent(content, {
        platform: template.platform,
        tone: options.tone || template.content.metadata.tone,
        brandKit,
        style: 'template_enhancement',
         organizationId,
        userId,
      });

      return enhanced.content;
    } catch (error) {
      this.logger.warn(
        'AI enhancement failed, returning original content',
        error,
      );
      return content;
    }
  }

  private generateExample(content: TemplateContent): string {
    const exampleVariables: Record<string, any> = {};

    if (content.structure.variables) {
      for (const [key, variable] of Object.entries(
        content.structure.variables,
      )) {
        exampleVariables[key] =
          variable.defaultValue || this.getDefaultExampleValue(variable.type);
      }
    }

    return this.fillTemplate(content, exampleVariables, {
      includeHashtags: true,
      includeCTA: true,
    });
  }

  private getDefaultExampleValue(type: string): any {
    const examples = {
      string: 'Example Value',
      number: '42',
      boolean: 'true',
      date: '2024-01-01',
      url: 'https://example.com',
    };
    return examples[type] || 'Example';
  }

  private extractVariableDefinitions(content: TemplateContent): any {
    return content.structure.variables || {};
  }

  private async incrementTemplateUsage(templateId: string) {
    await this.prisma.contentTemplate.update({
      where: { id: templateId },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  private async verifyBrandKitAccess(
    organizationId: string,
    brandKitId: string,
  ) {
    const brandKit = await this.brandKitService.getById(brandKitId);
    if (!brandKit || brandKit.organizationId !== organizationId) {
      throw new BadRequestException('Brand kit not found or access denied');
    }
  }

  private calculatePopularityScore(template: any): number {
    // Simple popularity score based on usage and favorites
    const usageWeight = 1;
    const favoriteWeight = 2;
    const recencyWeight = 0.5;

    const daysSinceLastUse = template.lastUsedAt
      ? (new Date().getTime() - template.lastUsedAt.getTime()) /
        (1000 * 3600 * 24)
      : 30;

    const recencyScore = Math.max(0, 1 - daysSinceLastUse / 30); // Decay over 30 days

    return (
      template.usageCount * usageWeight +
      template.favoriteCount * favoriteWeight +
      recencyScore * recencyWeight
    );
  }
}
