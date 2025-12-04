import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_RATE_LIMITS, RateLimitConfig } from './rate-limit.config';
import { RedisService } from '@/redis/redis.service';
import { Platform } from '@generated/enums';



@Injectable()
export class RateLimitService {
  // Lua script for atomic check-and-increment
  private readonly luaCheckScript = `
local current = redis.call('GET', KEYS[1])
if current then
  if tonumber(current) >= tonumber(ARGV[2]) then
    return {tonumber(current), redis.call('TTL', KEYS[1])}
  end
end

local newVal = redis.call('INCR', KEYS[1])
if newVal == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {newVal, tonumber(ARGV[1])}
`;

  private scriptSha: string | null = null;

  constructor(private readonly redisService: RedisService) {}

  // Load script into Redis on module init
  async onModuleInit() {
    try {
      this.scriptSha = await this.redisService.loadScript(this.luaCheckScript);
    } catch (error) {
      // Fallback to EVAL if SCRIPT LOAD fails
      this.scriptSha = null;
    }
  }

  // async checkLimit(
  //   platform: Platform,
  //   accountId: string,
  //   action: string,
  // ): Promise<{ used: number; resetIn: number; remaining: number }> {
  //   const limitConfig = this.getLimitConfig(platform, action);
  //   const redisKey = this.getRateLimitKey(platform, accountId, action);

  //   let result: [number, number];

  //   if (this.scriptSha) {
  //     try {
  //       result = await this.redisService.evalsha(
  //         this.scriptSha,
  //         1,
  //         redisKey,
  //         limitConfig.window,
  //         limitConfig.limit,
  //       ) as [number, number];
  //     } catch (e: any) {
  //       // Only fallback on NOSCRIPT errors
  //       if (e?.message?.includes('NOSCRIPT')) {
  //         result = await this.redisService.eval(
  //           this.luaCheckScript,
  //           1,
  //           redisKey,
  //           limitConfig.window,
  //           limitConfig.limit,
  //         ) as [number, number];
  //       } else {
  //         throw e;
  //       }
  //     }
  //   } else {
  //     result = await this.redisService.eval(
  //       this.luaCheckScript,
  //       1,
  //       redisKey,
  //       limitConfig.window,
  //       limitConfig.limit,
  //     ) as [number, number];
  //   }

  //   const [usedCount, ttlOrWindow] = result;

  //   if (usedCount > limitConfig.limit) {
  //     throw new TooManyRequestsException(
  //       `Rate limit exceeded for ${platform} ${action}. Try again in ${ttlOrWindow}s`,
  //     );
  //   }

  //   return {
  //     used: usedCount,
  //     remaining: Math.max(limitConfig.limit - usedCount, 0),
  //     resetIn: ttlOrWindow,
  //   };
  // }

// private getLimitConfig(platform: Platform, action: string): RateLimitConfig {
//   const platformKey = PLATFORM_KEY_MAP[platform];
//   const platformConfig = PLATFORM_RATE_LIMITS[platformKey];

//   // Try specific config for that action
//   if (platformConfig?.[action]) {
//     return platformConfig[action];
//   }

//   // Fallback to general default
//   return PLATFORM_RATE_LIMITS.GENERAL.default;
// }

  // async getQuota(
  //   platform: Platform,
  //   accountId: string,
  //   action: string,
  // ): Promise<{ used: number; resetIn: number; remaining: number }> {
  //   const limitConfig = this.getLimitConfig(platform, action);
  //   const redisKey = this.getRateLimitKey(platform, accountId, action);

  //   const countStr = await this.redisService.get(redisKey);
  //   let ttl = await this.redisService.ttl(redisKey);

  //   const used = countStr ? parseInt(countStr, 10) : 0;

  //   if (ttl < 0) {
  //     ttl = limitConfig.window;
  //   }

  //   return {
  //     used,
  //     remaining: Math.max(limitConfig.limit - used, 0),
  //     resetIn: ttl,
  //   };
  // }

   //Helper to generate Redis key
 getRateLimitKey(platform: Platform, accountId: string, action: string): string {
  return `rate_limit:${platform}:${accountId}:${action}`;
}
}