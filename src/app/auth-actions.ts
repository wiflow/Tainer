"use server";

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  BasicActionState,
  LoginActionState,
  TwoFactorSetupActionState,
} from "@/lib/action-states";
import {
  adminResetUserTwoFactor,
  adminSetUserPassword,
  ALL_PERMISSIONS,
  beginLogin,
  beginTwoFactorEnrollment,
  changePassword,
  clearLoginLockoutsForUser,
  completeTwoFactorLogin,
  confirmTwoFactorEnrollment,
  createInitialAdministrator,
  createPasswordReset,
  createUserAsAdmin,
  disableLocalPassword,
  disableTwoFactor,
  getCurrentSession,
  getLoginChallengeUser,
  isAcceptableLoginEmail,
  requireAdminSession,
  requirePermission,
  requireSession,
  resetPasswordWithToken,
  revokeAllOtherSessions,
  revokeSession,
  signOutCurrentSession,
  updateProfile,
  updateUserPermissions,
  type Permission,
} from "@/lib/auth";
import { recordAdminAudit, recordThrottledAdminAudit } from "@/lib/admin-audit-log";
import { getClientIpForRateLimit } from "@/lib/proxy-trust";

function errorState<T extends BasicActionState>(state: T, message: string): T {
  return {
    ...state,
    message,
    requestId: randomUUID(),
    status: "error",
  };
}

function isPrivateIpv4Host(hostname: string) {
  const [first = 0, second = 0] = hostname.split(".").map((segment) => Number(segment));

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isTrustedDevelopmentHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1"
  ) {
    return true;
  }

  const version = isIP(normalized);

  if (version === 4) {
    return isPrivateIpv4Host(normalized);
  }

  if (version === 6) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return false;
}

function parseTrustedDevelopmentOrigin(candidate: string | null | undefined) {
  const raw = candidate?.trim();

  if (!raw) {
    return null;
  }

  try {
    const parsed = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);

    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isTrustedDevelopmentHostname(parsed.hostname)
    ) {
      return parsed.origin;
    }
  } catch {}

  return null;
}

async function getAppOrigin() {
  const configuredAppUrl = process.env.APP_URL?.trim();

  if (configuredAppUrl) {
    let parsed: URL;

    try {
      parsed = new URL(configuredAppUrl);
    } catch {
      throw new Error("APP_URL must be a valid http or https URL.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("APP_URL must use http or https.");
    }

    return parsed.origin;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_URL must be configured before password reset emails can be sent.",
    );
  }

  const headerStore = await headers();
  const origin = parseTrustedDevelopmentOrigin(headerStore.get("origin"));

  if (origin) {
    return origin;
  }

  const forwardedHost = headerStore.get("x-forwarded-host")?.trim();
  const forwardedProto = headerStore.get("x-forwarded-proto")?.trim();
  const forwardedOrigin =
    forwardedHost && (forwardedProto === "http" || forwardedProto === "https")
      ? parseTrustedDevelopmentOrigin(`${forwardedProto}://${forwardedHost}`)
      : null;

  if (forwardedOrigin) {
    return forwardedOrigin;
  }

  const hostOrigin = parseTrustedDevelopmentOrigin(headerStore.get("host"));

  if (hostOrigin) {
    return hostOrigin;
  }

  return "http://localhost:3000";
}

export async function bootstrapAdministratorAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!name || !email || !password) {
      return errorState(_previousState, "Name, email, and password are required.");
    }

    if (password !== confirmPassword) {
      return errorState(_previousState, "Passwords do not match.");
    }

    await createInitialAdministrator({
      email,
      name,
      password,
    });

    await beginLogin(email, password, await getClientIpForRateLimit());
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to create the initial administrator.",
    );
  }

  return {
    message: "",
    requestId: randomUUID(),
    status: "redirect",
  };
}

