import { SocialAccountRole } from "@generated/enums";

// Define all permissions by domain
export const PERMISSIONS = {
  PAGE: {
    VIEW_POSTS: 'page:view_posts',
    CREATE_POSTS: 'page:create_posts',
    SCHEDULE_POSTS: 'page:schedule_posts',
    VIEW_ANALYTICS: 'page:view_analytics',
    RESPOND_TO_COMMENTS: 'page:respond_comments',
    VIEW_MESSAGES: 'page:view_messages',
  },

  PROFILE: {
    VIEW_PROFILE: 'profile:view',
    EDIT_PROFILE: 'profile:edit',
    MANAGE_SETTINGS: 'profile:manage_settings',
    VIEW_CONNECTIONS: 'profile:view_connections',
    MANAGE_TEAM: 'profile:manage_team',
  },

  COMMON: {
    VIEW_ANALYTICS: 'common:view_analytics',
    EXPORT_DATA: 'common:export_data',
  },
} as const;

// Flatten all permissions into a single array
export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS)
  .flatMap(group => Object.values(group));

// Role-to-permission mapping
export const ROLE_PERMISSIONS: Record<SocialAccountRole, string[]> = {
  OWNER: ALL_PERMISSIONS, // Full access

  MANAGER: [
    PERMISSIONS.PAGE.VIEW_POSTS,
    PERMISSIONS.PAGE.CREATE_POSTS,
    PERMISSIONS.PAGE.SCHEDULE_POSTS,
    PERMISSIONS.PAGE.VIEW_ANALYTICS,
    PERMISSIONS.PAGE.RESPOND_TO_COMMENTS,
    PERMISSIONS.PAGE.VIEW_MESSAGES,

    PERMISSIONS.COMMON.VIEW_ANALYTICS,
  ],

  CONTRIBUTOR: [
    PERMISSIONS.PAGE.VIEW_POSTS,
    PERMISSIONS.PAGE.CREATE_POSTS,
    PERMISSIONS.PAGE.VIEW_ANALYTICS,
  ],

  ANALYST: [
    PERMISSIONS.PAGE.VIEW_POSTS,
    PERMISSIONS.PAGE.VIEW_ANALYTICS,

    PERMISSIONS.COMMON.VIEW_ANALYTICS,
    PERMISSIONS.COMMON.EXPORT_DATA,
  ],
};
