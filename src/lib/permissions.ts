export type Permission =
  | "create-deployments"
  | "delete-deployments"
  | "manage-alerts"
  | "manage-backups"
  | "manage-deployments"
  | "manage-groups"
  | "manage-security"
  | "manage-settings"
  | "manage-sites"
  | "manage-snapshots"
  | "manage-templates"
  | "manage-users"
  | "view-all-deployments";

export const ALL_PERMISSIONS: Permission[] = [
  "view-all-deployments",
  "create-deployments",
  "delete-deployments",
  "manage-deployments",
  "manage-templates",
  "manage-backups",
  "manage-snapshots",
  "manage-alerts",
  "manage-security",
  "manage-settings",
  "manage-sites",
  "manage-users",
  "manage-groups",
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "create-deployments": "Create deployments",
  "delete-deployments": "Delete deployments",
  "manage-alerts": "Manage alerts",
  "manage-backups": "Manage backups",
  "manage-deployments": "Manage deployments",
  "manage-groups": "Manage groups",
  "manage-security": "Manage security",
  "manage-settings": "Manage settings",
  "manage-sites": "Manage sites",
  "manage-snapshots": "Manage snapshots",
  "manage-templates": "Manage templates",
  "manage-users": "Manage users",
  "view-all-deployments": "View all deployments",
};

export const GLOBAL_PERMISSIONS: Permission[] = [
  "manage-users",
  "manage-sites",
  "manage-groups",
];

export const SITE_PERMISSIONS: Permission[] = [
  "view-all-deployments",
  "create-deployments",
  "delete-deployments",
  "manage-deployments",
  "manage-templates",
  "manage-backups",
  "manage-snapshots",
  "manage-alerts",
  "manage-security",
  "manage-settings",
];

export const GLOBAL_PERMISSION_LABELS: Record<string, string> = {
  "manage-users": "Manage users",
  "manage-sites": "Manage sites",
  "manage-groups": "Manage groups",
};

export const SITE_PERMISSION_LABELS: Record<string, string> = {
  "view-all-deployments": "View all deployments",
  "create-deployments": "Create deployments",
  "delete-deployments": "Delete deployments",
  "manage-deployments": "Manage deployments",
  "manage-templates": "Manage templates",
  "manage-backups": "Manage backups",
  "manage-snapshots": "Manage snapshots",
  "manage-alerts": "Manage alerts",
  "manage-security": "Manage security",
  "manage-settings": "Manage settings",
};
