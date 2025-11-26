import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProcessMessageEvent } from './interfaces/index.interface.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { MessageStatus, Platform } from '@generated/enums';


@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process an incoming message
   */
  async processIncomingMessage(event: ProcessMessageEvent): Promise<void> {
    try {
      // 1. Find or create conversation
      const conversation = await this.findOrCreateConversation(
        event.organizationId,
        event.platform,
        event.messageData.threadId || event.messageData.id,
        event.messageData.from,
      );

      // 2. Create message
      const message = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          externalSender: event.messageData.from,
          content: event.messageData.text,
          mediaUrl: event.messageData.mediaUrls?.[0] ?? null, // store first media only
          sentAt: event.messageData.timestamp ?? new Date(),
          status: MessageStatus.UNREAD,
        },
      });

      // 3. Update conversation metrics
      await this.updateConversationMetrics(conversation.id);

      this.logger.log(
        `Processed message ${message.id} in conversation ${conversation.id}`,
      );

      // 4. Emit event for notifications
      this.emitNotificationEvent(conversation, message);
    } catch (error) {
      this.logger.error('Failed to process incoming message', error.stack);
      throw error;
    }
  }

  /**
   * Find or create conversation thread
   */
  private async findOrCreateConversation(
    organizationId: string,
    platform: Platform,
    externalThreadId: string,
    externalUserId: string,
  ) {
    return this.prisma.conversation.upsert({
      where: {
        organizationId_platform_externalId: {
          organizationId,
          platform,
          externalId: externalThreadId,
        },
      },
      update: {
        updatedAt: new Date(),
        lastMessageAt: new Date(),
        externalUserId,
      },
      create: {
        organizationId,
        platform,
        externalId: externalThreadId,
        externalUserId,
        lastMessageAt: new Date(),
        lastMessagePreview: 'New conversation started',
      },
    });
  }

  /**
   * Update conversation unread count and last message preview
   */
  private async updateConversationMetrics(conversationId: string) {
    const [unreadCount, lastMessage] = await this.prisma.$transaction([
      this.prisma.message.count({
        where: { conversationId, status: MessageStatus.UNREAD },
      }),
      this.prisma.message.findFirst({
        where: { conversationId },
        orderBy: { sentAt: 'desc' },
        select: { content: true },
      }),
    ]);

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        unreadCount,
        lastMessagePreview:
          lastMessage?.content?.substring(0, 100) ?? 'New message',
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Emit event for notifications module
   */
  private emitNotificationEvent(conversation: any, message: any) {
    this.eventEmitter.emit('inbox.message.received', {
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      messageId: message.id,
      sender: message.externalSender,
      preview: message.content?.substring(0, 50),
      platform: conversation.platform,
    });
  }

  /**
   * Get conversations for organization
   */
  async getConversations(organizationId: string, filters?: any) {
    return this.prisma.conversation.findMany({
      where: { organizationId, ...filters },
      include: {
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  /**
   * Get messages in a conversation
   */
  async getConversationMessages(
    conversationId: string,
    organizationId: string,
  ) {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        conversation: { organizationId },
      },
      orderBy: { sentAt: 'asc' },
    });
  }

  /**
   * Mark all unread messages as read
   */
  async markAsRead(conversationId: string, organizationId: string) {
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        conversation: { organizationId },
        status: MessageStatus.UNREAD,
      },
      data: { status: MessageStatus.READ },
    });

    await this.updateConversationMetrics(conversationId);
  }

  /**
   * Send a reply in a conversation
   */
  async sendReply(
    conversationId: string,
    organizationId: string,
    content: string,
    userId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        content,
        sentAt: new Date(),
        status: MessageStatus.DELIVERED,
      },
    });

    await this.updateConversationMetrics(conversationId);

    // Emit event for outbound processing
    this.eventEmitter.emit('inbox.message.sent', {
      conversationId,
      messageId: message.id,
      content,
      platform: conversation.platform,
      externalThreadId: conversation.externalId,
    });

    return message;
  }
}
