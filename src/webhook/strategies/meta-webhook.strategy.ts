import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ParsedWebhookPayload, WebhookStrategy } from '../types/webhook.types';
import { WebhookEventType } from '@generated/enums';

@Injectable()
export class MetaWebhookStrategy implements WebhookStrategy {
  private readonly APP_SECRET = process.env.META_APP_SECRET!;
  constructor() {}

  async verifySignature(
    rawBody: string,
    signature: string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    try {
      // Pass the rawBody as a Buffer and the 'x-hub-signature' header
      this.verify(headers['x-hub-signature'], Buffer.from(rawBody));
      return true;
    } catch (error) {
      return false;
    }
  }

  handleVerification(query: any, body?: any): string | null {
    // We ignore the 'body' parameter for Meta, they use query strings.
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  verify(signatureHeader: string | undefined, rawBody: Buffer): void {
    if (!signatureHeader) {
      throw new UnauthorizedException('Missing X-Hub-Signature header');
    }

    // Signature comes in like: sha1=abcdef...
    const [method, signature] = signatureHeader.split('=');
    if (method !== 'sha1' || !signature) {
      throw new UnauthorizedException('Invalid signature format');
    }

    const expected = createHmac('sha1', this.APP_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      throw new UnauthorizedException('Invalid Meta webhook signature');
    }
  }

parsePayload(payload: any): ParsedWebhookPayload {
  const entry = payload.entry?.[0];
  if (!entry) {
    throw new Error('No entry found in Meta payload');
  }

  let platformAccountId: string;
  let externalId: string;
  let eventType: WebhookEventType = WebhookEventType.ENGAGEMENT; // 👈 Always engagement

  // ✅ Handle Messages (DMs)
  if (entry.messaging) {
    const messagingEvent = entry.messaging[0];
    platformAccountId = messagingEvent.recipient?.id;
    externalId =
      messagingEvent.message?.mid ||
      `msg_${messagingEvent.timestamp}_${messagingEvent.sender.id}`;
  }

  // ✅ Handle Feed Changes (posts, comments, reactions, etc.)
  else if (entry.changes) {
    const change = entry.changes[0];
    const value = change.value;

    platformAccountId =
      entry.id || value.from?.id || value.post_id?.split('_')[0];
    externalId = value.post_id || entry.id;
  }

  // ✅ Fallback
  else {
    platformAccountId = entry.id;
    externalId = entry.id;
  }

  if (!platformAccountId) {
    throw new Error('Could not extract platformAccountId from Meta payload');
  }

  return { externalId, platformAccountId, eventType };
}


  //  parsePayload(payload: any): ParsedWebhookPayload  {
  //   const entry = payload.entry?.[0];
  //   if (!entry) {
  //     throw new Error('No entry found in Meta payload');
  //   }

  //   let platformAccountId: string;
  //   let externalId: string;
  //   let eventType: WebhookEventType = WebhookEventType.ENGAGEMENT;

  //   // 1. Handle Messages (DM) - Primary for Inbox Module
  //   if (entry.messaging) {
  //     const messagingEvent = entry.messaging[0];
  //     // The PAGE ID is under recipient.id for messages
  //     platformAccountId = messagingEvent.recipient?.id;
  //     // Use the message ID or a combination of timestamp+sender ID as externalId
  //     externalId = messagingEvent.message?.mid || `msg_${messagingEvent.timestamp}_${messagingEvent.sender.id}`;
  //     eventType = WebhookEventType.MESSAGE_RECEIVED;
  //   }
  //   // 2. Handle Feed Changes (Engagements) - Primary for Engagement Module
  //   else if (entry.changes) {
  //     const change = entry.changes[0];
  //     // The PAGE ID is often here. If not, try to extract from post_id.
  //     platformAccountId = change.value?.from?.id || change.value?.post_id?.split('_')[0];
  //     externalId = change.value?.post_id || entry.id;
  //   }
  //   // 3. Handle Standalone (e.g., Instagram story insights?)
  //   else {
  //     // Fallback: try to find any ID we can use for lookup
  //     platformAccountId = entry.id; // This might be the page ID
  //     externalId = entry.id;
  //   }

  //   if (!platformAccountId) {
  //     throw new Error('Could not extract platformAccountId from Meta payload');
  //   }

  //   return { externalId, platformAccountId, eventType };
  // }
}
