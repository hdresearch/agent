// Permission management handlers

import { respondToPermission, cancelPermission } from "../../core/agent-manager";

export interface PermissionRespondParams {
  requestId: string;
  optionId: string;
}

export interface PermissionCancelParams {
  requestId: string;
}

export interface PermissionResult {
  success: boolean;
}

export function handlePermissionRespond(params: PermissionRespondParams): PermissionResult {
  if (!params.requestId || !params.optionId) {
    throw new Error("Missing requestId or optionId parameter");
  }
  const success = respondToPermission(params.requestId, params.optionId);
  return { success };
}

export function handlePermissionCancel(params: PermissionCancelParams): PermissionResult {
  if (!params.requestId) {
    throw new Error("Missing requestId parameter");
  }
  const success = cancelPermission(params.requestId);
  return { success };
}
