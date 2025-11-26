import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GenerateContentDto } from '../dtos/generate-content.dto';
import { OpenAiProvider } from '../providers/openai.service';
import { AiUsageService } from './ai-usage.service';
import { HuggingFaceService } from '../providers/huggingface.provider';
import { BrandKitService } from '@/brand-kit/brand-kit.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RateLimitService } from '@/rate-limit/rate-limit.service';
import { Platform, ToneType } from '@generated/enums';


@Injectable()
export class AiContentService {
  private readonly logger = new Logger(AiContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandKitService: BrandKitService,
    //private readonly openAiProvider: OpenAiProvider,
    private readonly aiUsageService: AiUsageService,
    private readonly rateLimitService: RateLimitService,
    private readonly huggingFaceClient: HuggingFaceService,
  ) {}

  async generateContent(
    organizationId: string,
    userId: string,
    generateDto: GenerateContentDto,
  ) {
    const start = Date.now();

    try {
      // 1. Rate limit
      // await this.rateLimitService.checkLimit(
      //   'AI',
      //   organizationId,
      //   'content_generation',
      // );

      // 2. BrandKit
      const brandKit =
        (await this.brandKitService.getActiveBrandKit(organizationId)) ||
        this.getDefaultBrandKit();

      // 3. Prompt
      const prompt = this.buildEnhancedPrompt(generateDto, brandKit);

      // 4. Call AI (Hugging Face)
      const result = await this.huggingFaceClient.generateText(prompt);

      // 5. Clean & parse response
      const { content, hashtags, engagement_hook } = this.cleanAndParseResponse(
        result.choices[0]?.message?.content || '',
      );

      // 6. Costs & credits
      const tokens = result.usage?.total_tokens ?? 0;
      const { cost, credits } = this.calculateUsage(tokens);

      // 7. Save record
      const generation = await this.prisma.aiContentGeneration.create({
        data: {
          organizationId,
          userId,
          platform: generateDto.platform,
          contentType: generateDto.contentType,
          topic: generateDto.topic,
          tone: generateDto.tone,
          creditsUsed: credits,
          prompt,
          generatedText: content,
          hashtags,
          cost,
          provider: 'huggingface',
          model: result.model,
          brandKitId: brandKit.id !== 'default' ? brandKit.id : null,
        },
      });

      // 8. Track usage
      await this.aiUsageService.trackUsage({
        organizationId,
        userId,
        type: 'content_generation',
        tokensUsed: tokens,
        cost,
        metadata: {
          platform: generateDto.platform,
          contentType: generateDto.contentType,
          generationId: generation.id,
        },
      });

      this.logger.log(
        `✅ Generated content for org=${organizationId}, user=${userId} in ${
          Date.now() - start
        }ms`,
      );

      // 9. Return cleaned, presentable result
      return {
        id: generation.id,
        content,
        hashtags,
        engagement_hook,
        provider: result.model,
        creditsUsed: credits,
        cost,
      };
    } catch (err) {
      this.logger.error(
        `❌ Content generation failed for org=${organizationId}, user=${userId}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        `Content generation failed: ${err.message}`,
      );
    }
  }

  async enhanceContent(
    contentId: string,
    options: {
      platform: Platform;
      tone: ToneType;
      brandKit: any;
      style?: string;
      organizationId: string;
      userId: string;
    },
    trackUsage = true,
  ) {
    const start = Date.now();

    try {
      // 1️⃣ Fetch the existing content
      const existing = await this.prisma.aiContentGeneration.findUnique({
        where: { id: contentId },
      });

      if (!existing) {
        throw new NotFoundException(
          `Generated content not found: ${contentId}`,
        );
      }

      const prompt = `
        Enhance the following content for ${options.platform}.
        
        TONE: ${options.tone}
        STYLE: ${options.style || 'general_enhancement'}
        
        BRAND GUIDELINES:
        ${this.buildBrandContext(options.brandKit)}

        CONTENT TO ENHANCE:
        """${existing.generatedText}"""

        Return response in JSON format:
        { "content": "...", "hashtags": ["#tag1", "#tag2"] }
      `;

      //const result = await this.openAiProvider.generateText(prompt);
      const result = await this.huggingFaceClient.generateText(prompt);
      // const { content: enhancedContent, hashtags } =
      //this.parseAiResponse(result);
      const {
        content: enhancedContent,
        hashtags,
        engagement_hook,
      } = this.cleanAndParseResponse(result.choices[0]?.message?.content || '');

      const tokens = result.usage.total_tokens;
      const { cost, credits } = this.calculateUsage(tokens);

      // 4️⃣ Update the existing record with enhanced version
    await this.prisma.aiContentGeneration.update({
      where: { id: contentId },
      data: {
        generatedText: enhancedContent,
        hashtags,
        cost: existing.cost + cost, // accumulate total cost
        creditsUsed: existing.creditsUsed + credits, // accumulate credits
        updatedAt: new Date(),
        model: result.model,
        provider: 'huggingface',
      },
    });

      if (trackUsage) {
        await this.aiUsageService.trackUsage({
          organizationId: options.organizationId,
          userId: options.userId,
          type: 'content_enhancement',
          tokensUsed: tokens,
          cost,
          metadata: {
            style: options.style,
            platform: options.platform,
          },
        });
      }

      this.logger.log(
        `✨ Enhanced content for org=${options.organizationId} in ${
          Date.now() - start
        }ms`,
      );

      return { content: enhancedContent, hashtags, cost, credits };
    } catch (err) {
      this.logger.error(
        `❌ Content enhancement failed for org=${options.organizationId}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        `Content enhancement failed: ${err.message}`,
      );
    }
  }

