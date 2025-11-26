import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { MessagingService } from "../messaging.service";
import { Platform } from "@generated/enums";


interface MessageReceivedEvent {
  platform: Platform;
  messageData: {
    id: string;
    from: string;
    text: string;
    timestamp: Date;
    mediaUrls?: string[];
  };
  socialAccountId: string;
  organizationId: string;
}

@Injectable()
export class InboxListener {
  private readonly logger = new Logger(InboxListener.name);

  constructor(private readonly inboxService: MessagingService) {}

  @OnEvent('message.received', { async: true })
  async handleMessageReceived(event: MessageReceivedEvent) {
    this.logger.debug(
      `Processing message from ${event.platform}: ${event.messageData.id}`,
    );

    try {
      await this.inboxService.processIncomingMessage(event);
    } catch (error) {
      this.logger.error(
        `Failed to process message ${event.messageData.id}: ${error.message}`,
      );
    }
  }
}