const CHALLENGE_GONE_ERRORS = new Set([
  "Your login session expired. Sign in again.",
  "This login challenge has already been used.",
  "Two-factor authentication is not available for this account.",
]);

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  let attemptedEmail = "";
  let clientIp: string | undefined;
  let twoFactorStep = false;

  try {
    clientIp = await getClientIpForRateLimit();
    const twoFactorCode = String(formData.get("twoFactorCode") ?? "").trim();

    if (twoFactorCode) {
      twoFactorStep = true;
      let completed: Awaited<ReturnType<typeof completeTwoFactorLogin>>;
      try {
        completed = await completeTwoFactorLogin(twoFactorCode);
      } catch (error) {
        const challengeUser = await getLoginChallengeUser().catch(() => null);
        if (challengeUser) {
          recordThrottledAdminAudit(`two-factor-failure:${challengeUser.email}:${clientIp ?? ""}`, {
            action: "two-factor-failure",
            actorEmail: challengeUser.email,
            actorName: challengeUser.name,
            message: `2FA sign-in failed${clientIp ? ` from ${clientIp}` : ""}: ${error instanceof Error ? error.message : "unknown error"}`,
          }).catch(() => {});
        }
        throw error;
      }
      const { ssoProviderName, user } = completed;
      recordAdminAudit(
        ssoProviderName
          ? {
              action: "sso-login",
              actorEmail: user.email,
              actorName: user.name,
              targetEmail: user.email,
              message: `Signed in via ${ssoProviderName} with 2FA`,
            }
          : {
              action: "login-success",
              actorEmail: user.email,
              actorName: user.name,
              message: "Local password + 2FA sign-in",
            },
      ).catch(() => {});
    } else {
      const email = String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "");

      if (!email || !password) {
        return errorState(_previousState, "Enter both your email and password.");
      }

      if (isAcceptableLoginEmail(email)) {
        attemptedEmail = email.toLowerCase();
      }

      const result = await beginLogin(email, password, clientIp);

      if (result.requiresTwoFactor) {
        recordThrottledAdminAudit(`login-password-verified:${attemptedEmail}:${clientIp ?? ""}`, {
          action: "login-password-verified",
          actorEmail: attemptedEmail,
          actorName: attemptedEmail,
          message: "Password verified, waiting for 2FA code",
        }).catch(() => {});
        return {
          message: "Enter your authenticator code or one of your recovery codes to finish signing in.",
          requestId: randomUUID(),
          requiresTwoFactor: true,
          status: "success",
        };
      }

      recordAdminAudit({
        action: "login-success",
        actorEmail: email,
        actorName: email,
        message: "Local password sign-in",
      }).catch(() => {});
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to sign in.";
    if (attemptedEmail) {
      recordThrottledAdminAudit(`login-failure:${attemptedEmail}:${clientIp ?? ""}`, {
        action: "login-failure",
        actorEmail: attemptedEmail,
        actorName: attemptedEmail,
        message: `Local password sign-in failed${clientIp ? ` from ${clientIp}` : ""}: ${reason}`,
      }).catch(() => {});
    }
    return {
      message: reason,
      requestId: randomUUID(),
      requiresTwoFactor: twoFactorStep && !CHALLENGE_GONE_ERRORS.has(reason),
      status: "error",
    };
  }

  redirect("/");
}

export async function signOutAction() {
  await signOutCurrentSession();
  redirect("/login");
}

export async function requestPasswordResetAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const email = String(formData.get("email") ?? "").trim();

    if (!email) {
      return errorState(_previousState, "Enter the email address for your account.");
    }

    await createPasswordReset(email, await getAppOrigin(), {
      clientIp: await getClientIpForRateLimit(),
    });

    return {
      message:
        "If that account exists, a reset link is on its way. If email is not set up on this server, ask your administrator for the link in the server logs.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to request password reset.",
    );
  }
}

export async function resetPasswordAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const token = String(formData.get("token") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!token || !password) {
      return errorState(_previousState, "A valid token and a new password are required.");
    }

    if (password !== confirmPassword) {
      return errorState(_previousState, "Passwords do not match.");
    }

    const user = await resetPasswordWithToken(token, password);

    recordAdminAudit({
      action: "password-reset-completed",
      actorEmail: user.email,
      actorName: user.name,
      message: user.hasTwoFactor
        ? "Password reset with a reset link, 2FA still required"
        : "Password reset with a reset link",
      targetEmail: user.email,
    }).catch(() => {});
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to reset password.",
    );
  }

  redirect("/login?reset=1");
}

export async function updateProfileAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const name = String(formData.get("name") ?? "").trim();

    await updateProfile({ name });

    revalidatePath("/account");

    return {
      message: "Profile updated.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to update your profile.",
    );
  }
}

