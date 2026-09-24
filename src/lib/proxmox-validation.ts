export const PROXMOX_STORAGE_REGEX = /^[a-zA-Z0-9._-]{1,63}$/;
export const PROXMOX_BRIDGE_REGEX = /^[a-zA-Z0-9._-]{1,32}$/;
export const PROXMOX_VOLID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/:._-]*$/;

export const FIREWALL_PROTO_REGEX = /^[a-z0-9-]{1,20}$/;
export const FIREWALL_PORT_REGEX = /^\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?)*$/;
export const FIREWALL_ADDR_REGEX = /^[0-9a-fA-F.:/,+-]{1,120}$/;
export const FIREWALL_COMMENT_REGEX = /^[\w .,:;@()\[\]/-]{0,120}$/;