  // ---------- Helpers ----------

  private getDefaultBrandKit() {
    return {
      id: 'default',
      name: 'Default Brand',
      brandVoice: 'Professional, engaging',
    };
  }

  private buildEnhancedPrompt(
    generateDto: GenerateContentDto,
    brandKit: any,
  ): string {
    const platformContext = this.getPlatformContext(generateDto.platform);
    const toneContext = this.getToneContext(generateDto.tone);
    const platformTips = this.getPlatformGuidelines(generateDto.platform);

    return `
      As a social media content creator for ${brandKit.name}, create ${generateDto.contentType.toLowerCase()} content.

      TOPIC: ${generateDto.topic}
      PLATFORM: ${platformContext}
      TONE: ${toneContext}
      
      BRAND GUIDELINES:
      ${this.buildBrandContext(brandKit)}

      CONTENT REQUIREMENTS:
      - Optimize for ${generateDto.platform} platform best practices
      - ${platformTips}
      - Use engaging hooks and calls-to-action
      - Include appropriate emojis and formatting
      - Ensure mobile-friendly readability
      - Apply ${generateDto.tone} tone consistently

      ${generateDto.customPrompt || 'Create engaging, on-brand content that resonates with our audience.'}

      Return response in JSON format: 
      { 
        "content": "...", 
        "hashtags": ["#tag1", "#tag2"],
        "engagement_hook": "optional hook phrase"
      }
    `;
  }

  private buildBrandContext(brandKit: any): string {
    const parts: string[] = [];
    if (brandKit.brandVoice) parts.push(`Brand voice: ${brandKit.brandVoice}`);
    if (brandKit.tone) parts.push(`Preferred tone: ${brandKit.tone}`);
    if (brandKit.guidelines?.keyMessaging)
      parts.push(
        `Key messaging: ${brandKit.guidelines.keyMessaging.join(', ')}`,
      );
    if (brandKit.guidelines?.targetAudience)
      parts.push(`Target audience: ${brandKit.guidelines.targetAudience}`);
    return parts.join('\n');
  }

  // private parseAiResponse(result: any): {
  //   content: string;
  //   hashtags: string[];
  // } {
  //   try {
  //     const parsed = JSON.parse(result.choices[0].message.content);
  //     return { content: parsed.content, hashtags: parsed.hashtags || [] };
  //   } catch {
  //     return { content: result.choices[0].message.content, hashtags: [] };
  //   }
  // }

  private calculateUsage(tokens: number): { cost: number; credits: number } {
    const cost = (tokens / 1000) * 0.02; // GPT-4 pricing
    const credits = Math.ceil(tokens / 100);
    return { cost, credits };
  }

  private getPlatformContext(platform: Platform): string {
    const map = {
      INSTAGRAM: 'Instagram (visual-focused, casual, emoji-friendly)',
      FACEBOOK: 'Facebook (community-oriented, informative)',
      LINKEDIN: 'LinkedIn (professional, industry insights)',
      X: 'X/Twitter (concise, engaging, hashtag-driven)',
    };
    return map[platform] || platform;
  }

  private getPlatformGuidelines(platform: Platform): string {
    const tips: Record<string, string> = {
      INSTAGRAM:
        'Focus on visual storytelling, use emojis, create engagement hooks',
      FACEBOOK: 'Encourage discussions, ask questions, community-focused',
      X: 'Be concise, use threading, incorporate trends',
      LINKEDIN: 'Professional tone, value-driven, industry insights',
    };
    return tips[platform] || '';
  }

  private getToneContext(tone: ToneType): string {
    const map = {
      CASUAL: 'Casual and friendly',
      PROFESSIONAL: 'Professional and authoritative',
      EDUCATIONAL: 'Educational and informative',
      INSPIRATIONAL: 'Inspirational and motivational',
      WITTY: 'Witty and humorous',
    };
    return map[tone] || tone;
  }

  private cleanAndParseResponse(generatedText: string): {
    content: string;
    hashtags: string[];
    engagement_hook: string;
    raw?: string;
  } {
    if (!generatedText?.trim()) {
      return { content: '', hashtags: [], engagement_hook: '', raw: '' };
    }

    try {
      const cleaned = generatedText.replace(/```(?:json)?/g, '').trim();

      const parsed = JSON.parse(cleaned);

      return {
        content: this.sanitizeContent(
          parsed.content ?? parsed.text ?? parsed.response ?? '',
        ),
        hashtags: this.extractHashtags(parsed.hashtags ?? parsed.tags ?? []),
        engagement_hook:
          parsed.engagement_hook ?? parsed.hook ?? parsed.engagement ?? '',
        raw: cleaned,
      };
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to parse AI response as JSON. Returning raw text. Error: ${error.message}`,
      );

      const hashtags = this.extractHashtagsFromText(generatedText);
      const content = generatedText.replace(/#\w+/g, '').trim();

      return { content, hashtags, engagement_hook: '', raw: generatedText };
    }
  }

  private sanitizeContent(content: any): string {
    if (typeof content === 'string') {
      return content.trim();
    }
    if (typeof content === 'number' || typeof content === 'boolean') {
      return content.toString();
    }
    return '';
  }

  private extractHashtags(hashtags: any): string[] {
    if (Array.isArray(hashtags)) {
      return hashtags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
        .slice(0, 10); // Limit to 10 hashtags
    }
    return [];
  }

  private extractHashtagsFromText(text: string): string[] {
    const hashtagRegex = /#\w+/g;
    const matches = text.match(hashtagRegex) || [];
    return matches.slice(0, 10); // Limit to 10 hashtags
  }
}
