import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationAudienceService } from '../notification-audience.service';
import { NotificationService } from '../notification.service';
import { NotificationType, NotificationPriority } from '@generated/enums';

export interface MentionEvent {
  userId: string;
  organizationId: string;
  postId: string;
  mentionedBy: string;
  context: string;
  socialAccountId?: string; // optional if not always needed
}

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notificationsService: NotificationService,
    private readonly audienceService: NotificationAudienceService,
  ) {}

  @OnEvent('inbox.message.received')
  async handleNewMessage(event: InboxMessageEvent) {
    this.logger.debug(
      `Creating notification for new message: ${event.messageId}`,
    );

    let userIds: string[];

    if (event.socialAccountId) {
      userIds = await this.audienceService.getSocialAccountAudience(
        event.organizationId,
        event.socialAccountId,
        'message:manage',
      );
    } else {
      userIds = await this.audienceService.getOrganizationAudience(
        event.organizationId,
        'message:manage',
      );
    }

    if (!userIds.length) {
      this.logger.warn(`No users to notify for message ${event.messageId}`);
      return;
    }

    const notifications = userIds.map((userId) => ({
      userId,
      organizationId: event.organizationId,
      type: NotificationType.MESSAGE_RECEIVED,
      title: 'New Message Received',
      message: `New message from ${event.sender}: ${event.preview}`,
      data: {
        conversationId: event.conversationId,
        messageId: event.messageId,
        platform: event.platform,
        sender: event.sender,
        socialAccountId: event.socialAccountId,
      },
      priority: NotificationPriority.NORMAL,
      messageId: event.messageId,
      socialAccountId: event.socialAccountId,
    }));

    await this.notificationsService.createBulkNotifications(notifications);
  }

  @OnEvent('post.requires_approval')
  async handlePostApproval(event: PostApprovalEvent) {
    const approverIds = await this.audienceService.getSocialAccountAudience(
      event.organizationId,
      event.socialAccountId,
      'post:approve',
    );

    const recipients = approverIds.filter((id) => id !== event.authorId);

    if (!recipients.length) {
      this.logger.warn(`No approvers found for post ${event.postId}`);
      return;
    }

    const notifications = recipients.map((userId) => ({
      userId,
      organizationId: event.organizationId,
      type: NotificationType.POST_APPROVAL,
      title: 'Post Requires Approval',
      message: `A new post "${event.postTitle || 'Untitled'}" is waiting for your approval`,
      data: {
        postId: event.postId,
        authorId: event.authorId,
        socialAccountId: event.socialAccountId,
      },
      priority: NotificationPriority.HIGH,
      postId: event.postId,
      socialAccountId: event.socialAccountId,
    }));

    await this.notificationsService.createBulkNotifications(notifications);
  }

  @OnEvent('user.mentioned')
  async handleUserMention(event: MentionEvent) {
    await this.notificationsService.createUserNotification({
      userId: event.userId,
      organizationId: event.organizationId,
      type: NotificationType.MENTION,
      title: 'You were mentioned',
      message: `${event.mentionedBy} mentioned you: ${event.context}`,
      data: {
        postId: event.postId,
        mentionedBy: event.mentionedBy,
        context: event.context,
      },
      priority: NotificationPriority.HIGH,
      postId: event.postId,
      socialAccountId: event.socialAccountId,
    });
  }
}
