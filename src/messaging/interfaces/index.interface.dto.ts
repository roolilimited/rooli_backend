import { Platform } from "@generated/enums";


export interface ProcessMessageEvent {
  platform: Platform;
  messageData: {
    id: string;
    from: string;
    text: string;
    timestamp: Date;
    threadId?: string;
    mediaUrls?: string[];
  };
  socialAccountId: string;
  organizationId: string;
}
