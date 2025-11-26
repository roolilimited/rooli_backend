
export interface TemplateContent {
  version: number;
  structure: {
    caption: string;
    hashtags?: string[];
    cta?: string;
    variables: Record<
      string,
      {
        type: 'string' | 'number' | 'boolean' | 'date' | 'url';
        required: boolean;
        defaultValue?: any;
        description?: string;
        validation?: {
          minLength?: number;
          maxLength?: number;
          pattern?: string;
          options?: string[];
        };
      }
    >;
  };
  metadata: {
    idealLength: number;
    tone: string;
    emojiRecommendations?: string[];
    platformSpecific?: Record<string, any>;
  };
}


export interface TemplateVariable {
  required?: boolean;
  validation?: {
    regex?: string;
    minLength?: number;
    maxLength?: number;
  };
}
