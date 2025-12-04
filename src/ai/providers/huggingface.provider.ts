import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
   HttpException
} from '@nestjs/common';
import OpenAI from 'openai';
import { HuggingFaceClient } from '../interfaces/index.interface';

@Injectable()
export class HuggingFaceService implements HuggingFaceClient {
  private readonly logger = new Logger(HuggingFaceService.name);
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly textModel: string;

  constructor() {
    const apiKey = process.env.HF_API_TOKEN || process.env.HF_TOKEN;

    if (!apiKey) {
      throw new NotFoundException(
        'Hugging Face API token not found in environment variables.',
      );
    }

    this.apiKey = apiKey; 

    // Use the same model as your Python example or your preferred model
    this.textModel = process.env.HF_MODEL ?? 'zai-org/GLM-4.6:novita';

    // Use the exact same base URL as your working Python example
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://router.huggingface.co/v1', // No trailing slash
    });
  }

  async generateText(prompt: string): Promise<{
    choices: { message: { content: string } }[];
    usage: { total_tokens: number };
    model: string;
  }> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.textModel,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional social media content creator. Return responses in JSON format.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      this.logger.log(
        `Successfully generated content using model: ${this.textModel}`,
      );

      return {
        choices: completion.choices,
        usage: {
          total_tokens: completion.usage?.total_tokens ?? 0,
        },
        model: completion.model,
      };
    } catch (error) {
      this.logger.error('Hugging Face Router API call failed:', error);

      // More specific error handling
      if (error.code === 'invalid_api_key') {
        throw new UnauthorizedException('Invalid Hugging Face API token');
      } else if (error.status === 404) {
        throw new NotFoundException(`Model ${this.textModel} not found or not accessible`);
      } else if (error.status === 429) {
        throw new HttpException('Rate limit exceeded for Hugging Face Router API', 429);
      }

      throw error;
    }
  }

  async generateImage(
    prompt: string,
    model = 'stabilityai/stable-diffusion-xl-base-1.0',
  ) {
    try {
      const response = await fetch(
        'https://router.huggingface.co/nscale/v1/images/generations',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt,
            response_format: 'b64_json',
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new ServiceUnavailableException(`HF image generation failed: ${text}`);
      }

      const result = await response.json();
      const imageBase64 = result.data?.[0]?.b64_json;

      if (!imageBase64) throw new BadRequestException('No image data returned');

      return {
        imageUrl: `data:image/png;base64,${imageBase64}`,
        model,
        prompt,
      };
    } catch (err) {
      this.logger.error(`❌ Image generation failed: ${err.message}`);
      throw new InternalServerErrorException('Image generation failed.');
    }
  }
}
