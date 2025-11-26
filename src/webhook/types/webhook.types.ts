import { Platform, WebhookEventType } from "@generated/enums";



export interface WebhookEvent {
  id: string;
  platform: Platform;
  eventType: WebhookEventType;
  organizationId: string;
  externalId?: string; // Platform's event ID
  payload: any; // Raw payload from the platform
  processed: boolean;
  processedAt?: Date;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
}

export interface ProcessedWebhookEvent {
  platform: Platform;
  eventType: WebhookEventType;
  organizationId: string;
  timestamp: Date;
  data: {
    // Standardized data for internal processing
    // For DMs
    message?: {
      id: string;
      from: { id: string; username?: string; name?: string };
      text?: string;
      mediaUrl?: string;
      conversationId: string;
    };
    // For Engagement
    engagement?: {
      postId?: string; // Your internal post ID
      platformPostId: string; // ID on the social platform
      type: 'like' | 'comment' | 'share';
      count?: number; // For aggregated updates
      user?: { id: string; username?: string }; // Who performed the action
    };
    // For Post Lifecycle
    postUpdate?: {
      postId: string;
      platformPostId: string;
      status: 'published' | 'failed';
      failureReason?: string;
    };
  };
}

export interface ParsedWebhookPayload {
  externalId: string;
  platformAccountId: string;
  eventType: WebhookEventType;
}

export interface WebhookStrategy {
  /**
   * Verify the webhook signature
   */
  verifySignature(
    rawBody: string,
    signature: string,
    headers: Record<string, string>,
  ): Promise<boolean>;

  /**
   * Parse and normalize the payload into a standard format
   */
  parsePayload(payload: any): {
    externalId: string;
    platformAccountId: string;
    eventType: WebhookEventType;
  };

  /**
   * Handle platform-specific verification (e.g. challenge handshake)
   */
  handleVerification(query: any, body?: any): string | null;
}