export async function changePasswordAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const nextPassword = String(formData.get("nextPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!currentPassword || !nextPassword) {
      return errorState(_previousState, "Enter your current password and a new password.");
    }

    if (nextPassword !== confirmPassword) {
      return errorState(_previousState, "New passwords do not match.");
    }

    await changePassword({
      currentPassword,
      nextPassword,
    });

    const session = await getCurrentSession();
    if (session) {
      recordAdminAudit({
        action: "password-changed",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: "Changed own password and signed out other sessions",
      }).catch(() => {});
    }

    return {
      message: "Password updated. Other sessions have been signed out.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to update your password.",
    );
  }
}

export async function startTwoFactorSetupAction(
  previousState: TwoFactorSetupActionState,
  formData: FormData,
): Promise<TwoFactorSetupActionState> {
  try {
    void previousState;
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const setup = await beginTwoFactorEnrollment({ currentPassword });

    return {
      manualEntryKey: setup.manualEntryKey,
      message: "Scan the QR code with your authenticator app, then confirm with a 6-digit code.",
      qrCodeDataUrl: setup.qrCodeDataUrl,
      recoveryCodes: [],
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      manualEntryKey: "",
      message: error instanceof Error ? error.message : "Failed to start 2FA setup.",
      qrCodeDataUrl: "",
      recoveryCodes: [],
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function confirmTwoFactorSetupAction(
  _previousState: TwoFactorSetupActionState,
  formData: FormData,
): Promise<TwoFactorSetupActionState> {
  try {
    const code = String(formData.get("code") ?? "").trim();

    if (!code) {
      return {
        manualEntryKey: "",
        message: "Enter the 6-digit authenticator code to finish setup.",
        qrCodeDataUrl: "",
        recoveryCodes: [],
        requestId: randomUUID(),
        status: "error",
      };
    }

    const recoveryCodes = await confirmTwoFactorEnrollment(code);
    const session = await getCurrentSession();

    if (session) {
      recordAdminAudit({
        action: "two-factor-enabled",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: `Enabled two-factor authentication`,
      }).catch(() => {});
    }

    revalidatePath("/account");

    return {
      manualEntryKey: "",
      message: "Two-factor authentication is now enabled and other sessions were signed out. Save the recovery codes below.",
      qrCodeDataUrl: "",
      recoveryCodes,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      manualEntryKey: "",
      message: error instanceof Error ? error.message : "Failed to enable 2FA.",
      qrCodeDataUrl: "",
      recoveryCodes: [],
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function disableTwoFactorAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const currentPassword = String(formData.get("currentPassword") ?? "");

    if (!currentPassword) {
      return errorState(_previousState, "Enter your current password to disable 2FA.");
    }

    await disableTwoFactor({ currentPassword });
    const session = await getCurrentSession();

    if (session) {
      recordAdminAudit({
        action: "two-factor-disabled",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: `Disabled two-factor authentication`,
      }).catch(() => {});
    }

    revalidatePath("/account");

    return {
      message: "Two-factor authentication disabled.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to disable 2FA.",
    );
  }
}

export async function disableLocalPasswordAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const confirmation = String(formData.get("confirmation") ?? "").trim();
    if (confirmation !== "DISABLE") {
      return errorState(_previousState, 'Type "DISABLE" to confirm.');
    }

    await disableLocalPassword();
    const session = await getCurrentSession();

    if (session) {
      recordAdminAudit({
        action: "password-changed",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: "Disabled local password (SSO-only)",
      }).catch(() => {});
    }

    revalidatePath("/account");
    return {
      message:
        "Local password disabled. Future sign-ins must use SSO. Your password reset email still works as a recovery path.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to disable password.",
    );
  }
}

export async function requestPasswordResetFromAccountAction(
  previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    void previousState;
    void formData;
    const session = await getCurrentSession();

    if (!session) {
      return errorState(previousState, "Authentication required.");
    }

    const delivery = await createPasswordReset(session.user.email, await getAppOrigin(), {
      clientIp: await getClientIpForRateLimit(),
      waitForDelivery: true,
    });

    return {
      message:
        delivery.delivery === "email"
          ? "Password reset email sent."
          : "Password reset link written to the server logs.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      previousState,
      error instanceof Error ? error.message : "Failed to create password reset.",
    );
  }
}

export async function createUserAction(
  previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    const groupIdsRaw = formData.getAll("groupIds");
    const groupIds = groupIdsRaw.map((v) => String(v).trim()).filter(Boolean);
    const role = String(formData.get("role") ?? "operator").trim();

    if (!name || !email || !password) {
      return errorState(previousState, "Name, email, and password are required.");
    }

    if (password !== confirmPassword) {
      return errorState(previousState, "Passwords do not match.");
    }

    const effectiveRole = (role === "admin" || role === "operator") ? role : "operator";

    const createdUser = await createUserAsAdmin({
      email,
      groupIds: groupIds.length > 0 ? groupIds : undefined,
      name,
      password,
      role: effectiveRole as "admin" | "operator",
    });

    const session = await getCurrentSession();
    if (session) {
      recordAdminAudit({
        action: "user-created",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: `Created user ${createdUser.email} with ${groupIds.length} group(s)`,
        targetEmail: createdUser.email,
      }).catch(() => {});
    }

    revalidatePath("/account");
    revalidatePath("/users");

    return {
      message: `Created ${createdUser.email}.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      previousState,
      error instanceof Error ? error.message : "Failed to create the user account.",
    );
  }
}

export async function revokeSessionAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const sessionId = String(formData.get("sessionId") ?? "").trim();

    if (!sessionId) {
      return errorState(_previousState, "Missing session reference.");
    }

    await revokeSession(sessionId);

    const session = await getCurrentSession();
    if (session) {
      recordAdminAudit({
        action: "session-revoked",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: `Revoked a session`,
      }).catch(() => {});
    }

    revalidatePath("/account");

    return {
      message: "Session revoked.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to revoke session.",
    );
  }
}

export async function revokeAllOtherSessionsAction(
  _previousState: BasicActionState,
): Promise<BasicActionState> {
  try {
    await revokeAllOtherSessions();

    const session = await getCurrentSession();
    if (session) {
      recordAdminAudit({
        action: "sessions-revoked",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: `Revoked all other sessions`,
      }).catch(() => {});
    }

    revalidatePath("/account");

    return {
      message: "All other sessions revoked.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to revoke sessions.",
    );
  }
}

export async function adminResetPasswordAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-users");

    const userId = String(formData.get("userId") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!userId || !password) {
      return errorState(_previousState, "User and new password are required.");
    }

    if (password !== confirmPassword) {
      return errorState(_previousState, "Passwords do not match.");
    }

    await adminSetUserPassword(userId, password);

    recordAdminAudit({
      action: "admin-password-reset",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Reset password for user ${userId}`,
    }).catch(() => {});

    revalidatePath("/users");

    return {
      message: "Password reset. The user's sessions have been revoked.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to reset password.",
    );
  }
}

export async function adminResetTwoFactorAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();

    const userId = String(formData.get("userId") ?? "").trim();
    if (!userId) {
      return errorState(_previousState, "User ID is required.");
    }

    const target = await adminResetUserTwoFactor(userId);

    recordAdminAudit({
      action: "two-factor-reset-by-admin",
      actorEmail: session.user.email,
      actorName: session.user.name,
      targetEmail: target.email,
      message: `Reset two-factor authentication for ${target.email} (user ${userId}) and revoked their sessions`,
    }).catch(() => {});

    revalidatePath("/users");

    return {
      message: "Two-factor authentication reset. The user's sessions have been revoked.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to reset 2FA.",
    );
  }
}

export async function clearUserLoginLockoutAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-users");

    const userId = String(formData.get("userId") ?? "").trim();
    if (!userId) {
      return errorState(_previousState, "User ID is required.");
    }

    const removed = await clearLoginLockoutsForUser(userId);

    recordAdminAudit({
      action: "login-lockout-cleared",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Cleared login lockout for user ${userId} (${removed} bucket${removed === 1 ? "" : "s"})`,
    }).catch(() => {});

    revalidatePath("/users");

    return {
      message: removed > 0
        ? `Login lockout cleared (${removed} bucket${removed === 1 ? "" : "s"}).`
        : "No active lockout to clear.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to clear lockout.",
    );
  }
}

export async function updateUserPermissionsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-users");

    const userId = String(formData.get("userId") ?? "").trim();
    if (!userId) {
      return errorState(_previousState, "Missing user ID.");
    }

    const rawPermissions = String(formData.get("permissions") ?? "");
    const permissions = rawPermissions
      .split(",")
      .map((p) => p.trim())
      .filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission));

    await updateUserPermissions(userId, permissions);

    recordAdminAudit({
      action: "user-permissions-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated permissions for user ${userId}: ${permissions.join(", ") || "none"}`,
    }).catch(() => {});

    revalidatePath("/users");

    return {
      message: "Permissions updated.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to update permissions.",
    );
  }
}
